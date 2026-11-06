import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { customerFields } from "../../fields";
import { updateCustomer } from "../../actions";

export const metadata = { title: "تعديل عميل | عين السلامة" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("customers.update");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle();
  if (!c) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${c.name}`} refNo={c.ref_no}
        crumbs={[{ label: "العملاء", href: "/customers" }, { label: c.name, href: `/customers/${id}` }, { label: "تعديل" }]} />
      <section className={`${card} p-6`}>
        <EntityForm action={updateCustomer} fields={[{ name: "id", label: "", type: "hidden" }, ...customerFields]}
          initial={{ ...c, is_active: String(c.is_active) }} cancelHref={`/customers/${id}`} />
      </section>
    </div>
  );
}
