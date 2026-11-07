import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import ActionButton from "@/components/ui/ActionButton";
import { btnDangerOutline, card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import CatalogTabs from "../CatalogTabs";
import { addBrand, deleteBrand, renameBrand } from "./actions";

export const metadata = { title: "الماركات | كتالوج الأجهزة | عين السلامة" };

type Brand = { id: string; name: string; survey_items: { count: number }[]; quotation_items: { count: number }[] };

/**
 * الماركات قسم فرعي من كتالوج الأجهزة: تُختار في بنود المعاينة وعروض الأسعار، وتُقترح في حقل «الشركة المصنعة» للأجهزة
 * وتعريفات الكتالوج. البنود تحفظ اسم الماركة نصًا، فالتعديل أو الحذف هنا لا يغيّر المستندات والأجهزة السابقة.
 */
export default async function BrandsPage() {
  const ctx = await requireOrg("catalog.view", "catalog.manage");
  const canManage = ctx.can("catalog.manage");
  const supabase = await createClient();
  const [{ data, error }, devs] = await Promise.all([
    supabase.from("brands").select("id, name, survey_items(count), quotation_items(count)").eq("company_id", ctx.orgId).order("name"),
    supabase.from("devices").select("manufacturer").eq("company_id", ctx.orgId).not("manufacturer", "is", null).is("archived_at", null).limit(5000),
  ]);
  const rows = (data ?? []) as unknown as Brand[];
  const devCount = new Map<string, number>();
  for (const d of devs.data ?? []) {
    const k = String(d.manufacturer).trim().toLowerCase();
    devCount.set(k, (devCount.get(k) ?? 0) + 1);
  }
  const usage = (b: Brand) => {
    const s = b.survey_items?.[0]?.count ?? 0, q = b.quotation_items?.[0]?.count ?? 0, d = devCount.get(b.name.trim().toLowerCase()) ?? 0;
    return [d && `${d} جهاز`, s && `${s} بند معاينة`, q && `${q} بند عرض سعر`].filter(Boolean).join(" · ") || "غير مستخدمة بعد";
  };

  return (
    <div className="space-y-5">
      <PageHeader title="كتالوج أجهزة السلامة" crumbs={[{ label: "كتالوج الأجهزة", href: "/catalog" }, { label: "الماركات" }]}
        description="الماركات المعتمدة في الشركة: تُختار في بنود المعاينة وعروض الأسعار وتظهر في المستند المطبوع والمرسل للعميل، وتُقترح عند تسجيل الأجهزة." />
      <CatalogTabs current="brands" />
      {canManage && (
        <section className={`${card} p-5`}>
          <EntityForm action={addBrand} submitLabel="إضافة ماركة" fields={[{ name: "name", label: "اسم الماركة", required: true, maxLength: 100, placeholder: "مثال: Siemens" }]} />
        </section>
      )}
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الماركات ({rows.length})</h2></div>
        {error && <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل الماركات.</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((b) => (
            <li key={b.id} className="flex flex-wrap items-end justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                {canManage ? (
                  <EntityForm action={renameBrand} submitLabel="حفظ" initial={{ id: b.id, name: b.name }}
                    fields={[{ name: "id", label: "", type: "hidden" }, { name: "name", label: "", required: true, maxLength: 100 }]} />
                ) : <p className="font-semibold">{b.name}</p>}
                <p className="mt-1 text-xs text-slate-500">{usage(b)}</p>
              </div>
              {canManage && (
                <ActionButton action={deleteBrand} hidden={{ id: b.id }} label="حذف" className={btnDangerOutline}
                  confirm={`حذف «${b.name}» من القائمة؟ الأجهزة والبنود والمستندات السابقة تحتفظ بالاسم كما هو.`} />
              )}
            </li>
          ))}
          {rows.length === 0 && !error && <li className="px-5 py-5 text-sm text-slate-500">لا توجد ماركات بعد.{canManage ? " أضفها هنا، أو تُضاف تلقائيًا عند كتابة ماركة جديدة في عرض سعر." : ""}</li>}
        </ul>
      </section>
    </div>
  );
}
