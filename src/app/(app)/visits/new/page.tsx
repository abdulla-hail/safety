import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import CustomerPicker from "@/components/CustomerPicker";
import { card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { createVisit } from "../actions";

export const metadata = { title: "جدولة زيارة | عين السلامة" };

export default async function NewVisitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("visits.create");
  const sp = await searchParams;
  const supabase = await createClient();
  const customerId = param(sp, "customer");
  // جولة واحدة: العميل وكل خيارات النموذج بالتوازي (كانت جولتين متتابعتين)
  const ok = isUuid(customerId);
  const [cust, sites, wos, techs, assigned] = ok ? await Promise.all([
    supabase.from("customers").select("id, name").eq("id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).maybeSingle(),
    supabase.from("customer_sites").select("id, name").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).order("name"),
    supabase.from("work_orders").select("id, ref_no, title").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).not("status", "in", "(completed,cancelled)").order("created_at", { ascending: false }),
    supabase.from("technicians").select("id, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name"),
    supabase.from("technician_customers").select("technician_id").eq("company_id", ctx.orgId).eq("customer_id", customerId),
  ]) : [null, null, null, null, null];
  const customer = cust?.data ?? null;
  const crumbs = [{ label: "الزيارات", href: "/visits" }, { label: "جدولة" }];
  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="جدولة زيارة" crumbs={crumbs} description="اختر العميل أولًا." />
        <CustomerPicker orgId={ctx.orgId} basePath="/visits/new" search={param(sp, "q")} />
      </div>
    );
  }

  const assignedIds = new Set((assigned?.data ?? []).map((a) => a.technician_id));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="جدولة زيارة" crumbs={crumbs}
        description={<>للعميل: <Link className={link} href={`/customers/${customer.id}`}>{customer.name}</Link> · <Link className="underline" href="/visits/new">تغيير</Link></>} />
      <section className={`${card} p-6`}>
        <EntityForm action={createVisit} submitLabel="جدولة الزيارة" cancelHref="/visits"
          initial={{ customer_id: customer.id, work_order_id: param(sp, "work_order"), technician_ids: [...assignedIds] }}
          fields={[
            { name: "customer_id", label: "", type: "hidden" },
            { name: "scheduled_start", label: "موعد البدء", type: "datetime-local", required: true },
            { name: "scheduled_end", label: "موعد الانتهاء المتوقع", type: "datetime-local" },
            { name: "site_id", label: "الموقع", type: "select", options: (sites?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
            { name: "work_order_id", label: "أمر العمل", type: "select", options: (wos?.data ?? []).map((w) => ({ value: w.id, label: `${w.ref_no} — ${w.title}` })) },
            { name: "technician_ids", label: "الفنيون (المسندون لهذا العميل محددون مسبقًا)", type: "checkboxes",
              options: (techs?.data ?? []).map((t) => ({ value: t.id, label: `${t.full_name}${assignedIds.has(t.id) ? " ★" : ""}` })) },
            { name: "notes", label: "ملاحظات", type: "textarea" },
          ]} />
      </section>
    </div>
  );
}
