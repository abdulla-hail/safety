import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import ActionButton from "@/components/ui/ActionButton";
import { btnDangerOutline, card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addBrand, deleteBrand, renameBrand } from "./actions";

export const metadata = { title: "الماركات | عين السلامة" };

/** قائمة الماركات المستخدمة في بنود المعاينات وعروض الأسعار والأجهزة */
export default async function BrandsPage() {
  const ctx = await requireOrg("catalog.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").select("id, name, created_at").eq("company_id", ctx.orgId).order("name");
  const rows = data ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="الماركات" description="تُختار في بنود المعاينة وعروض الأسعار وتظهر في المستند المطبوع والمرسل للعميل. حذف ماركة لا يغيّر المستندات السابقة." />
      <section className={`${card} p-5`}>
        <EntityForm action={addBrand} submitLabel="إضافة ماركة" fields={[{ name: "name", label: "اسم الماركة", required: true, maxLength: 100, placeholder: "مثال: Siemens" }]} />
      </section>
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>القائمة ({rows.length})</h2></div>
        {error && <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل الماركات.</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((b) => (
            <li key={b.id} className="flex flex-wrap items-end justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <EntityForm action={renameBrand} submitLabel="حفظ" initial={{ id: b.id, name: b.name }}
                  fields={[{ name: "id", label: "", type: "hidden" }, { name: "name", label: "", required: true, maxLength: 100 }]} />
              </div>
              <ActionButton action={deleteBrand} hidden={{ id: b.id }} label="حذف" confirm={`حذف «${b.name}» من القائمة؟ المستندات السابقة تحتفظ بالاسم.`} className={btnDangerOutline} />
            </li>
          ))}
          {rows.length === 0 && !error && <li className="px-5 py-5 text-sm text-slate-500">لا توجد ماركات بعد. أضفها هنا، أو تُضاف تلقائيًا عند كتابة ماركة جديدة في عرض سعر (للمسؤول).</li>}
        </ul>
      </section>
    </div>
  );
}
