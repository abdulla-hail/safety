/**
 * قواعد تنفيذ الزيارة جهازًا جهازًا (مطابقة للترحيل المقترح 20261106000100). القاعدة هي المرجع النهائي وتعيد الفحص نفسه؛
 * هذه الدوال تُظهر الخطأ للفني قبل الإرسال وتبني ملخص الإغلاق ولوحة «عملي» والخط الزمني للجهاز.
 * بلا اعتماديات حتى تُختبر مباشرة (tests/unit/visits.test.mjs).
 */

export type InspectionStatus = "pending" | "inspected" | "unable" | "not_found";
export type VisitKind = "periodic" | "emergency" | "repair" | "reinspection" | "other";

export const INSPECTION_STATUS: Record<InspectionStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "لم يُفحص بعد", tone: "neutral" },
  inspected: { label: "تم الفحص", tone: "success" },
  unable: { label: "تعذر الفحص", tone: "warning" },
  not_found: { label: "غير موجود في الموقع", tone: "danger" },
};

export const URGENT_REASONS: Record<string, string> = {
  fault: "عطل", customer_report: "بلاغ من العميل", repair: "إصلاح", reinspection: "إعادة فحص", follow_up: "متابعة", other: "أخرى",
};

export const RESULTS = ["pass", "pass_with_notes", "fail"] as const;
export const DEVICE_STATUSES = ["operational", "needs_maintenance", "faulty", "under_repair", "out_of_service", "expired", "replaced", "decommissioned"] as const;
export const ACTIONS = ["installation", "inspection", "test", "cleaning", "refill", "part_replacement", "repair", "decommission"] as const;

export interface Part { name: string; qty: number | null; unit?: string | null }

export interface ItemInput {
  inspection_status: InspectionStatus;
  result?: string | null;
  status_after?: string | null;
  action?: string | null;
  skip_reason?: string | null;
  readings?: Record<string, string>;
  parts?: Part[];
  follow_up_needed?: boolean;
  follow_up_technician_id?: string | null;
  follow_up_due?: string | null;
  next_due_override?: string | null;
  next_due_reason?: string | null;
}

/** أخطاء البند بالحقل؛ فارغة = صالح للحفظ. today بصيغة YYYY-MM-DD بتوقيت الرياض. */
export function validateItem(i: ItemInput, opt: { visitType: string; canReschedule: boolean; today: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!(i.inspection_status in INSPECTION_STATUS)) e.inspection_status = "حالة فحص غير صالحة";
  if (i.result && !(RESULTS as readonly string[]).includes(i.result)) e.result = "نتيجة غير صالحة";
  if (i.status_after && !(DEVICE_STATUSES as readonly string[]).includes(i.status_after)) e.status_after = "حالة غير صالحة";
  if (i.action && !(ACTIONS as readonly string[]).includes(i.action)) e.action = "نوع عملية غير صالح";
  if (i.inspection_status === "inspected") {
    if (!i.result) e.result = "نتيجة الفحص مطلوبة";
    if (!i.status_after) e.status_after = "حالة الجهاز بعد الفحص مطلوبة";
  }
  if ((i.inspection_status === "unable" || i.inspection_status === "not_found") && (i.skip_reason ?? "").trim().length < 3) {
    e.skip_reason = "اذكر السبب";
  }
  if (Object.keys(i.readings ?? {}).length > 30) e.readings = "حتى 30 قراءة";
  const parts = i.parts ?? [];
  if (parts.length > 50 || parts.some((p) => !p.name?.trim())) e.parts = "حتى 50 بندًا لكل منها اسم";
  if (i.follow_up_needed) {
    if (!i.follow_up_technician_id) e.follow_up_technician_id = "حدد المسؤول";
    if (!i.follow_up_due) e.follow_up_due = "حدد التاريخ";
    else if (i.follow_up_due < opt.today) e.follow_up_due = "لا يكون في الماضي";
  }
  if (i.next_due_override) {
    if (opt.visitType !== "periodic") e.next_due_override = "الزيارة الطارئة لا تغيّر الموعد الدوري";
    else if (!opt.canReschedule) e.next_due_override = "ليست لديك صلاحية تعديل الموعد";
    else if (i.next_due_override <= opt.today) e.next_due_override = "الموعد يجب أن يكون بعد اليوم";
    if ((i.next_due_reason ?? "").trim().length < 5) e.next_due_reason = "اذكر سبب التعديل";
  }
  return e;
}

/** القطع والمواد: سطر لكل بند «الاسم × الكمية [الوحدة]» أو الاسم فقط */
export function parseParts(text: string): Part[] | "invalid" {
  const out: Part[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s*[×xX*]\s*(\d+(?:[.,]\d+)?)\s*(.*)$/);
    const name = (m ? m[1] : line).trim();
    if (!name || name.length > 200) return "invalid";
    out.push({ name, qty: m ? Number(m[2].replace(",", ".")) : null, unit: m && m[3].trim() ? m[3].trim().slice(0, 30) : null });
  }
  return out.length > 50 ? "invalid" : out;
}

export function partsText(parts: Part[] | null | undefined): string {
  return (parts ?? []).map((p) => (p.qty != null ? `${p.name} × ${p.qty}${p.unit ? ` ${p.unit}` : ""}` : p.name)).join("\n");
}

export interface ItemSummary { inspection_status: string; result: string | null; follow_up_needed: boolean }

/** ملخص الإغلاق والنتيجة المتوقعة (مطابق لـ visit_close) */
export function closeSummary(items: ItemSummary[]) {
  const total = items.length;
  const pending = items.filter((i) => i.inspection_status === "pending").length;
  const inspected = items.filter((i) => i.inspection_status === "inspected").length;
  const skipped = items.filter((i) => i.inspection_status === "unable" || i.inspection_status === "not_found").length;
  const issues = items.filter((i) => i.inspection_status === "inspected" && i.result !== "pass").length;
  const fails = items.filter((i) => i.inspection_status === "inspected" && i.result === "fail").length;
  const followups = items.filter((i) => i.follow_up_needed).length;
  const outcome = pending > 0 ? "incomplete" : followups > 0 ? "follow_up_required" : skipped > 0 || issues > 0 ? "completed_with_issues" : "completed";
  return { total, pending, inspected, skipped, issues, fails, followups, outcome, done: total - pending, canCloseNormally: total > 0 && pending === 0 };
}

/** نسبة الإنجاز (الأجهزة التي لها حالة نهائية من أجهزة الزيارة) */
export function progressPercent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

// ---------------------------------------------------------------------
// الموعد القادم (مطابق لـ app_private.compute_next_due وadd_months في القاعدة)
// ---------------------------------------------------------------------
/** إضافة أشهر بتقويم ثابت: نهاية الشهر تُقصّ (31 يناير + شهر = آخر فبراير)، كما يفعل PostgreSQL */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const t = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function computeNextDue(p: {
  start: string | null; months: number | null; days: number | null; policy: "from_completion" | "fixed";
  done: string | null; currentDue: string | null;
}): string | null {
  if (p.months == null && p.days == null) return null;
  if (p.done == null) {
    if (!p.start) return null;
    return p.months != null ? addMonthsISO(p.start, p.months) : addDays(p.start, p.days!);
  }
  if (p.months == null) return addDays(p.done, p.days!);
  if (p.policy === "fixed" && p.start) {
    const after = p.currentDue && p.currentDue > p.done ? p.currentDue : p.done;
    let k = 1;
    while (addMonthsISO(p.start, k * p.months) <= after && k < 2000) k++;
    return addMonthsISO(p.start, k * p.months);
  }
  return addMonthsISO(p.done, p.months);
}

// ---------------------------------------------------------------------
// لوحة «عملي»
// ---------------------------------------------------------------------
export type WorkBucket = "overdue" | "today" | "upcoming" | "later" | "none";

/** تصنيف موعد بالنسبة لليوم: متأخر / اليوم / قادم ضمن الأفق / لاحق / بلا موعد */
export function bucketFor(date: string | null | undefined, today: string, horizonDays: number): WorkBucket {
  if (!date) return "none";
  const d = date.slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  return d <= addDays(today, horizonDays) ? "upcoming" : "later";
}

export interface SiteDue { siteId: string; overdue: number; today: number; upcoming: number; openFaults: number; earliest: string | null }

/** تجميع أجهزة النطاق حسب الموقع لبطاقات الزيارة الدورية */
export function groupDueBySite(devices: { site_id: string | null; next_maintenance_at: string | null }[], faultsBySite: Record<string, number>,
  today: string, horizonDays: number): SiteDue[] {
  const map = new Map<string, SiteDue>();
  for (const d of devices) {
    if (!d.site_id) continue;
    const b = bucketFor(d.next_maintenance_at, today, horizonDays);
    const s = map.get(d.site_id) ?? { siteId: d.site_id, overdue: 0, today: 0, upcoming: 0, openFaults: faultsBySite[d.site_id] ?? 0, earliest: null };
    if (b === "overdue") s.overdue++;
    else if (b === "today") s.today++;
    else if (b === "upcoming") s.upcoming++;
    if (d.next_maintenance_at && (!s.earliest || d.next_maintenance_at < s.earliest)) s.earliest = d.next_maintenance_at.slice(0, 10);
    map.set(d.site_id, s);
  }
  for (const [siteId, n] of Object.entries(faultsBySite)) if (!map.has(siteId)) map.set(siteId, { siteId, overdue: 0, today: 0, upcoming: 0, openFaults: n, earliest: null });
  return [...map.values()].filter((s) => s.overdue + s.today + s.upcoming + s.openFaults > 0)
    .sort((a, b) => b.overdue - a.overdue || b.today - a.today || (a.earliest ?? "9999").localeCompare(b.earliest ?? "9999"));
}

/** فلترة نصية بسيطة (بلا حساسية لحالة الأحرف وللمسافات الزائدة) */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(n));
}

/** حدود الفترة لفلتر «الفترة» (تاريخ بداية شامل) */
export function periodStart(period: string, today: string): string | null {
  switch (period) {
    case "7": return addDays(today, -7);
    case "30": return addDays(today, -30);
    case "90": return addDays(today, -90);
    case "365": return addDays(today, -365);
    default: return null;
  }
}

// ---------------------------------------------------------------------
// الخط الزمني للجهاز
// ---------------------------------------------------------------------
export interface TimelineEvent { at: string; kind: string; title: string; detail?: string | null; href?: string | null; tone?: string }

/** دمج أحداث من مصادر مختلفة، الأحدث أولًا؛ التعادل يُحسم بترتيب الإدخال الثابت */
export function mergeTimeline(...groups: TimelineEvent[][]): TimelineEvent[] {
  return groups.flat().map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.at > a.e.at ? 1 : b.e.at < a.e.at ? -1 : a.i - b.i)).map((x) => x.e);
}
