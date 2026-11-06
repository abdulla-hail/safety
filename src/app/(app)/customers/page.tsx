import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import LocationButton, { type SitePoint } from "@/components/map/LocationButton";
import { btnPrimary, btnSecondary, card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { customerType, toOptions } from "@/lib/labels";
import { archiveScope, orIlike, pageOf, param, rangeOf, sortOf, withParams, type SearchParams } from "@/lib/list";

export const metadata: Metadata = { title: "العملاء | عين السلامة" };

interface Row {
  id: string; ref_no: string; name: string; customer_type: string; city: string | null; phone: string | null;
  is_active: boolean; archived_at: string | null; contact_name: string | null; sites: SitePoint[];
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("customers.view", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["ref_no", "name", "city", "created_at"] as const, "created_at");
  const supabase = await createClient();

  let q = supabase.from("customers")
    .select("id, ref_no, name, customer_type, city, phone, is_active, archived_at, contact_name, sites:customer_sites(id, name, latitude, longitude, archived_at)", { count: "exact" })
    .eq("company_id", ctx.orgId)
    .order(sort.column, { ascending: sort.ascending })
    .range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["name", "ref_no", "phone", "email", "contact_name", "city"], param(sp, "q"));
  if (s) q = q.or(s);
  if (param(sp, "type")) q = q.eq("customer_type", param(sp, "type"));
  if (param(sp, "status")) q = q.eq("is_active", param(sp, "status") === "active");
  const { data, count, error } = await q;

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ref_no}</span> },
    { key: "name", label: "العميل", sortKey: "name", render: (r) => (
      <div>
        <Link href={`/customers/${r.id}`} className={link}>{r.name}</Link>
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}
        <p className="text-xs text-slate-500">{r.contact_name ?? ""}</p>
      </div>
    ) },
    { key: "type", label: "النوع", render: (r) => customerType[r.customer_type] ?? r.customer_type },
    { key: "city", label: "المدينة", sortKey: "city", render: (r) => r.city ?? "—" },
    { key: "phone", label: "الهاتف", render: (r) => <span dir="ltr">{r.phone ?? "—"}</span> },
    { key: "status", label: "الحالة", render: (r) => <StatusBadge label={r.is_active ? "نشط" : "غير نشط"} tone={r.is_active ? "success" : "neutral"} /> },
    { key: "loc", label: "الموقع", render: (r) => <LocationButton sites={r.sites ?? []} /> },
    ...(ctx.can("customers.update") ? [{ key: "edit", label: "", render: (r: Row) => <Link href={`/customers/${r.id}/edit`} className="text-xs text-slate-600 underline">تعديل</Link> }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="العملاء"
        description="إدارة العملاء ومواقعهم وأجهزتهم والفنيين المسندين إليهم."
        actions={<>
          {ctx.can("reports.view") && <Link href={withParams("/reports/customers", sp, { page: null })} className={btnSecondary}>تقرير العملاء</Link>}
          {ctx.can("customers.create") && <Link href="/customers/new" className={btnPrimary}>+ إضافة عميل</Link>}
        </>}
      />
      <section className={card}>
        <FilterBar action="/customers" searchParams={sp} fields={[
          { name: "type", label: "النوع", type: "select", options: toOptions(customerType) },
          { name: "status", label: "الحالة", type: "select", options: [{ value: "active", label: "نشط" }, { value: "inactive", label: "غير نشط" }] },
        ]} />
        {error ? <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل العملاء.</p> : (
          <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/customers" searchParams={sp} sort={sort}
            empty={scope === "archived" ? "لا يوجد عملاء مؤرشفون." : "لا يوجد عملاء مطابقون. أضف أول عميل للبدء."} />
        )}
        <Pagination basePath="/customers" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
