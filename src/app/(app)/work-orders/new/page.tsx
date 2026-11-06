import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import CustomerPicker from "@/components/CustomerPicker";
import { card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { toOptions, workOrderPriority, workOrderType } from "@/lib/labels";
import { createWorkOrder } from "../actions";

export const metadata = { title: "أمر عمل جديد | عين السلامة" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("work_orders.create");
  const sp = await searchParams;
  const supabase = await createClient();
  const customerId = param(sp, "customer");
  // جولة واحدة: العميل وكل خيارات النموذج بالتوازي (كانت جولتين متتابعتين)
  const ok = isUuid(customerId);
  const [cust, sites, devices, techs] = ok ? await Promise.all([
    supabase.from("customers").select("id, name").eq("id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).maybeSingle(),
    supabase.from("customer_sites").select("id, name").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).order("name"),
    supabase.from("devices").select("id, ref_no, name, site:customer_sites(name)").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).order("ref_no").limit(300),
    ctx.can("work_orders.assign")
      ? supabase.from("technicians").select("id, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name")
      : null,
  ]) : [null, null, null, null];
  const customer = cust?.data ?? null;
  const crumbs = [{ label: "أوامر العمل", href: "/work-orders" }, { label: "جديد" }];
  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="أمر عمل جديد" crumbs={crumbs} description="اختر العميل أولًا." />
        <CustomerPicker orgId={ctx.orgId} basePath="/work-orders/new" search={param(sp, "q")} />
      </div>
    );
  }

  type Dev = { id: string; ref_no: string; name: string; site: { name: string } | null };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="أمر عمل جديد" crumbs={crumbs}
        description={<>للعميل: <Link className={link} href={`/customers/${customer.id}`}>{customer.name}</Link> · <Link className="underline" href="/work-orders/new">تغيير</Link></>} />
      <section className={`${card} p-6`}>
        <EntityForm action={createWorkOrder} submitLabel="إنشاء أمر العمل" cancelHref="/work-orders"
          initial={{ customer_id: customer.id, order_type: "preventive", priority: "medium", site_id: param(sp, "site") }}
          fields={[
            { name: "customer_id", label: "", type: "hidden" },
            { name: "title", label: "العنوان", required: true, wide: true, placeholder: "مثال: صيانة دورية ربع سنوية لأنظمة الإنذار" },
            { name: "order_type", label: "النوع", type: "select", required: true, options: toOptions(workOrderType) },
            { name: "priority", label: "الأولوية", type: "select", required: true, options: toOptions(workOrderPriority) },
            { name: "site_id", label: "الموقع", type: "select", options: (sites?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
            { name: "scheduled_for", label: "الموعد المجدول", type: "datetime-local" },
            { name: "due_at", label: "الموعد النهائي", type: "datetime-local" },
            { name: "description", label: "الوصف", type: "textarea" },
            ...(techs ? [{ name: "technician_ids", label: "الفنيون المعيّنون", type: "checkboxes" as const, options: (techs.data ?? []).map((t) => ({ value: t.id, label: t.full_name })) }] : []),
            { name: "device_ids", label: "الأجهزة المشمولة", type: "checkboxes", options: ((devices?.data ?? []) as unknown as Dev[]).map((d) => ({ value: d.id, label: `${d.name} (${d.ref_no})${d.site ? ` — ${d.site.name}` : ""}` })) },
          ]} />
      </section>
    </div>
  );
}
