import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, input, label as labelCls, link } from "@/components/ui/styles";
import { Suspense } from "react";
import { requireOrg } from "@/lib/auth/context";
import { logLoadError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { hasInspections, hasPhase5, hasWorkOrderExecution } from "@/lib/schema";
import { isUuid, param, withParams, type SearchParams } from "@/lib/list";
import { addDaysISO, daysUntil, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { faultSeverity, faultStatus, visitOutcome, visitStatus, visitType, workOrderPriority, workOrderStatus, workOrderType } from "@/lib/labels";
import { URGENT_REASONS, bucketFor, groupDueBySite, matchesQuery, periodStart, progressPercent } from "@/lib/visits";
import StartVisitButton from "./StartVisitButton";
import StartWoVisitButton from "./StartWoVisitButton";

export const metadata: Metadata = { title: "عملي | عين السلامة" };

const HORIZON = 14;
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

function Stat({ n, label, tone, href }: { n: number; label: string; tone: string; href: string }) {
  return (
    <a href={href} className={`${card} block p-4 hover:border-brand`}>
      <p className={`text-2xl font-bold ${tone}`}>{n}</p><p className="text-xs text-slate-600">{label}</p>
    </a>
  );
}

/**
 * «عملي»: القسم الرئيسي للفني (دمج «عملي» و«مهامي»). كل ما يظهر مقيَّد في القاعدة (RLS) بنطاق إسناده
 * (العميل كاملًا أو مواقع محددة) وبالزيارات وأوامر العمل المعيَّن لها؛ لا يُعتمد على إخفاء عناصر الواجهة.
 * الفلاتر والبحث في الرابط (GET) فتعمل دون JavaScript وتُحفظ عند المشاركة أو التحديث.
 */
export default function MyWorkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // الهيكل الثابت (العنوان) يُعرض فورًا؛ بيانات المستخدم غير المخزنة (الجلسة، الفلاتر، الزيارات) تتدفق داخل Suspense
  // وفق Cache Components. لا "use cache" هنا: البيانات خاصة بكل مستخدم ومقيدة بنطاقه في القاعدة.
  return (
    <div className="space-y-6">
      <PageHeader title="عملي" description="الزيارات الدورية المستحقة والمتأخرة، والزيارات المفتوحة والمجدولة، والبلاغات والمتابعات، وسجل زياراتك — ضمن نطاق إسنادك فقط."
        actions={<Link href="/scan" className={btnSecondary}>مسح رمز جهاز</Link>} />
      <Suspense fallback={<MyWorkLoading />}>
        <MyWorkContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function MyWorkLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="جارٍ تحميل عملي">
      <div className={`${card} h-40 animate-pulse bg-slate-100 motion-reduce:animate-none`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${card} h-20 animate-pulse bg-slate-100 motion-reduce:animate-none`} />)}
      </div>
      <div className={`${card} h-56 animate-pulse bg-slate-100 motion-reduce:animate-none`} />
      <p className="sr-only">جارٍ التحميل...</p>
    </div>
  );
}

async function MyWorkContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("field.assigned", "visits.create");
  const sp = await searchParams;
  const supabase = await createClient();
  const org = ctx.orgId;
  const today = todayISO();
  const f = {
    q: param(sp, "q"), customer: isUuid(param(sp, "customer")) ? param(sp, "customer") : "", site: isUuid(param(sp, "site")) ? param(sp, "site") : "",
    type: ["periodic", "urgent"].includes(param(sp, "type")) ? param(sp, "type") : "", status: ["open", "closed"].includes(param(sp, "status")) ? param(sp, "status") : "",
    period: ["7", "30", "90", "365"].includes(param(sp, "period")) ? param(sp, "period") : "30",
  };
  const [phase5, inspections, woExec] = await Promise.all([hasPhase5(supabase), hasInspections(supabase), hasWorkOrderExecution(supabase)]);
  const since = periodStart(f.period, today);

  const visitCols = "id, ref_no, scheduled_start, actual_start, actual_end, status, customer_id, site_id, customer:customers(name), site:customer_sites(name)"
    + (phase5 ? ", visit_type, outcome" : "") + (inspections ? ", urgent_reason, closed_at, items:visit_devices(inspection_status, result)" : ", records:maintenance_records(count)");
  let openQ = supabase.from("visits").select(visitCols).eq("company_id", org).is("archived_at", null).in("status", ["scheduled", "in_progress"])
    .order("scheduled_start").limit(100);
  let histQ = supabase.from("visits").select(visitCols).eq("company_id", org).is("archived_at", null).in("status", ["completed", "missed", "cancelled"])
    .order("scheduled_start", { ascending: false }).limit(40);
  if (since) histQ = histQ.gte("scheduled_start", `${since}T00:00:00+03:00`);
  if (f.customer) { openQ = openQ.eq("customer_id", f.customer); histQ = histQ.eq("customer_id", f.customer); }
  if (f.site) { openQ = openQ.eq("site_id", f.site); histQ = histQ.eq("site_id", f.site); }
  if (phase5 && f.type === "periodic") { openQ = openQ.eq("visit_type", "periodic"); histQ = histQ.eq("visit_type", "periodic"); }
  if (phase5 && f.type === "urgent") { openQ = openQ.neq("visit_type", "periodic"); histQ = histQ.neq("visit_type", "periodic"); }

  const faultCols = "id, ref_no, description, status, severity, reported_at, site_id, customer_id, device:devices(id, name, ref_no), site:customer_sites(name)"
    + (inspections ? ", kind, follow_up_due, assigned_technician_id, assignee:technicians!df_assignee_fk(full_name)" : "");
  const [sites, due, open, hist, faults, wos, me] = await Promise.all([
    supabase.from("customer_sites").select("id, name, customer_id, customer:customers(name)").eq("company_id", org).is("archived_at", null).order("name").limit(500),
    supabase.from("devices").select("id, ref_no, name, status, next_maintenance_at, site_id, customer_id")
      .eq("company_id", org).is("archived_at", null).not("status", "in", "(decommissioned,replaced)").lte("next_maintenance_at", addDaysISO(today, HORIZON))
      .order("next_maintenance_at").limit(1000),
    f.status === "closed" ? null : openQ,
    f.status === "open" ? null : histQ,
    phase5 ? supabase.from("device_faults").select(faultCols).eq("company_id", org).is("archived_at", null)
      .in("status", ["open", "in_progress", "awaiting_verification"]).order("reported_at", { ascending: false }).limit(60) : null,
    supabase.from("work_orders").select("id, ref_no, title, description, status, priority, order_type, due_at, scheduled_for, customer_id, site_id, customer:customers(name), site:customer_sites(name), devices:work_order_devices(device:devices(name)), techs:work_order_technicians(technician_id), visits(id, status, closed_at, archived_at)")
      .eq("company_id", org).is("archived_at", null).in("status", ["new", "scheduled", "in_progress", "on_hold"]).order("due_at", { nullsFirst: false }).limit(30),
    supabase.from("technicians").select("id").eq("company_id", org).eq("user_id", ctx.user.id).is("archived_at", null).limit(1).maybeSingle(),
  ]);

  // السبب الحقيقي لكل فشل تحميل في سجل الخادم، والرمز بجانب رسالة التعذر في الصفحة
  const err = {
    open: logLoadError("my-work/open-visits", open?.error), hist: logLoadError("my-work/visit-history", hist?.error),
    faults: logLoadError("my-work/faults", faults?.error), due: logLoadError("my-work/due-devices", due.error),
    sites: logLoadError("my-work/sites", sites.error), wos: logLoadError("my-work/work-orders", wos.error), me: logLoadError("my-work/technician", me.error),
  };
  const loadNotes = [sites.error && `المواقع${err.sites}`, wos.error && `أوامر العمل${err.wos}`, me.error && `سجل الفني${err.me}`].filter(Boolean) as string[];
  type S = { id: string; name: string; customer_id: string; customer: { name: string } | null };
  type D = { id: string; ref_no: string; name: string; status: string; next_maintenance_at: string | null; site_id: string | null; customer_id: string };
  type V = { id: string; ref_no: string; scheduled_start: string; actual_start: string | null; actual_end: string | null; status: string; customer_id: string; site_id: string | null;
    customer: { name: string } | null; site: { name: string } | null; visit_type?: string; outcome?: string | null; urgent_reason?: string | null; closed_at?: string | null;
    items?: { inspection_status: string; result: string | null }[]; records?: { count: number }[] };
  type Fl = { id: string; ref_no: string; description: string; status: string; severity: string; reported_at: string; site_id: string | null; customer_id: string;
    device: { id: string; name: string; ref_no: string } | null; site: { name: string } | null; kind?: string; follow_up_due?: string | null; assigned_technician_id?: string | null; assignee?: { full_name: string } | null };
  const siteList = (sites.data ?? []) as unknown as S[];
  const siteById = new Map(siteList.map((s) => [s.id, s]));
  const customers = [...new Map(siteList.map((s) => [s.customer_id, s.customer?.name ?? "—"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  const inScope = (customerId: string, siteId: string | null) => (!f.customer || customerId === f.customer) && (!f.site || siteId === f.site);
  const siteText = (siteId: string | null) => { const s = siteId ? siteById.get(siteId) : null; return s ? `${s.customer?.name ?? ""} ${s.name}` : ""; };

  const devices = ((due.data ?? []) as D[]).filter((d) => inScope(d.customer_id, d.site_id) && matchesQuery(f.q, d.name, d.ref_no, siteText(d.site_id)));
  const faultList = ((faults?.data ?? []) as unknown as Fl[]).filter((x) => inScope(x.customer_id, x.site_id)
    && matchesQuery(f.q, x.ref_no, x.description, x.device?.name, x.device?.ref_no, x.site?.name));
  const myTech = (me.data as { id: string } | null)?.id ?? null;
  const faultsBySite: Record<string, number> = {};
  for (const x of faultList) if (x.site_id) faultsBySite[x.site_id] = (faultsBySite[x.site_id] ?? 0) + 1;
  // الأجهزة والبلاغات مصفّاة بالبحث مسبقًا، فلا يظهر إلا موقع فيه عمل مطابق
  const siteCards = f.type === "urgent" || f.status === "closed" ? [] : groupDueBySite(devices, faultsBySite, today, HORIZON);
  const vMatch = (v: V) => matchesQuery(f.q, v.ref_no, v.customer?.name, v.site?.name);
  const openVisits = ((open?.data ?? []) as unknown as V[]).filter(vMatch);
  const history = ((hist?.data ?? []) as unknown as V[]).filter(vMatch);
  const openBySite = new Map(openVisits.filter((v) => (v.visit_type ?? "periodic") === "periodic" && v.site_id).map((v) => [v.site_id!, v]));
  type WO = { id: string; ref_no: string; title: string; description: string | null; status: string; priority: string; order_type: string; due_at: string | null;
    scheduled_for: string | null; customer_id: string; site_id: string | null; customer: { name: string } | null; site: { name: string } | null;
    devices: { device: { name: string } | null }[] | null; techs: { technician_id: string }[] | null;
    visits: { id: string; status: string; closed_at?: string | null; archived_at: string | null }[] | null };
  const woList = ((wos.data ?? []) as unknown as WO[])
    .filter((w) => f.type !== "periodic" && f.status !== "closed" && inScope(w.customer_id, w.site_id) && matchesQuery(f.q, w.ref_no, w.title, w.customer?.name, w.site?.name))
    // المسند إليك أولًا ثم الأعلى أولوية
    .sort((a, b) => Number((b.techs ?? []).some((t) => t.technician_id === myTech)) - Number((a.techs ?? []).some((t) => t.technician_id === myTech))
      || ["critical", "high", "medium", "low"].indexOf(a.priority) - ["critical", "high", "medium", "low"].indexOf(b.priority));

  const counts = {
    overdue: devices.filter((d) => bucketFor(d.next_maintenance_at, today, HORIZON) === "overdue").length,
    today: devices.filter((d) => bucketFor(d.next_maintenance_at, today, HORIZON) === "today").length,
    upcoming: devices.filter((d) => bucketFor(d.next_maintenance_at, today, HORIZON) === "upcoming").length,
    drafts: openVisits.filter((v) => v.status === "in_progress").length,
    faults: faultList.length, mine: faultList.filter((x) => myTech && x.assigned_technician_id === myTech).length,
    closed: history.filter((v) => v.status === "completed").length,
  };
  const progress = (v: V) => {
    if (!v.items) return null;
    const done = v.items.filter((i) => i.inspection_status !== "pending").length;
    return { done, total: v.items.length, pct: progressPercent(done, v.items.length) };
  };
  const isUrgent = (v: V) => (v.visit_type ?? "periodic") !== "periodic";
  const canStart = inspections && ctx.canAny("visits.create", "visits.update");
  const clear = Object.values({ ...f, period: f.period === "30" ? "" : f.period }).some(Boolean);

  const VisitRow = ({ v }: { v: V }) => {
    const p = progress(v);
    const urgent = isUrgent(v);
    const late = v.status === "scheduled" && v.scheduled_start.slice(0, 10) < today;
    return (
      <li className={`flex flex-wrap items-center justify-between gap-3 border-s-4 px-5 py-3 text-sm ${urgent ? "border-danger" : late ? "border-amber-500" : "border-sky-500"}`}>
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/visits/${v.id}`} className={link}>{v.site?.name ?? v.customer?.name ?? "—"}</Link>
            <StatusBadge label={urgent ? `طارئة${v.urgent_reason ? ` · ${URGENT_REASONS[v.urgent_reason] ?? ""}` : ""}` : visitType[v.visit_type ?? "periodic"] ?? "دورية"} tone={urgent ? "danger" : "info"} />
            {late && <StatusBadge label="موعدها فات" tone="warning" />}
          </p>
          <p className="text-xs text-slate-500">{v.customer?.name ?? "—"} · <span dir="ltr">{v.ref_no}</span> · {formatDateTime(v.actual_start ?? v.scheduled_start)}</p>
          {p && p.total > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand" style={{ width: `${p.pct}%` }} /></div>
              {p.done}/{p.total} جهاز
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} />
          {inspections && ctx.can("visits.update") && <Link href={`/visits/${v.id}/run`} className={`${btnPrimary} ${btnSm}`}>{v.status === "in_progress" ? "استئناف" : "بدء التنفيذ"}</Link>}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {inspections && (
        <div className="flex flex-wrap gap-2">
          <Link href="/my-work/urgent" className={btnPrimary}>+ زيارة طارئة</Link>
        </div>
      )}
      {loadNotes.length > 0 && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          تعذر تحميل جزء من البيانات ({loadNotes.join("، ")}). القوائم المتأثرة قد تكون ناقصة؛ أعد تحميل الصفحة بعد لحظات.
        </p>
      )}

      {!inspections && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          العرض أدناه من البيانات الحالية. تنفيذ الزيارة جهازًا جهازًا (بدء الزيارة الدورية والطارئة، المسودات، الإغلاق والتقرير الموحد) يتطلب تطبيق ترحيل قاعدة البيانات المقترح 20261106000100 بموافقة مدير المنصة.
        </p>
      )}

      <form method="get" className={`${card} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6`} role="search" aria-label="تصفية عملي">
        <div className="sm:col-span-2">
          <label htmlFor="mw-q" className={labelCls}>بحث سريع</label>
          <input id="mw-q" name="q" defaultValue={f.q} placeholder="جهاز، رقم، عميل، موقع، بلاغ..." className={input} />
        </div>
        <div>
          <label htmlFor="mw-c" className={labelCls}>العميل</label>
          <select id="mw-c" name="customer" defaultValue={f.customer} className={input}>
            <option value="">الكل</option>{customers.map(([cid, name]) => <option key={cid} value={cid}>{name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mw-s" className={labelCls}>الموقع</label>
          <select id="mw-s" name="site" defaultValue={f.site} className={input}>
            <option value="">الكل</option>
            {siteList.filter((s) => !f.customer || s.customer_id === f.customer).map((s) => <option key={s.id} value={s.id}>{s.name}{f.customer ? "" : ` — ${s.customer?.name ?? ""}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mw-t" className={labelCls}>نوع الزيارة</label>
          <select id="mw-t" name="type" defaultValue={f.type} className={input}>
            <option value="">الكل</option><option value="periodic">دورية</option><option value="urgent">طارئة / إصلاح</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="mw-st" className={labelCls}>الحالة</label>
            <select id="mw-st" name="status" defaultValue={f.status} className={input}>
              <option value="">الكل</option><option value="open">مفتوحة</option><option value="closed">منتهية</option>
            </select>
          </div>
          <div>
            <label htmlFor="mw-p" className={labelCls}>الفترة</label>
            <select id="mw-p" name="period" defaultValue={f.period} className={input}>
              <option value="7">7 أيام</option><option value="30">30 يومًا</option><option value="90">90 يومًا</option><option value="365">سنة</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className={btnPrimary}>تطبيق</button>
          {clear && <Link href="/my-work" className={btnSecondary}>مسح الفلاتر</Link>}
          <p className="self-center text-xs text-slate-500">الفترة تخص سجل الزيارات السابقة؛ المستحق والمتأخر يُعرض دائمًا حتى {HORIZON} يومًا قادمة.</p>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat n={counts.overdue} label="أجهزة متأخرة" tone="text-danger" href="#periodic" />
        <Stat n={counts.today} label="مستحقة اليوم" tone="text-amber-700" href="#periodic" />
        <Stat n={counts.upcoming} label={`قادمة خلال ${HORIZON} يومًا`} tone="text-sky-700" href="#periodic" />
        <Stat n={counts.drafts} label="زيارات قيد التنفيذ" tone="text-brand-strong" href="#open" />
        <Stat n={counts.faults} label={counts.mine ? `بلاغات ومتابعات (لك ${counts.mine})` : "بلاغات ومتابعات"} tone="text-danger" href="#faults" />
        <Stat n={counts.closed} label="زيارات منتهية في الفترة" tone="text-success" href="#history" />
      </div>

      {f.status !== "closed" && (
        <section id="open" className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>زيارات مفتوحة ومجدولة ({openVisits.length})</h2>
            <span className="text-xs text-slate-500">الطارئة بإطار أحمر · المجدولة الفائتة بإطار برتقالي</span></div>
          <ul className="divide-y divide-slate-100">
            {openVisits.map((v) => <VisitRow key={v.id} v={v} />)}
            {open?.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل الزيارات المفتوحة حاليًا{err.open}.</li>
              : openVisits.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد زيارات مفتوحة أو مجدولة.</li>}
          </ul>
        </section>
      )}

      {f.type !== "urgent" && f.status !== "closed" ? (
        <section id="periodic" className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الصيانة الدورية المستحقة حسب الموقع ({siteCards.length})</h2>
            <span className="text-xs text-slate-500">زيارة دورية واحدة للموقع تشمل كل أجهزته النشطة</span></div>
          <ul className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {siteCards.map((s) => {
              const site = siteById.get(s.siteId);
              const openV = openBySite.get(s.siteId);
              const list = devices.filter((d) => d.site_id === s.siteId);
              const tone = s.overdue ? "border-danger" : s.today ? "border-amber-500" : "border-sky-500";
              return (
                <li key={s.siteId} className={`rounded-xl border border-s-4 border-slate-200 bg-white p-4 ${tone}`}>
                  <p className="font-bold">{site ? <Link href={`/sites/${s.siteId}`} className={link}>{site.name}</Link> : "موقع"}</p>
                  <p className="text-xs text-slate-500">{site?.customer?.name ?? "—"}{s.earliest && ` · أقدم استحقاق ${formatDate(s.earliest)}`}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.overdue > 0 && <StatusBadge label={`متأخر ${s.overdue}`} tone="danger" />}
                    {s.today > 0 && <StatusBadge label={`اليوم ${s.today}`} tone="warning" />}
                    {s.upcoming > 0 && <StatusBadge label={`قادم ${s.upcoming}`} tone="info" />}
                    {s.openFaults > 0 && <StatusBadge label={`بلاغ مفتوح ${s.openFaults}`} tone="danger" />}
                  </div>
                  {list.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-slate-600">الأجهزة ({list.length})</summary>
                      <ul className="mt-1 space-y-0.5">
                        {list.map((d) => {
                          const n = daysUntil(d.next_maintenance_at);
                          return <li key={d.id}><Link href={`/devices/${d.id}`} className="underline">{d.name}</Link>{" "}
                            <span className={n !== null && n < 0 ? "text-danger" : "text-slate-500"}>{n === null ? "" : n < 0 ? `متأخر ${-n} يوم` : n === 0 ? "اليوم" : `بعد ${n} يوم`}</span></li>;
                        })}
                      </ul>
                    </details>
                  )}
                  <div className="mt-3">
                    {openV ? <Link href={`/visits/${openV.id}/run`} className={`${btnPrimary} ${btnSm}`}>استئناف الزيارة الدورية</Link>
                      : canStart ? <StartVisitButton siteId={s.siteId} clientKey={crypto.randomUUID()} label="بدء الزيارة الدورية" className={`${btnPrimary} ${btnSm}`} /> : null}
                  </div>
                </li>
              );
            })}
            {due.error ? <li role="alert" className="text-sm text-red-700">تعذر تحميل الاستحقاقات حاليًا{err.due}.</li>
              : siteCards.length === 0 && <li className="text-sm text-slate-500">لا توجد صيانة دورية متأخرة أو مستحقة خلال {HORIZON} يومًا ضمن الفلاتر الحالية.</li>}
          </ul>
        </section>
      ) : null}

      {phase5 && f.type !== "periodic" && f.status !== "closed" && (
        <section id="faults" className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>البلاغات والمتابعات المفتوحة ({faultList.length})</h2><Link href="/faults" className={`${link} text-xs`}>كل البلاغات</Link></div>
          <ul className="divide-y divide-slate-100">
            {faultList.map((x) => {
              const late = x.follow_up_due && x.follow_up_due < today;
              const mine = myTech && x.assigned_technician_id === myTech;
              return (
                <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 border-s-4 px-5 py-3 text-sm ${x.severity === "critical" || x.severity === "high" ? "border-danger" : "border-amber-400"}`}>
                  <div className="min-w-0">
                    <p><Link href={`/faults/${x.id}`} className={link}>{x.ref_no}</Link> · {x.device ? <Link href={`/devices/${x.device.id}`} className="underline">{x.device.name}</Link> : "—"}
                      {x.kind && x.kind !== "fault" && <span className="text-xs text-slate-500"> · {x.kind === "follow_up" ? "متابعة" : "طلب إصلاح"}</span>}</p>
                    <p className="truncate text-xs text-slate-500">{x.site?.name ?? "—"} · {x.description}</p>
                    {(x.assignee || x.follow_up_due) && <p className={`text-xs ${late ? "font-semibold text-danger" : "text-slate-600"}`}>
                      {x.assignee && `المسؤول: ${x.assignee.full_name}${mine ? " (أنت)" : ""}`}{x.follow_up_due && ` · الموعد ${formatDate(x.follow_up_due)}${late ? " (متأخر)" : ""}`}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge {...(faultSeverity[x.severity] ?? { label: x.severity, tone: "neutral" as Tone })} />
                    <StatusBadge {...(faultStatus[x.status] ?? { label: x.status, tone: "neutral" as Tone })} />
                    {inspections && x.device && x.site_id && <Link href={`/my-work/urgent?site=${x.site_id}&device=${x.device.id}&reason=${x.kind === "follow_up" ? "follow_up" : "fault"}`} className={`${btnSecondary} ${btnSm}`}>زيارة طارئة</Link>}
                  </div>
                </li>
              );
            })}
            {faults?.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل البلاغات حاليًا{err.faults}.</li>
              : faultList.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد بلاغات أو متابعات مفتوحة.</li>}
          </ul>
        </section>
      )}

      {(woList.length > 0 || wos.error) && (
        <section id="work-orders" className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>أوامر العمل ({woList.length})</h2>
            <span className="text-xs text-slate-500">المسندة إليك أولًا · الطارئة بإطار أحمر</span></div>
          <ul className="divide-y divide-slate-100">
            {woList.map((w) => {
              const mine = !!myTech && (w.techs ?? []).some((t) => t.technician_id === myTech);
              const openV = (w.visits ?? []).find((x) => !x.archived_at && !x.closed_at && ["scheduled", "in_progress"].includes(x.status));
              const devs = (w.devices ?? []).map((d) => d.device?.name).filter(Boolean) as string[];
              const urgentWo = w.order_type === "emergency" || w.priority === "critical" || w.priority === "high";
              return (
                <li key={w.id} className={`flex flex-wrap items-start justify-between gap-3 border-s-4 px-5 py-3 text-sm ${urgentWo ? "border-danger" : "border-slate-300"}`}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2"><Link href={`/work-orders/${w.id}`} className={link}>{w.title}</Link>
                      {mine && <StatusBadge label="مسند إليك" tone="info" />}</p>
                    <p className="text-xs text-slate-500">{workOrderType[w.order_type] ?? w.order_type} · {w.customer?.name ?? "—"}{w.site ? ` · ${w.site.name}` : " · بلا موقع"} · <span dir="ltr">{w.ref_no}</span>
                      {w.scheduled_for && ` · الموعد ${formatDateTime(w.scheduled_for)}`}{w.due_at && ` · الاستحقاق ${formatDate(w.due_at)}`}</p>
                    {devs.length > 0 && <p className="text-xs text-slate-600">الأجهزة: {devs.slice(0, 5).join("، ")}{devs.length > 5 ? ` و${devs.length - 5} أخرى` : ""}</p>}
                    {w.description && <p className="line-clamp-2 text-xs text-slate-600">{w.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge {...(workOrderPriority[w.priority] ?? { label: w.priority, tone: "neutral" as Tone })} />
                    <StatusBadge {...(workOrderStatus[w.status] ?? { label: w.status, tone: "neutral" as Tone })} />
                    {woExec && openV ? <Link href={`/visits/${openV.id}/run`} className={`${btnPrimary} ${btnSm}`}>متابعة الزيارة</Link>
                      : woExec && w.site_id && (mine || ctx.can("visits.create")) ? <StartWoVisitButton workOrderId={w.id} clientKey={crypto.randomUUID()} className={`${btnPrimary} ${btnSm}`} /> : null}
                  </div>
                </li>
              );
            })}
            {wos.error && <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل أوامر العمل حاليًا{err.wos}.</li>}
          </ul>
        </section>
      )}

      {f.status !== "open" && (
        <section id="history" className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>سجل الزيارات السابقة ({history.length})</h2>
            {ctx.can("reports.view") && <Link href={withParams("/reports/visits", {}, { customer: f.customer || null, site: f.site || null, from: since })} className={`${link} text-xs`}>السجل الكامل</Link>}</div>
          <ul className="divide-y divide-slate-100">
            {history.map((v) => {
              const items = v.items ?? [];
              const inspected = items.filter((i) => i.inspection_status === "inspected").length;
              const fails = items.filter((i) => i.result === "fail").length;
              const recs = v.records?.[0]?.count;
              return (
                <li key={v.id} className={`flex flex-wrap items-center justify-between gap-2 border-s-4 px-5 py-3 text-sm ${isUrgent(v) ? "border-danger/60" : "border-slate-200"}`}>
                  <div>
                    <Link href={`/visits/${v.id}`} className={link}>{v.site?.name ?? v.customer?.name ?? "—"}</Link>
                    <span className="text-xs text-slate-500"> · {isUrgent(v) ? "طارئة" : "دورية"} · <span dir="ltr">{v.ref_no}</span></span>
                    <p className="text-xs text-slate-500">{formatDateTime(v.actual_end ?? v.scheduled_start)} · {v.items ? `فُحص ${inspected} من ${items.length}${fails ? ` · غير سليم ${fails}` : ""}` : `سجلات صيانة ${recs ?? 0}`}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {v.outcome ? <StatusBadge {...(visitOutcome[v.outcome] ?? { label: v.outcome, tone: "neutral" as Tone })} /> : <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" as Tone })} />}
                    <Link href={`/print/visit/${v.id}`} className={`${btnSecondary} ${btnSm}`}>التقرير</Link>
                  </div>
                </li>
              );
            })}
            {hist?.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل السجل حاليًا{err.hist}.</li>
              : history.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد زيارات منتهية في الفترة المحددة.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
