import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import CustomerPicker from "@/components/CustomerPicker";
import { card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { createManualQuote } from "../actions";

export const metadata = { title: "عرض سعر جديد | عين السلامة" };

/** عرض سعر يدوي (دون معاينة). الأسرع عادةً: أنهِ المعاينة ثم «تحويل إلى عرض سعر» لتنتقل البنود والأسعار تلقائيًا. */
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("quotes.manage");
  const sp = await searchParams;
  const customerId = param(sp, "customer");
  const supabase = await createClient();
  const [cust, sites] = isUuid(customerId) ? await Promise.all([
    supabase.from("customers").select("id, name").eq("id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).maybeSingle(),
    supabase.from("customer_sites").select("id, name").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).order("name"),
  ]) : [null, null];
  const customer = cust?.data ?? null;
  const crumbs = [{ label: "عروض الأسعار", href: "/quotes" }, { label: "جديد" }];
  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="عرض سعر جديد" crumbs={crumbs} description="اختر العميل. (لتحويل معاينة إلى عرض: افتح المعاينة المنتهية واضغط «تحويل إلى عرض سعر».)" />
        <CustomerPicker orgId={ctx.orgId} basePath="/quotes/new" search={param(sp, "q")} />
      </div>
    );
  }
  const siteOpts = (sites?.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="عرض سعر جديد" crumbs={crumbs}
        description={<>العميل: <Link className={link} href={`/customers/${customer.id}`}>{customer.name}</Link> · <Link className="underline" href="/quotes/new">تغيير</Link></>} />
      <section className={`${card} p-6`}>
        <EntityForm action={createManualQuote} submitLabel="إنشاء العرض وإضافة البنود" cancelHref="/quotes"
          initial={{ customer_id: customer.id, site_id: isUuid(param(sp, "site")) ? param(sp, "site") : siteOpts.length === 1 ? siteOpts[0].value : "", title: "عرض سعر أعمال صيانة أنظمة السلامة" }}
          fields={[
            { name: "customer_id", label: "", type: "hidden" },
            { name: "site_id", label: "الفرع (اختياري)", type: "select", options: siteOpts },
            { name: "title", label: "عنوان العرض", wide: true, maxLength: 200 },
          ]} />
      </section>
    </div>
  );
}
