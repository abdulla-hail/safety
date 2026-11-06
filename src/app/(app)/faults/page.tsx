import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasPhase5 } from "@/lib/schema";
import PhasePending from "@/components/PhasePending";
import { formatDateTime } from "@/lib/format";
import { faultSeverity, faultStatus, toOptions } from "@/lib/labels";
import { isUuid, orIlike, pageOf, param, rangeOf, sortOf, type SearchParams } from "@/lib/list";

export const metadata = { title: "البلاغات والأعطال | عين السلامة" };

interface Row {
  id: string; ref_no: string; description: string; severity: string; status: string; reported_at: string; archived_at: string | null;
  device: { id: string; name: string; ref_no: string } | null; customer: { id: string; name: string } | null; site: { name: string } | null;
  work_order: { id: string; ref_no: string } | null;
}

const OPEN = ["open", "in_progress", "awaiting_verification"];

export default async function FaultsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("faults.view", "faults.create", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["ref_no", "reported_at", "severity"] as const, "reported_at");
  const supabase = await createClient();
  if (!(await hasPhase5(supabase))) return <PhasePending />;
  let q = supabase.from("device_faults")
    .select("id, ref_no, description, severity, status, reported_at, archived_at, device:devices(id, name, ref_no), customer:customers(id, name), site:customer_sites(name), work_order:work_orders(id, ref_no)", { count: "exact" })
    .eq("company_id", ctx.orgId).is("archived_at", null).order(sort.column, { ascending: sort.ascending }).range(...rangeOf(page));
  const status = param(sp, "status");
  if (status === "active" || !status) q = q.in("status", OPEN);
  else if (status !== "all") q = q.eq("status", status);
  if (param(sp, "severity")) q = q.eq("severity", param(sp, "severity"));
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  if (isUuid(param(sp, "device"))) q = q.eq("device_id", param(sp, "device"));
  const s = orIlike(["description", "ref_no"], param(sp, "q"));
  if (s) q = q.or(s);
  const { data, count } = await q;

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <Link href={`/faults/${r.id}`} className={`${link} font-mono text-xs`} dir="ltr">{r.ref_no}</Link> },
    { key: "device", label: "الجهاز", render: (r) => (
      <div>{r.device ? <Link href={`/devices/${r.device.id}`} className={link}>{r.device.name}</Link> : "—"}
        <p className="text-xs text-slate-500">{r.customer?.name ?? "—"}{r.site ? ` · ${r.site.name}` : ""}</p></div>
    ) },
    { key: "desc", label: "الوصف", render: (r) => <span className="line-clamp-2 max-w-sm">{r.description}</span> },
    { key: "sev", label: "الخطورة", sortKey: "severity", render: (r) => <StatusBadge {...(faultSeverity[r.severity] ?? { label: r.severity, tone: "neutral" })} /> },
    { key: "wo", label: "أمر العمل", render: (r) => r.work_order ? <Link href={`/work-orders/${r.work_order.id}`} className={`${link} font-mono text-xs`} dir="ltr">{r.work_order.ref_no}</Link> : "—" },
    { key: "at", label: "تاريخ البلاغ", sortKey: "reported_at", render: (r) => formatDateTime(r.reported_at) },
    { key: "status", label: "الحالة", render: (r) => <StatusBadge {...(faultStatus[r.status] ?? { label: r.status, tone: "neutral" })} /> },
  ];

  return (
    <div>
      <PageHeader title="البلاغات والأعطال" description="بلاغات الأعطال لكل جهاز ومسار معالجتها حتى التحقق والإغلاق. البلاغ لا يغيّر مواعيد الصيانة الدورية. يُسجَّل البلاغ من صفحة الجهاز." />
      <section className={card}>
        <FilterBar action="/faults" searchParams={sp} hidden={["customer", "device"]} fields={[
          { name: "status", label: "الحالة", type: "select", options: [{ value: "active", label: "المفتوحة (الافتراضي)" }, ...toOptions(faultStatus), { value: "all", label: "الكل" }] },
          { name: "severity", label: "الخطورة", type: "select", options: toOptions(faultSeverity) },
        ]} />
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/faults" searchParams={sp} sort={sort} minWidth={900} />
        <Pagination basePath="/faults" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
