import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, card, input, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, daysUntil, formatDate, todayISO } from "@/lib/format";
import { deviceStatus, toOptions } from "@/lib/labels";
import { archiveScope, isUuid, orIlike, pageOf, param, rangeOf, sortOf, withParams, type SearchParams } from "@/lib/list";
import { LABEL_SIZES } from "@/lib/label-sizes";
import { customerSiteFilter } from "@/lib/customer-site-filter";
import CustomerSiteFilter from "@/components/ui/CustomerSiteFilter";
import SelectAllCheckbox from "@/components/ui/SelectAllCheckbox";

export const metadata = { title: "الأجهزة | عين السلامة" };

interface Row {
  id: string; ref_no: string; name: string; serial_number: string | null; status: string; next_maintenance_at: string | null;
  archived_at: string | null; model: string | null;
  customer: { id: string; name: string } | null; site: { name: string } | null; system: { name: string } | null;
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("devices.view", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["ref_no", "name", "next_maintenance_at", "created_at"] as const, "created_at");
  const supabase = await createClient();
  const today = todayISO();

  let q = supabase.from("devices")
    .select("id, ref_no, name, serial_number, status, next_maintenance_at, archived_at, model, customer:customers(id, name), site:customer_sites(name), system:safety_systems(name)", { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending, nullsFirst: false }).range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["name", "ref_no", "serial_number", "model", "manufacturer", "qr_token", "location_detail"], param(sp, "q"));
  if (s) q = q.or(s);
  // الموقع يُطبق مع عميله فقط (موقع لا يتبع العميل لا يعيد شيئًا)، فتُجلب خيارات الفلتر والبيانات معًا في جولة واحدة
  const rawCustomer = isUuid(param(sp, "customer")) ? param(sp, "customer") : "";
  if (rawCustomer) q = q.eq("customer_id", rawCustomer);
  if (rawCustomer && isUuid(param(sp, "site"))) q = q.eq("site_id", param(sp, "site"));
  if (isUuid(param(sp, "system"))) q = q.eq("system_id", param(sp, "system"));
  if (param(sp, "status")) q = q.eq("status", param(sp, "status"));
  const due = param(sp, "due");
  if (due === "overdue") q = q.lt("next_maintenance_at", today);
  if (due === "30") q = q.gte("next_maintenance_at", today).lte("next_maintenance_at", addDaysISO(today, 30));

  const [{ data, count }, systems, filter] = await Promise.all([
    q,
    supabase.from("safety_systems").select("id, name").eq("company_id", ctx.orgId).is("archived_at", null).order("sort_order"),
    customerSiteFilter(supabase, ctx.orgId, sp),
  ]);
  const canPrint = ctx.can("devices.print");
  const canPrintDocs = ctx.can("reports.print");
  // نطاق «كل النتائج» للطباعة: العميل/الموقع المحددان أو كل الأجهزة المسموح بها
  const printScope: Record<string, string> = filter.site ? { site: filter.site } : filter.customer ? { customer: filter.customer } : { all: "1" };
  const scopeQs = new URLSearchParams(printScope).toString();
  const scopeLabel = filter.site ? "أجهزة الموقع المحدد" : filter.customer ? "أجهزة العميل المحدد" : "جميع الأجهزة المسموح لك بها";

  const columns: Column<Row>[] = [
    ...(canPrint || canPrintDocs ? [{ key: "sel", label: "تحديد", render: (r: Row) => (
      <input type="checkbox" name="ids" value={r.id} form="labels-form" aria-label={`تحديد ${r.name} للطباعة`} className="size-4 accent-[var(--brand)]" />
    ) }] : []),
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ref_no}</span> },
    { key: "name", label: "الجهاز", sortKey: "name", render: (r) => (
      <div><Link href={`/devices/${r.id}`} className={link}>{r.name}</Link>
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}
        <p className="text-xs text-slate-500">{r.system?.name ?? ""} {r.serial_number ? <>· <span dir="ltr">{r.serial_number}</span></> : ""}</p></div>
    ) },
    { key: "customer", label: "العميل / الموقع", render: (r) => (
      <div className="text-xs">{r.customer ? <Link href={`/customers/${r.customer.id}`} className="hover:underline">{r.customer.name}</Link> : "—"}<p className="text-slate-500">{r.site?.name ?? ""}</p></div>
    ) },
    { key: "next", label: "الصيانة القادمة", sortKey: "next_maintenance_at", render: (r) => {
      const d = daysUntil(r.next_maintenance_at);
      return <span className={d !== null && d < 0 ? "font-semibold text-danger" : d !== null && d <= 30 ? "text-amber-700" : ""}>{formatDate(r.next_maintenance_at)}</span>;
    } },
    { key: "status", label: "الحالة", render: (r) => <StatusBadge {...(deviceStatus[r.status] ?? { label: r.status, tone: "neutral" })} /> },
  ];

  return (
    <div>
      <PageHeader title="أجهزة السلامة" description="الأجهزة الفعلية المركبة لدى العملاء. لكل جهاز رقم مرجعي ورمز QR دائم."
        actions={<>
          <Link href="/scan" className={btnSecondary}>مسح رمز</Link>
          {ctx.can("reports.view") && <Link href={withParams("/reports/devices", sp, { page: null })} className={btnSecondary}>تقرير الأجهزة</Link>}
          {ctx.can("devices.create") && <Link href={filter.customer ? `/devices/new?customer=${filter.customer}${filter.site ? `&site=${filter.site}` : ""}` : "/devices/new"} className={btnPrimary}>+ تسجيل جهاز</Link>}
        </>} />
      <section className={card}>
        <CustomerSiteFilter basePath="/devices" query={filter.query} customers={filter.customers} sites={filter.sites}
          customer={filter.customer} site={filter.site} />
        <FilterBar action="/devices" searchParams={sp} hidden={["customer", "site"]} searchPlaceholder="بحث بالاسم أو الرقم أو التسلسلي أو الرمز..." fields={[
          { name: "system", label: "النظام", type: "select", options: (systems.data ?? []).map((x) => ({ value: x.id, label: x.name })) },
          { name: "status", label: "الحالة", type: "select", options: toOptions(deviceStatus) },
          { name: "due", label: "الصيانة", type: "select", options: [{ value: "overdue", label: "متأخرة" }, { value: "30", label: "خلال 30 يومًا" }] },
        ]} />
        {(canPrint || canPrintDocs) && (
          <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm">
            <form id="labels-form" action="/print/labels" method="get" className="flex flex-wrap items-center gap-3">
              <SelectAllCheckbox form="labels-form" />
              <span className="text-slate-600">الأجهزة المحددة:</span>
              {canPrint && <>
                <label htmlFor="lbl-size" className="sr-only">مقاس الملصق</label>
                <select id="lbl-size" name="size" defaultValue="a4-6" className={`${input} !w-auto`}>
                  {LABEL_SIZES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <button type="submit" className={btnSecondary}>طباعة الباركود</button>
              </>}
              {canPrintDocs && <button type="submit" formAction="/print/devices" className={btnSecondary}>طباعة البيانات</button>}
            </form>
            <p className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>{scopeLabel} (النشطة):</span>
              {canPrint && <Link href={`/print/labels?size=a4-6&${scopeQs}`} className={link}>طباعة كل الباركود (A4 — 6 في الصفحة)</Link>}
              {canPrintDocs && <Link href={`/print/devices?${scopeQs}`} className={link}>طباعة بيانات الكل</Link>}
            </p>
          </div>
        )}
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/devices" searchParams={sp} sort={sort} minWidth={860} />
        <Pagination basePath="/devices" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
