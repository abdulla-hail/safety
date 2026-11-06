import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilterField } from "@/components/ui/FilterBar";
import type { Permission } from "@/lib/permissions";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { addDaysISO, formatDate, formatDateTime, todayISO } from "@/lib/format";
import {
  TECHNICIAN_SPECIALTIES, companyMemberStatus, companyRole, customerType, deviceStatus, faultSeverity, faultStatus, maintenanceAction,
  maintenanceKind, maintenanceResult, companyStatus, technicianAvailability, toOptions, visitOutcome, visitStatus, visitType,
  workOrderPriority, workOrderStatus, workOrderType,
} from "@/lib/labels";
import { archiveScope, isUuid, orIlike, param, type SearchParams } from "@/lib/list";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import { INSPECTION_STATUS, partsText, type Part } from "@/lib/visits";

type Row = Record<string, unknown>;
type Range = [number, number] | null;
interface Result { data: Row[] | null; count: number | null; error: { code?: string } | null }

export interface ReportColumn {
  key: string;
  label: string;
  value: (r: Row) => string | number | null;
  /** رابط اختياري للخلية في العرض على الشاشة */
  href?: (r: Row) => string | null;
}

export interface ReportContext {
  sb: SupabaseClient;
  orgId: string;
  sp: SearchParams;
  range: Range;
}

export interface ReportDef {
  slug: string;
  title: string;
  description: string;
  /** يلزم واحدة منها على الأقل إضافة إلى reports.view */
  needs: Permission[];
  platformOnly?: boolean;
  archiveFilter?: boolean;
  filters: (c: { sb: SupabaseClient; orgId: string }) => Promise<FilterField[]>;
  columns: ReportColumn[];
  fetch: (c: ReportContext) => Promise<Result>;
  summary?: (c: ReportContext) => Promise<[string, string | number][]>;
}

interface ArchivedQuery extends PromiseLike<Result> {
  eq(c: string, v: string): ArchivedQuery;
  not(c: string, op: string, v: null): ArchivedQuery;
  order(c: string, o: object): ArchivedQuery;
  range(a: number, b: number): ArchivedQuery;
}

/** يطبّق ترقيم الصفحات من قاعدة البيانات؛ الأنواع مُبسطة لتفادي تعقيد أنواع منشئ الاستعلام */
function ranged(query: unknown, r: Range): PromiseLike<Result> {
  const q = query as { range(from: number, to: number): unknown };
  return (r ? q.range(r[0], r[1]) : q) as PromiseLike<Result>;
}
function scoped<T extends { is(c: string, v: null): T; not(c: string, op: string, v: null): T }>(q: T, sp: SearchParams): T {
  const s = archiveScope(sp);
  if (s === "active") return q.is("archived_at", null);
  if (s === "archived") return q.not("archived_at", "is", null);
  return q;
}
const rel = (r: Row, k: string, f = "name") => ((r[k] as Row | null)?.[f] as string | undefined) ?? "";
const cnt = (r: Row, k: string) => ((r[k] as { count: number }[] | undefined)?.[0]?.count ?? 0);
const dateFrom = (sp: SearchParams) => param(sp, "from") ? `${param(sp, "from")}T00:00:00+03:00` : null;
const dateTo = (sp: SearchParams) => param(sp, "to") ? `${param(sp, "to")}T23:59:59+03:00` : null;
const label = (m: Record<string, { label: string }>, v: unknown) => m[String(v)]?.label ?? String(v ?? "");
const DATES: FilterField[] = [{ name: "from", label: "من تاريخ", type: "date" }, { name: "to", label: "إلى تاريخ", type: "date" }];

async function systemOptions(sb: SupabaseClient, orgId: string) {
  const { data } = await sb.from("safety_systems").select("id, name").eq("company_id", orgId).order("sort_order");
  return (data ?? []).map((s) => ({ value: s.id as string, label: s.name as string }));
}
async function techOptions(sb: SupabaseClient, orgId: string) {
  const { data } = await sb.from("technicians").select("id, full_name").eq("company_id", orgId).is("archived_at", null).order("full_name");
  return (data ?? []).map((s) => ({ value: s.id as string, label: s.full_name as string }));
}

export const REPORTS: ReportDef[] = [
  {
    slug: "customers", title: "تقرير العملاء", description: "العملاء مع عدد المواقع والأجهزة والمتأخر منها والفنيين المسندين.",
    needs: ["customers.view"], archiveFilter: true,
    filters: async () => [
      { name: "type", label: "النوع", type: "select", options: toOptions(customerType) },
      { name: "status", label: "الحالة", type: "select", options: [{ value: "active", label: "نشط" }, { value: "inactive", label: "غير نشط" }] },
      { name: "city", label: "المدينة" },
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/customers/${r.customer_id}` },
      { key: "name", label: "العميل", value: (r) => r.name as string },
      { key: "city", label: "المدينة", value: (r) => (r.city as string) ?? "" },
      { key: "sites", label: "المواقع", value: (r) => r.site_count as number },
      { key: "devices", label: "الأجهزة", value: (r) => r.device_count as number },
      { key: "overdue", label: "صيانة متأخرة", value: (r) => r.overdue_count as number },
      { key: "techs", label: "الفنيون", value: (r) => r.technician_count as number },
      { key: "status", label: "الحالة", value: (r) => (r.archived_at ? "مؤرشف" : r.is_active ? "نشط" : "غير نشط") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("report_customer_summary").select("*", { count: "exact" }).eq("company_id", orgId).order("name");
      q = scoped(q, sp);
      const s = orIlike(["name", "ref_no", "city"], param(sp, "q"));
      if (s) q = q.or(s);
      if (param(sp, "city")) q = q.ilike("city", `%${param(sp, "city").replace(/[%_,()]/g, "")}%`);
      if (param(sp, "status")) q = q.eq("is_active", param(sp, "status") === "active");
      if (param(sp, "type")) {
        const { data } = await sb.from("customers").select("id").eq("company_id", orgId).eq("customer_type", param(sp, "type")).limit(5000);
        q = q.in("customer_id", (data ?? []).map((x) => x.id));
      }
      return ranged(q, range);
    },
  },
  {
    slug: "sites", title: "تقرير مواقع العملاء", description: "جميع المواقع والفروع مع العميل وعدد الأجهزة.",
    needs: ["sites.view"], archiveFilter: true,
    filters: async () => [{ name: "city", label: "المدينة" }],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/sites/${r.id}` },
      { key: "name", label: "الموقع", value: (r) => r.name as string },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "city", label: "المدينة", value: (r) => (r.city as string) ?? "" },
      { key: "contact", label: "المسؤول", value: (r) => (r.contact_name as string) ?? "" },
      { key: "devices", label: "الأجهزة", value: (r) => cnt(r, "devices") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("customer_sites").select("id, ref_no, name, city, contact_name, archived_at, customer:customers(name), devices(count)", { count: "exact" }).eq("company_id", orgId).order("ref_no");
      q = scoped(q, sp);
      const s = orIlike(["name", "ref_no", "city"], param(sp, "q"));
      if (s) q = q.or(s);
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (param(sp, "city")) q = q.ilike("city", `%${param(sp, "city").replace(/[%_,()]/g, "")}%`);
      return ranged(q, range);
    },
  },
  {
    slug: "technicians", title: "تقرير الفنيين", description: "الفنيون وتخصصاتهم وحالتهم وعدد العملاء المسندين.",
    needs: ["technicians.view"], archiveFilter: true,
    filters: async () => [
      { name: "availability", label: "التوفر", type: "select", options: toOptions(technicianAvailability) },
      { name: "specialty", label: "التخصص", type: "select", options: toOptions(TECHNICIAN_SPECIALTIES) },
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/technicians/${r.id}` },
      { key: "name", label: "الفني", value: (r) => r.full_name as string },
      { key: "phone", label: "الجوال", value: (r) => (r.phone as string) ?? "" },
      { key: "spec", label: "التخصصات", value: (r) => ((r.specialties as string[]) ?? []).map((x) => TECHNICIAN_SPECIALTIES[x] ?? x).join("، ") },
      { key: "customers", label: "العملاء المسندون", value: (r) => cnt(r, "customers") },
      { key: "status", label: "الحالة", value: (r) => (r.is_active ? label(technicianAvailability, r.availability) : "غير نشط") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("technicians").select("id, ref_no, full_name, phone, specialties, availability, is_active, archived_at, customers:technician_customers(count)", { count: "exact" }).eq("company_id", orgId).order("full_name");
      q = scoped(q, sp);
      const s = orIlike(["full_name", "ref_no", "phone"], param(sp, "q"));
      if (s) q = q.or(s);
      if (param(sp, "availability")) q = q.eq("availability", param(sp, "availability"));
      if (param(sp, "specialty")) q = q.contains("specialties", [param(sp, "specialty")]);
      return ranged(q, range);
    },
  },
  {
    slug: "assignments", title: "تقرير الفنيين والعملاء المسندين", description: "علاقات الإسناد بين الفنيين والعملاء.",
    needs: ["assignments.manage", "technicians.view"],
    filters: async ({ sb, orgId }) => [{ name: "technician", label: "الفني", type: "select", options: await techOptions(sb, orgId) }],
    columns: [
      { key: "tech", label: "الفني", value: (r) => rel(r, "technician", "full_name"), href: (r) => `/technicians/${r.technician_id}` },
      { key: "techref", label: "رقم الفني", value: (r) => rel(r, "technician", "ref_no") },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer"), href: (r) => `/customers/${r.customer_id}` },
      { key: "custref", label: "رقم العميل", value: (r) => rel(r, "customer", "ref_no") },
      { key: "since", label: "تاريخ الإسناد", value: (r) => formatDate(r.created_at as string) },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("technician_customers").select("technician_id, customer_id, created_at, technician:technicians(full_name, ref_no), customer:customers(name, ref_no)", { count: "exact" })
        .eq("company_id", orgId).order("technician_id").order("created_at");
      if (isUuid(param(sp, "technician"))) q = q.eq("technician_id", param(sp, "technician"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      const r = await ranged(q, range);
      return { ...r, data: (r.data ?? []).map((x) => ({ ...x, id: `${x.technician_id}:${x.customer_id}` })) };
    },
  },
  {
    slug: "devices", title: "تقرير الأجهزة", description: "كشف الأجهزة الفعلية مع النظام والعميل والموقع والحالة ومواعيد الصيانة.",
    needs: ["devices.view"], archiveFilter: true,
    filters: async ({ sb, orgId }) => [
      { name: "system", label: "النظام", type: "select", options: await systemOptions(sb, orgId) },
      { name: "status", label: "الحالة", type: "select", options: toOptions(deviceStatus) },
      { name: "due", label: "الصيانة", type: "select", options: [{ value: "overdue", label: "متأخرة" }, { value: "30", label: "خلال 30 يومًا" }] },
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/devices/${r.id}` },
      { key: "name", label: "الجهاز", value: (r) => r.name as string },
      { key: "system", label: "النظام", value: (r) => rel(r, "system") },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "serial", label: "التسلسلي", value: (r) => (r.serial_number as string) ?? "" },
      { key: "status", label: "الحالة", value: (r) => label(deviceStatus, r.status) },
      { key: "last", label: "آخر صيانة", value: (r) => formatDate(r.last_maintenance_at as string) },
      { key: "next", label: "القادمة", value: (r) => formatDate(r.next_maintenance_at as string) },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("devices").select("id, ref_no, name, serial_number, status, last_maintenance_at, next_maintenance_at, archived_at, system:safety_systems(name), customer:customers(name), site:customer_sites(name)", { count: "exact" })
        .eq("company_id", orgId).order("ref_no");
      q = scoped(q, sp);
      const s = orIlike(["name", "ref_no", "serial_number", "model"], param(sp, "q"));
      if (s) q = q.or(s);
      if (isUuid(param(sp, "system"))) q = q.eq("system_id", param(sp, "system"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (isUuid(param(sp, "site"))) q = q.eq("site_id", param(sp, "site"));
      if (param(sp, "status")) q = q.eq("status", param(sp, "status"));
      const t = todayISO();
      if (param(sp, "due") === "overdue") q = q.lt("next_maintenance_at", t);
      if (param(sp, "due") === "30") q = q.gte("next_maintenance_at", t).lte("next_maintenance_at", addDaysISO(t, 30));
      return ranged(q, range);
    },
  },
  {
    slug: "devices-by-system", title: "تقرير الأجهزة حسب النظام والحالة", description: "ملخص إحصائي لعدد الأجهزة النشطة لكل نظام وحالة، مع المتأخر صيانته.",
    needs: ["devices.view"],
    filters: async () => [],
    columns: [
      { key: "system", label: "النظام", value: (r) => r.system_name as string },
      { key: "status", label: "الحالة", value: (r) => label(deviceStatus, r.status) },
      { key: "count", label: "عدد الأجهزة", value: (r) => r.device_count as number },
      { key: "overdue", label: "صيانة متأخرة", value: (r) => r.overdue_count as number },
    ],
    fetch: async ({ sb, orgId, range }) => {
      const r = await ranged(sb.from("report_devices_by_system").select("*", { count: "exact" }).eq("company_id", orgId).order("system_name").order("status"), range);
      return { ...r, data: (r.data ?? []).map((x, i) => ({ ...x, id: String(i) })) };
    },
    summary: async ({ sb, orgId }) => {
      const { data } = await sb.from("report_devices_by_system").select("device_count, overdue_count").eq("company_id", orgId);
      const total = (data ?? []).reduce((a, x) => a + (x.device_count as number), 0);
      const overdue = (data ?? []).reduce((a, x) => a + (x.overdue_count as number), 0);
      return [["إجمالي الأجهزة النشطة", total], ["المتأخرة صيانتها", overdue], ["نسبة الالتزام", total ? `${Math.round(((total - overdue) / total) * 100)}%` : "—"]];
    },
  },
  {
    slug: "maintenance-due", title: "تقرير مواعيد الصيانة القادمة والمتأخرة", description: "الأجهزة المستحقة الصيانة خلال فترة محددة والمتأخرة عنها.",
    needs: ["devices.view"],
    filters: async ({ sb, orgId }) => [
      { name: "window", label: "خلال (يوم)", type: "select", options: ["7", "14", "30", "60", "90"].map((v) => ({ value: v, label: `${v} يومًا` })) },
      { name: "system", label: "النظام", type: "select", options: await systemOptions(sb, orgId) },
      { name: "only", label: "العرض", type: "select", options: [{ value: "overdue", label: "المتأخرة فقط" }, { value: "upcoming", label: "القادمة فقط" }] },
    ],
    columns: [
      { key: "next", label: "الموعد", value: (r) => formatDate(r.next_maintenance_at as string) },
      { key: "state", label: "الوضع", value: (r) => ((r.next_maintenance_at as string) < todayISO() ? "متأخرة" : "قادمة") },
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/devices/${r.id}` },
      { key: "name", label: "الجهاز", value: (r) => r.name as string },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "system", label: "النظام", value: (r) => rel(r, "system") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      const t = todayISO();
      const win = Number(param(sp, "window")) || 30;
      let q = sb.from("devices").select("id, ref_no, name, next_maintenance_at, customer:customers(name), site:customer_sites(name), system:safety_systems(name)", { count: "exact" })
        .eq("company_id", orgId).is("archived_at", null).neq("status", "decommissioned").not("next_maintenance_at", "is", null).order("next_maintenance_at");
      if (param(sp, "only") === "overdue") q = q.lt("next_maintenance_at", t);
      else if (param(sp, "only") === "upcoming") q = q.gte("next_maintenance_at", t).lte("next_maintenance_at", addDaysISO(t, win));
      else q = q.lte("next_maintenance_at", addDaysISO(t, win));
      if (isUuid(param(sp, "system"))) q = q.eq("system_id", param(sp, "system"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      return ranged(q, range);
    },
    summary: async ({ sb, orgId, sp }) => {
      const t = todayISO();
      const win = Number(param(sp, "window")) || 30;
      const head = { count: "exact" as const, head: true };
      const [o, u] = await Promise.all([
        sb.from("devices").select("id", head).eq("company_id", orgId).is("archived_at", null).neq("status", "decommissioned").lt("next_maintenance_at", t),
        sb.from("devices").select("id", head).eq("company_id", orgId).is("archived_at", null).neq("status", "decommissioned").gte("next_maintenance_at", t).lte("next_maintenance_at", addDaysISO(t, win)),
      ]);
      return [["متأخرة", o.count ?? 0], [`قادمة خلال ${win} يومًا`, u.count ?? 0]];
    },
  },
  {
    slug: "maintenance", title: "تقرير الصيانة", description: "عمليات الصيانة المنفذة خلال فترة، مع النتائج.",
    needs: ["maintenance.view"],
    filters: async () => [
      { name: "action", label: "العملية", type: "select", options: toOptions(maintenanceAction) },
      { name: "result", label: "النتيجة", type: "select", options: toOptions(maintenanceResult) },
      { name: "kind", label: "التصنيف", type: "select", options: toOptions(maintenanceKind) }, ...DATES,
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string },
      { key: "date", label: "التاريخ", value: (r) => formatDateTime(r.performed_at as string) },
      { key: "device", label: "الجهاز", value: (r) => `${r.device_name_snapshot ?? ""} (${r.device_ref_snapshot ?? ""})`, href: (r) => `/devices/${r.device_id}` },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع وقت العملية", value: (r) => rel(r, "site") },
      { key: "action", label: "العملية", value: (r) => maintenanceAction[r.action as string] ?? "" },
      { key: "kind", label: "التصنيف", value: (r) => maintenanceKind[r.kind as string] ?? "" },
      { key: "techs", label: "الفنيون", value: (r) => ((r.techs as { technician: { full_name: string } | null }[]) ?? []).map((t) => t.technician?.full_name).filter(Boolean).join("، ") },
      { key: "result", label: "النتيجة", value: (r) => label(maintenanceResult, r.result) },
      { key: "notes", label: "ملاحظات", value: (r) => (r.notes as string) ?? "" },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("maintenance_records").select("id, ref_no, performed_at, device_id, device_name_snapshot, device_ref_snapshot, action, kind, result, notes, customer:customers(name), site:customer_sites(name), techs:maintenance_record_technicians(technician:technicians(full_name))", { count: "exact" })
        .eq("company_id", orgId).order("performed_at", { ascending: false });
      const s = orIlike(["ref_no", "device_name_snapshot", "device_ref_snapshot", "notes"], param(sp, "q"));
      if (s) q = q.or(s);
      if (param(sp, "kind")) q = q.eq("kind", param(sp, "kind"));
      if (isUuid(param(sp, "device"))) q = q.eq("device_id", param(sp, "device"));
      if (param(sp, "action")) q = q.eq("action", param(sp, "action"));
      if (param(sp, "result")) q = q.eq("result", param(sp, "result"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (dateFrom(sp)) q = q.gte("performed_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("performed_at", dateTo(sp)!);
      return ranged(q, range);
    },
    // ثلاثة أعداد بجولة واحدة متوازية (كانت متتابعة ≈ 3 × 400 مللي ثانية)
    summary: async ({ sb, orgId, sp }) => Promise.all(["pass", "pass_with_notes", "fail"].map(async (res): Promise<[string, number]> => {
      let q = sb.from("maintenance_records").select("id", { count: "exact", head: true }).eq("company_id", orgId).eq("result", res);
      if (dateFrom(sp)) q = q.gte("performed_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("performed_at", dateTo(sp)!);
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (param(sp, "kind")) q = q.eq("kind", param(sp, "kind"));
      return [maintenanceResult[res].label, (await q).count ?? 0];
    })),
  },
  {
    slug: "visits", title: "تقرير الزيارات", description: "الزيارات خلال فترة مع الحالة والعميل والفنيين.",
    needs: ["visits.view"], archiveFilter: true,
    filters: async ({ sb, orgId }) => [
      { name: "status", label: "الحالة", type: "select", options: [{ value: "open", label: "مفتوحة (مجدولة أو قيد التنفيذ)" }, { value: "overdue", label: "متأخرة (موعدها فات ولم تبدأ)" }, ...toOptions(visitStatus)] },
      { name: "visit_type", label: "النوع", type: "select", options: toOptions(visitType) },
      { name: "outcome", label: "النتيجة", type: "select", options: [...toOptions(visitOutcome), { value: "none", label: "لم تُحدد" }] },
      { name: "technician", label: "الفني", type: "select", options: await techOptions(sb, orgId) }, ...DATES,
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/visits/${r.id}` },
      { key: "date", label: "الموعد", value: (r) => formatDateTime(r.scheduled_start as string) },
      { key: "type", label: "النوع", value: (r) => visitType[r.visit_type as string] ?? "" },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "techs", label: "الفنيون", value: (r) => ((r.techs as { technician: { full_name: string } | null }[]) ?? []).map((t) => t.technician?.full_name).filter(Boolean).join("، ") },
      { key: "checked", label: "أجهزة مفحوصة", value: (r) => cnt(r, "records") },
      { key: "skipped", label: "تعذر / غير موجود", value: (r) => ((r.items as { inspection_status: string }[] | undefined) ?? []).filter((i) => i.inspection_status === "unable" || i.inspection_status === "not_found").length },
      { key: "status", label: "الحالة", value: (r) => (r.status === "scheduled" && String(r.scheduled_start) < new Date().toISOString() ? "متأخرة (موعدها فات)" : label(visitStatus, r.status)) },
      { key: "outcome", label: "النتيجة", value: (r) => (r.outcome ? label(visitOutcome, r.outcome) : "—") },
      { key: "print", label: "التقرير", value: () => "طباعة", href: (r) => `/print/visit/${r.id}` },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      const tech = isUuid(param(sp, "technician"));
      const [phase5, inspections] = await Promise.all([hasPhase5(sb), hasInspections(sb)]);
      const cols: string = `id, ref_no, scheduled_start, status, archived_at, customer:customers(name), site:customer_sites(name), records:maintenance_records(count), techs:visit_technicians${tech ? "!inner" : ""}(technician_id, technician:technicians(full_name))`
        + (phase5 ? ", visit_type, outcome" : "") + (inspections ? ", items:visit_devices(inspection_status)" : "");
      let q = sb.from("visits").select(cols, { count: "exact" })
        .eq("company_id", orgId).order("scheduled_start", { ascending: false });
      q = scoped(q, sp);
      if (tech) q = q.eq("techs.technician_id", param(sp, "technician"));
      if (phase5 && param(sp, "visit_type")) q = q.eq("visit_type", param(sp, "visit_type"));
      if (phase5 && param(sp, "outcome") === "none") q = q.is("outcome", null);
      else if (phase5 && param(sp, "outcome")) q = q.eq("outcome", param(sp, "outcome"));
      if (isUuid(param(sp, "site"))) q = q.eq("site_id", param(sp, "site"));
      if (param(sp, "status") === "overdue") q = q.eq("status", "scheduled").lt("scheduled_start", new Date().toISOString());
      else if (param(sp, "status") === "open") q = q.in("status", ["scheduled", "in_progress"]);
      else if (param(sp, "status")) q = q.eq("status", param(sp, "status"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (dateFrom(sp)) q = q.gte("scheduled_start", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("scheduled_start", dateTo(sp)!);
      const s = orIlike(["ref_no", "summary", "notes"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
  },
  {
    slug: "inspections", title: "سجل نتائج فحص الأجهزة", description: "نتيجة كل جهاز في كل زيارة: مفحوص، تعذر فحصه، أو غير موجود (مع السبب)، والحالة بعد الفحص والقطع والمتابعة. يتطلب ترحيل 20261106000100.",
    needs: ["visits.view", "maintenance.view"],
    filters: async () => [
      { name: "inspection_status", label: "حالة الفحص", type: "select", options: Object.entries(INSPECTION_STATUS).filter(([k]) => k !== "pending").map(([value, v]) => ({ value, label: v.label })) },
      { name: "result", label: "النتيجة", type: "select", options: toOptions(maintenanceResult) },
      { name: "status_after", label: "الحالة بعد الفحص", type: "select", options: toOptions(deviceStatus) },
      { name: "follow", label: "المتابعة", type: "select", options: [{ value: "1", label: "تحتاج متابعة" }] }, ...DATES,
    ],
    columns: [
      { key: "visit", label: "الزيارة", value: (r) => rel(r, "visit", "ref_no"), href: (r) => `/visits/${r.visit_id}` },
      { key: "date", label: "التاريخ", value: (r) => formatDateTime((r.inspected_at as string) ?? ((r.visit as Row | null)?.closed_at as string)) },
      { key: "type", label: "النوع", value: (r) => visitType[rel(r, "visit", "visit_type")] ?? "" },
      { key: "device", label: "الجهاز", value: (r) => `${rel(r, "device")} ${rel(r, "device", "ref_no")}`.trim(), href: (r) => `/devices/${r.device_id}` },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "status", label: "حالة الفحص", value: (r) => label(INSPECTION_STATUS, r.inspection_status) },
      { key: "reason", label: "السبب", value: (r) => (r.skip_reason as string) ?? "" },
      { key: "result", label: "النتيجة", value: (r) => (r.result ? label(maintenanceResult, r.result) : "") },
      { key: "after", label: "الحالة بعد", value: (r) => (r.status_after && r.inspection_status === "inspected" ? label(deviceStatus, r.status_after) : "") },
      { key: "parts", label: "القطع", value: (r) => partsText(r.parts as Part[]).replace(/\n/g, "، ") },
      { key: "follow", label: "متابعة", value: (r) => (r.follow_up_needed ? `نعم${r.follow_up_due ? ` (${formatDate(r.follow_up_due as string)})` : ""}` : "") },
      { key: "print", label: "التقرير", value: () => "طباعة", href: (r) => `/print/visit/${r.visit_id}` },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      if (!(await hasInspections(sb))) return { data: [], count: 0, error: null };
      // البنود في زيارات مغلقة فقط (المسودات ليست سجلًا معتمدًا)
      let q = sb.from("visit_devices").select("id, visit_id, device_id, inspection_status, skip_reason, result, status_after, parts, follow_up_needed, follow_up_due, inspected_at, visit:visits!inner(ref_no, visit_type, closed_at, archived_at), device:devices(name, ref_no), customer:customers(name), site:customer_sites(name)", { count: "exact" })
        .eq("company_id", orgId).not("visit.closed_at", "is", null).is("visit.archived_at", null).order("created_at", { ascending: false });
      for (const k of ["inspection_status", "result", "status_after"]) if (param(sp, k)) q = q.eq(k, param(sp, k));
      if (param(sp, "follow") === "1") q = q.eq("follow_up_needed", true);
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (isUuid(param(sp, "site"))) q = q.eq("site_id", param(sp, "site"));
      if (isUuid(param(sp, "device"))) q = q.eq("device_id", param(sp, "device"));
      if (dateFrom(sp)) q = q.gte("visit.closed_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("visit.closed_at", dateTo(sp)!);
      const s = orIlike(["skip_reason", "findings", "recommendations", "notes"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
    summary: async ({ sb, orgId }) => {
      if (!(await hasInspections(sb))) return [["الحالة", "يتطلب تطبيق ترحيل 20261106000100"]];
      const n = async (st: string) => (await sb.from("visit_devices").select("id, visit:visits!inner(closed_at)", { count: "exact", head: true })
        .eq("company_id", orgId).not("visit.closed_at", "is", null).eq("inspection_status", st)).count ?? 0;
      const [a, b, c] = await Promise.all([n("inspected"), n("unable"), n("not_found")]);
      return [["مفحوص", a], ["تعذر الفحص", b], ["غير موجود", c]];
    },
  },
  {
    slug: "work-orders", title: "تقرير أوامر العمل", description: "أوامر العمل حسب الحالة والأولوية والفترة.",
    needs: ["work_orders.view"], archiveFilter: true,
    filters: async () => [
      { name: "status", label: "الحالة", type: "select", options: toOptions(workOrderStatus) },
      { name: "priority", label: "الأولوية", type: "select", options: toOptions(workOrderPriority) }, ...DATES,
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/work-orders/${r.id}` },
      { key: "title", label: "العنوان", value: (r) => r.title as string },
      { key: "type", label: "النوع", value: (r) => workOrderType[r.order_type as string] ?? "" },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "priority", label: "الأولوية", value: (r) => label(workOrderPriority, r.priority) },
      { key: "status", label: "الحالة", value: (r) => label(workOrderStatus, r.status) },
      { key: "created", label: "الإنشاء", value: (r) => formatDate(r.created_at as string) },
      { key: "done", label: "الإكمال", value: (r) => formatDate(r.completed_at as string) },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("work_orders").select("id, ref_no, title, order_type, priority, status, created_at, completed_at, archived_at, customer:customers(name)", { count: "exact" })
        .eq("company_id", orgId).order("created_at", { ascending: false });
      q = scoped(q, sp);
      for (const k of ["status", "priority"]) if (param(sp, k)) q = q.eq(k, param(sp, k));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (dateFrom(sp)) q = q.gte("created_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("created_at", dateTo(sp)!);
      const s = orIlike(["ref_no", "title"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
    summary: async ({ sb, orgId }) => {
      const out: [string, number][] = [];
      for (const st of ["new", "scheduled", "in_progress", "completed"]) {
        const { count } = await sb.from("work_orders").select("id", { count: "exact", head: true }).eq("company_id", orgId).is("archived_at", null).eq("status", st);
        out.push([workOrderStatus[st].label, count ?? 0]);
      }
      return out;
    },
  },
  {
    slug: "faults", title: "تقرير البلاغات والأعطال", description: "الأعطال المفتوحة والإصلاحات التي تنتظر التحقق والمغلقة خلال فترة.",
    needs: ["faults.view"],
    filters: async () => [
      { name: "status", label: "الحالة", type: "select", options: [{ value: "open_all", label: "غير المغلقة" }, ...toOptions(faultStatus)] },
      { name: "severity", label: "الخطورة", type: "select", options: toOptions(faultSeverity) }, ...DATES,
    ],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => `/faults/${r.id}` },
      { key: "date", label: "تاريخ البلاغ", value: (r) => formatDateTime(r.reported_at as string) },
      { key: "device", label: "الجهاز", value: (r) => rel(r, "device"), href: (r) => `/devices/${r.device_id}` },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "severity", label: "الخطورة", value: (r) => label(faultSeverity, r.severity) },
      { key: "status", label: "الحالة", value: (r) => label(faultStatus, r.status) },
      { key: "wo", label: "أمر العمل", value: (r) => rel(r, "work_order", "ref_no") },
      { key: "resolved", label: "تاريخ الإصلاح", value: (r) => formatDateTime(r.resolved_at as string) },
      { key: "verify", label: "التحقق", value: (r) => (r.verification_result === "passed" ? "ناجح" : r.verification_result === "failed" ? "فاشل" : "") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("device_faults").select("id, ref_no, reported_at, device_id, severity, status, resolved_at, verification_result, device:devices(name), customer:customers(name), site:customer_sites(name), work_order:work_orders(ref_no)", { count: "exact" })
        .eq("company_id", orgId).is("archived_at", null).order("reported_at", { ascending: false });
      const st = param(sp, "status");
      if (st === "open_all") q = q.in("status", ["open", "in_progress", "awaiting_verification"]);
      else if (st) q = q.eq("status", st);
      if (param(sp, "severity")) q = q.eq("severity", param(sp, "severity"));
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (dateFrom(sp)) q = q.gte("reported_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("reported_at", dateTo(sp)!);
      const s = orIlike(["ref_no", "description"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
    summary: async ({ sb, orgId }) => Promise.all((["open", "in_progress", "awaiting_verification"] as const).map(async (st): Promise<[string, number]> =>
      [faultStatus[st].label, (await sb.from("device_faults").select("id", { count: "exact", head: true }).eq("company_id", orgId).is("archived_at", null).eq("status", st)).count ?? 0])),
  },
  {
    slug: "maintenance-cycles", title: "تقرير إنجاز الاستحقاقات والتأخير", description: "كل استحقاق صيانة دورية: موعده، وتاريخ إنجازه، وأيام التأخير، والمتأخر المفتوح.",
    needs: ["devices.view"],
    filters: async () => [{ name: "status", label: "الحالة", type: "select", options: [
      { value: "open_overdue", label: "مفتوحة متأخرة" }, { value: "completed", label: "مكتملة" }, { value: "late", label: "مكتملة بتأخير" },
      { value: "superseded", label: "أُعيدت جدولتها" }, { value: "cancelled", label: "ملغاة" }] }, ...DATES],
    columns: [
      { key: "due", label: "الاستحقاق", value: (r) => formatDate(r.due_date as string) },
      { key: "device", label: "الجهاز", value: (r) => `${rel(r, "device")} (${rel(r, "device", "ref_no")})`, href: (r) => `/devices/${r.device_id}` },
      { key: "customer", label: "العميل", value: (r) => rel(r, "customer") },
      { key: "site", label: "الموقع", value: (r) => rel(r, "site") },
      { key: "status", label: "الحالة", value: (r) => ({ open: "مفتوح", completed: "مكتمل", cancelled: "ملغى", superseded: "أُعيدت جدولته" } as Record<string, string>)[r.status as string] ?? "" },
      { key: "done", label: "تاريخ الإنجاز", value: (r) => formatDate(r.completed_on as string) },
      { key: "late", label: "أيام التأخير", value: (r) => (r.status === "open" && (r.due_date as string) < todayISO()
        ? Math.round((Date.parse(todayISO()) - Date.parse(r.due_date as string)) / 864e5) : (r.days_late as number | null) ?? "") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("device_maintenance_cycles").select("id, due_date, status, completed_on, days_late, device_id, device:devices(name, ref_no), customer:customers(name), site:customer_sites(name)", { count: "exact" })
        .eq("company_id", orgId).order("due_date", { ascending: false });
      const st = param(sp, "status");
      if (st === "open_overdue") q = q.eq("status", "open").lt("due_date", todayISO());
      else if (st === "late") q = q.eq("status", "completed").gt("days_late", 0);
      else if (st) q = q.eq("status", st);
      if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
      if (param(sp, "from")) q = q.gte("due_date", param(sp, "from"));
      if (param(sp, "to")) q = q.lte("due_date", param(sp, "to"));
      return ranged(q, range);
    },
  },
  {
    slug: "device-transfers", title: "تقرير نقل الأجهزة", description: "سجل نقل الأجهزة بين المواقع والعملاء مع السبب والتاريخ.",
    needs: ["devices.view"],
    filters: async () => [{ name: "kind", label: "النوع", type: "select", options: [{ value: "site", label: "داخل العميل" }, { value: "customer", label: "بين عميلين" }] }, ...DATES],
    columns: [
      { key: "date", label: "التاريخ", value: (r) => formatDateTime(r.moved_at as string) },
      { key: "device", label: "الجهاز", value: (r) => `${rel(r, "device")} (${rel(r, "device", "ref_no")})`, href: (r) => `/devices/${r.device_id}` },
      { key: "from", label: "من", value: (r) => `${rel(r, "from_customer")} — ${rel(r, "from_site") || "بلا موقع"}` },
      { key: "to", label: "إلى", value: (r) => `${rel(r, "to_customer")} — ${rel(r, "to_site")}` },
      { key: "reason", label: "السبب", value: (r) => (r.reason as string) ?? "" },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("device_transfers").select("id, moved_at, reason, device_id, from_customer_id, to_customer_id, device:devices(name, ref_no), from_site:customer_sites!dt_from_site_fk(name), to_site:customer_sites!dt_to_site_fk(name), from_customer:customers!dt_from_customer_fk(name), to_customer:customers!dt_to_customer_fk(name)", { count: "exact" })
        .eq("company_id", orgId).order("moved_at", { ascending: false });
      if (dateFrom(sp)) q = q.gte("moved_at", dateFrom(sp)!);
      if (dateTo(sp)) q = q.lte("moved_at", dateTo(sp)!);
      if (isUuid(param(sp, "customer"))) q = q.or(`from_customer_id.eq.${param(sp, "customer")},to_customer_id.eq.${param(sp, "customer")}`);
      const res = await ranged(q, range);
      const kind = param(sp, "kind");
      if (!kind || res.error) return res;
      // التصنيف بعد الجلب (المقارنة بين عمودين لا تُعبَّر في فلتر PostgREST)
      const data = (res.data ?? []).filter((r) => (kind === "customer") === (r.from_customer_id !== r.to_customer_id));
      return { data, count: data.length, error: null };
    },
  },
  {
    slug: "technician-performance", title: "تقرير أداء الفنيين", description: "الأعمال المسجلة فعليًا لكل فني خلال فترة: الصيانة الدورية المنجزة، الإصلاحات، والزيارات المكتملة. الزيارة غير المكتملة لا تُحسب إنجازًا.",
    needs: ["technicians.view"],
    filters: async () => DATES,
    columns: [
      { key: "name", label: "الفني", value: (r) => r.full_name as string, href: (r) => `/technicians/${r.id}` },
      { key: "periodic", label: "صيانة دورية منجزة", value: (r) => r.periodic as number },
      { key: "corrective", label: "إصلاحات", value: (r) => r.corrective as number },
      { key: "fails", label: "فحوص بنتيجة عطل", value: (r) => r.fails as number },
      { key: "visits", label: "زيارات مكتملة", value: (r) => r.visits_done as number },
      { key: "open", label: "زيارات غير مكتملة", value: (r) => r.visits_open as number },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let mq = sb.from("maintenance_record_technicians").select("technician_id, record:maintenance_records!inner(kind, result, performed_at)").eq("company_id", orgId).limit(10000);
      if (dateFrom(sp)) mq = mq.gte("record.performed_at", dateFrom(sp)!);
      if (dateTo(sp)) mq = mq.lte("record.performed_at", dateTo(sp)!);
      let vq = sb.from("visit_technicians").select("technician_id, visit:visits!inner(status, scheduled_start, archived_at)").eq("company_id", orgId).is("visit.archived_at", null).limit(10000);
      if (dateFrom(sp)) vq = vq.gte("visit.scheduled_start", dateFrom(sp)!);
      if (dateTo(sp)) vq = vq.lte("visit.scheduled_start", dateTo(sp)!);
      const [techs, recs, vis] = await Promise.all([
        sb.from("technicians").select("id, full_name").eq("company_id", orgId).is("archived_at", null).order("full_name"),
        mq, vq,
      ]);
      const err = techs.error ?? recs.error ?? vis.error;
      if (err) return { data: null, count: null, error: err };
      const rows = (techs.data ?? []).map((t) => {
        const mine = (recs.data ?? []).filter((x) => x.technician_id === t.id).map((x) => x.record as unknown as { kind: string; result: string });
        const vs = (vis.data ?? []).filter((x) => x.technician_id === t.id).map((x) => x.visit as unknown as { status: string });
        return { id: t.id, full_name: t.full_name, periodic: mine.filter((m) => m.kind === "periodic").length, corrective: mine.filter((m) => m.kind === "corrective").length,
          fails: mine.filter((m) => m.result === "fail").length, visits_done: vs.filter((v) => v.status === "completed").length,
          visits_open: vs.filter((v) => ["scheduled", "in_progress"].includes(v.status)).length };
      });
      return { data: range ? rows.slice(range[0], range[1] + 1) : rows, count: rows.length, error: null };
    },
  },
  {
    slug: "users", title: "تقرير المستخدمين والصلاحيات", description: "أعضاء الشركة وأدوارهم وحالاتهم وصلاحياتهم (الافتراضية للدور أو المخصصة).",
    // صلاحية سجل التدقيق افتراضيًا لمدير الشركة فقط
    needs: ["audit.view"],
    filters: async () => [{ name: "status", label: "الحالة", type: "select", options: toOptions(companyMemberStatus) }],
    columns: [
      { key: "name", label: "الاسم", value: (r) => (r.full_name as string) ?? "" },
      { key: "email", label: "البريد", value: (r) => (r.email as string) ?? "" },
      { key: "role", label: "الدور", value: (r) => (companyRole[r.role as string] ?? String(r.role)) + (r.is_primary ? " (أساسي)" : "") },
      { key: "status", label: "الحالة", value: (r) => label(companyMemberStatus, r.status) },
      { key: "since", label: "الانضمام", value: (r) => formatDate(r.created_at as string) },
      { key: "perms", label: "الصلاحيات", value: (r) => (r.role === "company_manager" ? "كل صلاحيات الشركة"
        : r.permissions ? ((r.permissions as string[]) ?? []).map((p) => PERMISSION_LABELS[p] ?? p).join("، ") : "الافتراضية للدور") },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      let q = sb.from("company_memberships").select("id, full_name, email, role, status, is_primary, permissions, created_at", { count: "exact" })
        .eq("company_id", orgId).order("created_at");
      if (param(sp, "status")) q = q.eq("status", param(sp, "status"));
      const s = orIlike(["full_name", "email"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
  },
  {
    slug: "archived", title: "تقرير السجلات المؤرشفة", description: "السجلات المؤرشفة لكل وحدة مع تاريخ الأرشفة.",
    needs: ["customers.view", "devices.view", "technicians.view", "sites.view", "work_orders.view", "visits.view"],
    filters: async () => [{ name: "entity", label: "الوحدة", type: "select", options: [
      { value: "customers", label: "العملاء" }, { value: "devices", label: "الأجهزة" }, { value: "technicians", label: "الفنيون" },
      { value: "customer_sites", label: "المواقع" }, { value: "work_orders", label: "أوامر العمل" }, { value: "visits", label: "الزيارات" },
    ] }],
    columns: [
      { key: "ref", label: "الرقم", value: (r) => r.ref_no as string, href: (r) => r.href as string },
      { key: "name", label: "السجل", value: (r) => (r.label as string) ?? "" },
      { key: "archived", label: "تاريخ الأرشفة", value: (r) => formatDateTime(r.archived_at as string) },
    ],
    fetch: async ({ sb, orgId, sp, range }) => {
      const cfg: Record<string, [string, string, string]> = {
        customers: ["name", "/customers/", "customers"], devices: ["name", "/devices/", "devices"], technicians: ["full_name", "/technicians/", "technicians"],
        customer_sites: ["name", "/sites/", "customer_sites"], work_orders: ["title", "/work-orders/", "work_orders"], visits: ["ref_no", "/visits/", "visits"],
      };
      const [col, path, table] = cfg[param(sp, "entity")] ?? cfg.customers;
      // اختيار ديناميكي للجدول (من قائمة ثابتة أعلاه)
      const loose = sb as unknown as { from: (t: string) => { select: (s: string, o: object) => ArchivedQuery } };
      const r = await ranged(loose.from(table).select(`id, ref_no, ${col}, archived_at`, { count: "exact" }).eq("company_id", orgId).not("archived_at", "is", null).order("archived_at", { ascending: false }), range);
      return { ...r, data: ((r.data ?? []) as unknown as Row[]).map((x) => ({ ...x, label: x[col], href: `${path}${x.id}` })) };
    },
  },
  {
    slug: "companies", title: "تقرير الشركات (المنصة)", description: "جميع الشركات المسجلة على المنصة وحالاتها.",
    needs: [], platformOnly: true,
    filters: async () => [{ name: "status", label: "الحالة", type: "select", options: toOptions(companyStatus) }],
    columns: [
      { key: "name", label: "الشركة", value: (r) => r.name as string, href: (r) => `/platform-admin/${r.id}` },
      { key: "status", label: "الحالة", value: (r) => label(companyStatus, r.status) },
      { key: "members", label: "الأعضاء", value: (r) => cnt(r, "members") },
      { key: "created", label: "التسجيل", value: (r) => formatDate(r.created_at as string) },
      { key: "updated", label: "آخر تحديث", value: (r) => formatDate(r.updated_at as string) },
    ],
    fetch: async ({ sb, sp, range }) => {
      let q = sb.from("companies").select("id, name, status, created_at, updated_at, members:company_memberships(count)", { count: "exact" }).order("created_at", { ascending: false });
      if (param(sp, "status")) q = q.eq("status", param(sp, "status"));
      const s = orIlike(["name"], param(sp, "q"));
      if (s) q = q.or(s);
      return ranged(q, range);
    },
  },
];

export function getReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}

/** نفس الصلاحيات التي تستخدمها القائمة والصفحة والتصدير والطباعة (من get_my_context). */
export function canRunReport(r: ReportDef, perms: Set<string>, canViewPlatform: boolean) {
  if (r.platformOnly) return canViewPlatform;
  return perms.has("reports.view") && (r.needs.length === 0 || r.needs.some((p) => perms.has(p)));
}

/** جلب كل الصفوف على دفعات (للتصدير والطباعة) بحد أقصى آمن. */
export async function fetchAll(r: ReportDef, c: Omit<ReportContext, "range">, max = 5000) {
  const rows: Row[] = [];
  for (let from = 0; from < max; from += 1000) {
    const res = await r.fetch({ ...c, range: [from, Math.min(from + 999, max - 1)] });
    if (res.error) return { rows, error: res.error, truncated: false };
    rows.push(...(res.data ?? []));
    if ((res.data ?? []).length < 1000) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}
