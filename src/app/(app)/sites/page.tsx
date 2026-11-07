import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import { btnSecondary, card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { archiveScope, isUuid, orIlike, pageOf, param, rangeOf, sortOf, type SearchParams } from "@/lib/list";
import { customerSiteFilter } from "@/lib/customer-site-filter";
import CustomerSiteFilter from "@/components/ui/CustomerSiteFilter";
import { hasLocationText, withLocationText } from "@/lib/schema";
import LocationButton from "@/components/map/LocationButton";

export const metadata = { title: "المواقع والفروع | عين السلامة" };

interface Row {
  latitude: number | null; longitude: number | null; location_text?: string | null; address?: string | null;
  id: string; ref_no: string; name: string; city: string | null; district: string | null; contact_name: string | null;
  archived_at: string | null; customer: { id: string; name: string } | null; devices: { count: number }[];
}

export default async function SitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("sites.view", "field.assigned");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["ref_no", "name", "city", "created_at"] as const, "created_at");
  const supabase = await createClient();
  const hasText = await hasLocationText(supabase);
  let q = supabase.from("customer_sites")
    .select(withLocationText("id, ref_no, name, city, district, address, contact_name, archived_at, latitude, longitude, customer:customers(id, name), devices(count)", hasText), { count: "exact" })
    .eq("company_id", ctx.orgId).order(sort.column, { ascending: sort.ascending }).range(...rangeOf(page));
  const scope = archiveScope(sp);
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const s = orIlike(["name", "ref_no", "city", "district", "address"], param(sp, "q"));
  if (s) q = q.or(s);
  if (isUuid(param(sp, "customer"))) q = q.eq("customer_id", param(sp, "customer"));
  const [{ data, count }, filter] = await Promise.all([q, customerSiteFilter(supabase, ctx.orgId, sp)]);

  const columns: Column<Row>[] = [
    { key: "ref", label: "الرقم", sortKey: "ref_no", render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ref_no}</span> },
    { key: "name", label: "الموقع", sortKey: "name", render: (r) => (
      <div><Link href={`/sites/${r.id}`} className={link}>{r.name}</Link>
        {r.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}</div>
    ) },
    { key: "customer", label: "العميل", render: (r) => r.customer ? <Link href={`/customers/${r.customer.id}`} className="hover:underline">{r.customer.name}</Link> : "—" },
    { key: "city", label: "المدينة / الحي", sortKey: "city", render: (r) => [r.city, r.district].filter(Boolean).join(" · ") || "—" },
    { key: "contact", label: "المسؤول", render: (r) => r.contact_name ?? "—" },
    { key: "devices", label: "الأجهزة", render: (r) => r.devices?.[0]?.count ?? 0 },
    { key: "loc", label: "الموقع", render: (r) => <LocationButton sites={[r]} /> },
  ];

  return (
    <div>
      <PageHeader title="المواقع والفروع" description="تُضاف المواقع من صفحة العميل. يمكن طباعة ملصقات جميع أجهزة الموقع من صفحته."
        actions={ctx.can("reports.view") ? <Link href="/reports/sites" className={btnSecondary}>تقرير المواقع</Link> : undefined} />
      <section className={card}>
        <CustomerSiteFilter basePath="/sites" query={filter.query} customers={filter.customers} sites={[]}
          customer={filter.customer} site="" showSite={false} />
        <FilterBar action="/sites" searchParams={sp} hidden={["customer"]} />
        <DataTable columns={columns} rows={(data ?? []) as unknown as Row[]} basePath="/sites" searchParams={sp} sort={sort} />
        <Pagination basePath="/sites" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
