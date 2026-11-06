import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { toOptions, workOrderPriority, workOrderStatus, workOrderType } from "@/lib/labels";
import { archiveScope, isUuid, orIlike, pageOf, param, rangeOf, sortOf, withParams, type SearchParams } from "@/lib/list";

export const metadata = { title: "أوامر العمل | عين السلامة" };

interface Row {
  id: string; ref_no: string; title: string; order_type: string; priority: string; status: string; scheduled_for: string | null;
  due_at: string | null; archived_at: string | null; approved_at: string | null; customer: { id: string; name: string } | null;
  techs: { technician: { full_name: string } | null }[];
}

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("work_orders.view", "work_orders.create", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["ref_no", "created_at", "scheduled_for", "due_at", "priority"] as const, "created_at");
  const supabase = await createClient();
  let q = supabase.from("work_orders")
    .select("id, ref_no, title, order_type, priority, status, scheduled_for, due_at, archived_at, approved_at, customer:customers(id, name), techs:work_order_technicians(technician:technicians(full_name))", { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending, nullsFirst: false }).range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["title", "ref_no", "description"], param(sp, "q"));
  if (s) q = q.or(s);
  for (const k of ["status", "priority", "order_type"]) if (param(sp, k)) q = q.eq(k, param(sp, k));
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  if (param(sp, "from")) q = q.gte("created_at", `${param(sp, "from")}T00:00:00+03:00`);
  if (param(sp, "to")) q = q.lte("created_at", `${param(sp, "to")}T23:59:59+03:00`);
  const { data, count } = await q;

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ref_no}</span> },
    { key: "title", label: "أمر العمل", render: (r) => (
      <div><Link href={`/work-orders/${r.id}`} className={link}>{r.title}</Link>
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}
        <p className="text-xs text-slate-500">{workOrderType[r.order_type] ?? r.order_type} · {r.customer?.name ?? "—"}</p></div>
    ) },
    { key: "techs", label: "الفنيون", render: (r) => r.techs.map((t) => t.technician?.full_name).filter(Boolean).join("، ") || "—" },
    { key: "sched", label: "الموعد", sortKey: "scheduled_for", render: (r) => formatDateTime(r.scheduled_for) },
    { key: "priority", label: "الأولوية", sortKey: "priority", render: (r) => <StatusBadge {...(workOrderPriority[r.priority] ?? { label: r.priority, tone: "neutral" })} /> },
    { key: "status", label: "الحالة", render: (r) => (
      <div className="flex flex-col items-start gap-1"><StatusBadge {...(workOrderStatus[r.status] ?? { label: r.status, tone: "neutral" })} />
        {r.approved_at && <span className="text-[10px] text-green-700">معتمد</span>}</div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="أوامر العمل" description="أوامر الصيانة والفحص والتركيب، مع تعيين فني أو عدة فنيين."
        actions={<>
          {ctx.can("reports.view") && <Link href={withParams("/reports/work-orders", sp, { page: null })} className={btnSecondary}>تقرير أوامر العمل</Link>}
          {ctx.can("work_orders.create") && <Link href="/work-orders/new" className={btnPrimary}>+ أمر عمل جديد</Link>}
        </>} />
      <section className={card}>
        <FilterBar action="/work-orders" searchParams={sp} hidden={["customer"]} fields={[
          { name: "status", label: "الحالة", type: "select", options: toOptions(workOrderStatus) },
          { name: "priority", label: "الأولوية", type: "select", options: toOptions(workOrderPriority) },
          { name: "order_type", label: "النوع", type: "select", options: toOptions(workOrderType) },
          { name: "from", label: "من تاريخ", type: "date" },
          { name: "to", label: "إلى تاريخ", type: "date" },
        ]} />
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/work-orders" searchParams={sp} sort={sort} minWidth={900} />
        <Pagination basePath="/work-orders" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
