import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { customerFields } from "../fields";
import { createCustomer } from "../actions";

export const metadata = { title: "إضافة عميل | عين السلامة" };

export default async function NewCustomerPage() {
  await requireOrg("customers.create");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="إضافة عميل" crumbs={[{ label: "العملاء", href: "/customers" }, { label: "إضافة" }]}
        description="يُنشأ الرقم المرجعي للعميل تلقائيًا عند الحفظ." />
      <section className={`${card} p-6`}>
        <EntityForm action={createCustomer} fields={customerFields} initial={{ customer_type: "company", is_active: "true" }}
          submitLabel="حفظ العميل" cancelHref="/customers" />
      </section>
    </div>
  );
}
