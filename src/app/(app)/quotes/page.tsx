import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import Flash from "@/components/ui/Flash";
import { btnPrimary, card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { quoteStatus, toOptions } from "@/lib/labels";
import { sar, totals } from "@/lib/money";
import { archiveScope, isUuid, orIlike, pageOf, param, rangeOf, sortOf, type SearchParams } from "@/lib/list";

export const metadata = { title: "عروض الأسعار | عين السلامة" };

interface Row {
  id: string; ref_no: string; status: string; title: string | null; issue_date: string; valid_until: string | null; vat_rate: number; archived_at: string | null;
  customer: { id: string; name: string } | null; site: { name: string } | null; visit: { ref_no: string } | null;
  items: { quantity: number; unit_price: number }[];
}

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("quotes.view", "quotes.manage");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["issue_date", "ref_no", "created_at"] as const, "created_at");
  const supabase = await createClient();
  let q = supabase.from("quotations")
    .select("id, ref_no, status, title, issue_date, valid_until, vat_rate, archived_at, customer:customers(id, name), site:customer_sites(name), visit:visits(ref_no), items:quotation_items(quantity, unit_price)", { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending }).range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["ref_no", "title"], param(sp, "q"));
  if (s) q = q.or(s);
  if (param(sp, "status") in quoteStatus) q = q.eq("status", param(sp, "status"));
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  const { data, count } = await q;

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <Link href={`/quotes/${r.id}`} className={`${link} font-mono text-xs`} dir="ltr">{r.ref_no}</Link> },
    { key: "customer", label: "العميل / الفرع", render: (r) => (
      <div><Link href={`/quotes/${r.id}`} className={link}>{r.customer?.name ?? "—"}</Link>
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}
        <p className="text-xs text-slate-500">{[r.site?.name, r.visit && `معاينة ${r.visit.ref_no}`].filter(Boolean).join(" · ")}</p></div>
    ) },
    { key: "date", label: "التاريخ", sortKey: "issue_date", render: (r) => formatDate(r.issue_date) },
    { key: "total", label: "الإجمالي", render: (r) => <b className="whitespace-nowrap">{sar(totals(r.items, Number(r.vat_rate)).total)}</b> },
    { key: "status", label: "الحالة", render: (r) => <StatusBadge {...(quoteStatus[r.status] ?? { label: r.status, tone: "neutral" })} /> },
  ];

  return (
    <div>
      <Flash />
      <PageHeader title="عروض الأسعار" description="عروض الأسعار المحوّلة من المعاينات أو المنشأة يدويًا، وحالة كل عرض مع العميل."
        actions={ctx.can("quotes.manage") && <Link href="/quotes/new" className={btnPrimary}>+ عرض سعر</Link>} />
      <section className={card}>
        <FilterBar action="/quotes" searchParams={sp} hidden={["customer"]} searchPlaceholder="بحث بالرقم أو العنوان..." fields={[
          { name: "status", label: "الحالة", type: "select", options: toOptions(quoteStatus) },
        ]} />
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/quotes" searchParams={sp} sort={sort}
          empty="لا توجد عروض أسعار. أنهِ معاينة ثم اضغط «تحويل إلى عرض سعر»، أو أنشئ عرضًا يدويًا." />
        <Pagination basePath="/quotes" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
