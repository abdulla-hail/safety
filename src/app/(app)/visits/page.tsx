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
import { toOptions, visitStatus, visitType } from "@/lib/labels";
import { archiveScope, isUuid, orIlike, pageOf, param, rangeOf, sortOf, withParams, type SearchParams } from "@/lib/list";

export const metadata = { title: "الزيارات والمعاينات | عين السلامة" };

interface Row {
  id: string; ref_no: string; scheduled_start: string; status: string; archived_at: string | null; visit_type: string | null; closed_at: string | null;
  customer: { id: string; name: string } | null; site: { name: string } | null;
  techs: { technician: { full_name: string } | null }[];
}

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("visits.view", "visits.create", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["scheduled_start", "ref_no", "created_at"] as const, "scheduled_start");
  const supabase = await createClient();
  let q = supabase.from("visits")
    .select("id, ref_no, scheduled_start, status, archived_at, visit_type, closed_at, customer:customers(id, name), site:customer_sites(name), techs:visit_technicians(technician:technicians(full_name))", { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending }).range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["ref_no", "notes", "summary"], param(sp, "q"));
  if (s) q = q.or(s);
  const st = param(sp, "status");
  if (st === "open") q = q.is("closed_at", null).not("status", "in", "(cancelled,missed)");
  else if (st) q = q.eq("status", st);
  const type = param(sp, "type");
  if (type === "survey") q = q.eq("visit_type", "survey");
  if (type === "maintenance") q = q.neq("visit_type", "survey");
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  if (param(sp, "from")) q = q.gte("scheduled_start", `${param(sp, "from")}T00:00:00+03:00`);
  if (param(sp, "to")) q = q.lte("scheduled_start", `${param(sp, "to")}T23:59:59+03:00`);
  const { data, count } = await q;

  const href = (r: Row) => r.visit_type === "survey" ? `/visits/${r.id}/survey` : `/visits/${r.id}`;
  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <Link href={href(r)} className={`${link} font-mono text-xs`} dir="ltr">{r.ref_no}</Link> },
    { key: "type", label: "النوع", render: (r) => <span className={r.visit_type === "survey" ? "rounded bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand-strong" : "text-xs"}>{visitType[r.visit_type ?? "periodic"] ?? "زيارة"}</span> },
    { key: "when", label: "الموعد", sortKey: "scheduled_start", render: (r) => formatDateTime(r.scheduled_start) },
    { key: "customer", label: "العميل / الموقع", render: (r) => (
      <div>{r.customer ? <Link href={href(r)} className={link}>{r.customer.name}</Link> : "—"}
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشفة</span>}
        <p className="text-xs text-slate-500">{r.site?.name ?? ""}</p></div>
    ) },
    { key: "techs", label: "الفنيون", render: (r) => r.techs.map((t) => t.technician?.full_name).filter(Boolean).join("، ") || "—" },
    { key: "status", label: "الحالة", render: (r) => <StatusBadge {...(visitStatus[r.status] ?? { label: r.status, tone: "neutral" })} /> },
  ];

  return (
    <div>
      <PageHeader title="الزيارات والمعاينات" description="معاينات المواقع وتسعيرها، وزيارات الصيانة الدورية والطارئة."
        actions={<>
          {ctx.can("reports.view") && <Link href={withParams("/reports/visits", sp, { page: null })} className={btnSecondary}>تقرير الزيارات</Link>}
          {ctx.can("visits.create") && <Link href="/visits/new?type=maintenance" className={btnSecondary}>+ زيارة صيانة</Link>}
          {(ctx.can("visits.create") || ctx.can("field.assigned")) && <Link href="/visits/new?type=survey" className={btnPrimary}>+ زيارة معاينة</Link>}
        </>} />
      <section className={card}>
        <FilterBar action="/visits" searchParams={sp} hidden={["customer"]} searchPlaceholder="بحث بالرقم أو الملاحظات..." fields={[
          { name: "type", label: "النوع", type: "select", options: [{ value: "survey", label: "معاينات" }, { value: "maintenance", label: "زيارات صيانة" }] },
          { name: "status", label: "الحالة", type: "select", options: [{ value: "open", label: "مفتوحة (لم تُغلق)" }, ...toOptions(visitStatus)] },
          { name: "from", label: "من تاريخ", type: "date" },
          { name: "to", label: "إلى تاريخ", type: "date" },
        ]} />
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/visits" searchParams={sp} sort={sort} />
        <Pagination basePath="/visits" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
