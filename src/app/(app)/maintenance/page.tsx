import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnSecondary, card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { logLoadError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { deviceStatus, maintenanceAction, maintenanceKind, maintenanceResult, toOptions } from "@/lib/labels";
import { isUuid, orIlike, pageOf, param, rangeOf, sortOf, withParams, type SearchParams } from "@/lib/list";

export const metadata = { title: "سجلات الصيانة | عين السلامة" };

interface Row {
  id: string; ref_no: string; performed_at: string; action: string; kind: string | null; result: string; status_after: string; device_id: string;
  device_name_snapshot: string | null; device_ref_snapshot: string | null; next_due_at: string | null;
  customer: { id: string; name: string } | null; site: { id: string; name: string } | null; visit: { id: string; ref_no: string } | null;
  techs: { technician: { full_name: string } | null }[] | null;
}

/** سجل تاريخي ثابت: يُنشأ عند إغلاق الزيارة لكل جهاز فُحص فعلًا؛ العميل والموقع كما كانا وقت العملية. مقيد بالنطاق في القاعدة. */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("maintenance.view", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["performed_at", "ref_no"] as const, "performed_at");
  const supabase = await createClient();
  let q = supabase.from("maintenance_records")
    .select("id, ref_no, performed_at, action, kind, result, status_after, device_id, device_name_snapshot, device_ref_snapshot, next_due_at, customer:customers(id, name), site:customer_sites(id, name), visit:visits(id, ref_no), techs:maintenance_record_technicians(technician:technicians(full_name))", { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending }).range(...rangeOf(page));
  const s = orIlike(["ref_no", "device_name_snapshot", "device_ref_snapshot", "notes"], param(sp, "q"));
  if (s) q = q.or(s);
  if (param(sp, "result")) q = q.eq("result", param(sp, "result"));
  if (param(sp, "action")) q = q.eq("action", param(sp, "action"));
  if (param(sp, "kind")) q = q.eq("kind", param(sp, "kind"));
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  if (isUuid(param(sp, "device"))) q = q.eq("device_id", param(sp, "device"));
  if (param(sp, "from")) q = q.gte("performed_at", `${param(sp, "from")}T00:00:00+03:00`);
  if (param(sp, "to")) q = q.lte("performed_at", `${param(sp, "to")}T23:59:59+03:00`);
  const { data, count, error } = await q;
  const errCode = logLoadError("maintenance/list", error);

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ref_no}</span> },
    { key: "date", label: "التاريخ", sortKey: "performed_at", render: (r) => formatDateTime(r.performed_at) },
    { key: "device", label: "الجهاز", render: (r) => <div><Link href={`/devices/${r.device_id}`} className={link}>{r.device_name_snapshot}</Link><p className="text-xs text-slate-500" dir="ltr">{r.device_ref_snapshot}</p></div> },
    { key: "customer", label: "العميل / الموقع", render: (r) => <div>{r.customer ? <Link href={`/customers/${r.customer.id}`} className="hover:underline">{r.customer.name}</Link> : "—"}
      {r.site && <p className="text-xs text-slate-500">{r.site.name}</p>}</div> },
    { key: "action", label: "العملية", render: (r) => <div>{maintenanceAction[r.action] ?? r.action}{r.kind && <p className="text-xs text-slate-500">{maintenanceKind[r.kind] ?? r.kind}</p>}</div> },
    { key: "visit", label: "الزيارة", render: (r) => r.visit ? <Link href={`/visits/${r.visit.id}`} className="font-mono text-xs hover:underline" dir="ltr">{r.visit.ref_no}</Link> : "—" },
    { key: "tech", label: "الفني", render: (r) => (r.techs ?? []).map((t) => t.technician?.full_name).filter(Boolean).join("، ") || "—" },
    { key: "result", label: "النتيجة", render: (r) => <StatusBadge {...(maintenanceResult[r.result] ?? { label: r.result, tone: "neutral" })} /> },
    { key: "after", label: "الحالة بعد", render: (r) => <StatusBadge {...(deviceStatus[r.status_after] ?? { label: r.status_after, tone: "neutral" })} /> },
    { key: "next", label: "القادمة", render: (r) => formatDate(r.next_due_at) },
  ];

  return (
    <div>
      <PageHeader title="سجلات الصيانة" description="سجل تاريخي ثابت لكل جهاز فُحص فعلًا (لا يُعدّل ولا يُحذف؛ التصحيح موثق من صفحة الجهاز). يُنشأ عند إغلاق الزيارة الدورية أو الطارئة."
        actions={ctx.can("reports.view") ? <Link href={withParams("/reports/maintenance", sp, { page: null })} className={btnSecondary}>تقرير الصيانة</Link> : undefined} />
      <section className={card}>
        <FilterBar action="/maintenance" searchParams={sp} showArchive={false} hidden={["customer", "device"]} fields={[
          { name: "action", label: "العملية", type: "select", options: toOptions(maintenanceAction) },
          { name: "kind", label: "التصنيف", type: "select", options: toOptions(maintenanceKind) },
          { name: "result", label: "النتيجة", type: "select", options: toOptions(maintenanceResult) },
          { name: "from", label: "من", type: "date" },
          { name: "to", label: "إلى", type: "date" },
        ]} />
        {error ? (
          <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل سجلات الصيانة حاليًا{errCode}. أعد تحميل الصفحة بعد لحظات.</p>
        ) : (
          <>
            <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/maintenance" searchParams={sp} sort={sort} minWidth={1100} />
            <Pagination basePath="/maintenance" searchParams={sp} page={page} total={count ?? 0} />
          </>
        )}
      </section>
    </div>
  );
}
