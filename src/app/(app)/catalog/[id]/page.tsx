import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import { btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { archiveScope, isUuid, type SearchParams } from "@/lib/list";
import { createItem, updateSystem } from "../actions";
import { itemFields, systemFields, withBrandSuggestions } from "../fields";
import { brandNames } from "@/lib/brands";

export const metadata = { title: "نظام سلامة | عين السلامة" };

export default async function SystemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg("catalog.view", "catalog.manage");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const scope = archiveScope(sp);
  let q = supabase.from("catalog_items")
    .select("id, ref_no, name, manufacturer, model, device_type, default_interval_days, is_active, archived_at, specs, devices(count)")
    .eq("system_id", id).eq("company_id", ctx.orgId).order("name");
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  // جولة متوازية واحدة بدل طلبين متتابعين
  const [{ data: s }, { data: items }, brands] = await Promise.all([
    supabase.from("safety_systems").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    q,
    brandNames(supabase, ctx.orgId),
  ]);
  if (!s) notFound();
  type Item = { id: string; ref_no: string; name: string; manufacturer: string | null; model: string | null; device_type: string | null;
    default_interval_days: number | null; is_active: boolean; archived_at: string | null; specs: Record<string, string>; devices: { count: number }[] };
  const manage = ctx.can("catalog.manage");

  return (
    <div className="space-y-6">
      <PageHeader title={s.name} refNo={s.ref_no} crumbs={[{ label: "كتالوج أجهزة السلامة", href: "/catalog" }, { label: s.name }]}
        description={s.description ?? undefined}
        actions={<RecordActions table="safety_systems" id={id} archived={!!s.archived_at} back={`/catalog/${id}`} listPath="/catalog" noun="النظام"
          canArchive={ctx.can("catalog.archive")} canDelete={ctx.can("catalog.delete")} />} />

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>تعريفات الأجهزة والموديلات</h2>
          <div className="flex gap-2 text-xs">
            {(["active", "archived", "all"] as const).map((x) => (
              <Link key={x} href={`/catalog/${id}?archived=${x}`} className={scope === x ? "font-bold text-primary" : "text-slate-500"}>
                {x === "active" ? "النشطة" : x === "archived" ? "المؤرشفة" : "الكل"}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr><th className="px-4 py-3">الرقم</th><th className="px-4 py-3">الجهاز</th><th className="px-4 py-3">المصنع / الموديل</th>
                <th className="px-4 py-3">الدورة</th><th className="px-4 py-3">أجهزة مسجلة</th><th className="px-4 py-3">الحالة</th><th className="px-4 py-3">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {((items ?? []) as unknown as Item[]).map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 font-mono text-xs" dir="ltr">{i.ref_no}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{i.name}</p>
                    <p className="text-xs text-slate-500">{i.device_type ?? ""} {Object.entries(i.specs ?? {}).slice(0, 2).map(([k, v]) => `· ${k}: ${v}`).join(" ")}</p>
                  </td>
                  <td className="px-4 py-3">{[i.manufacturer, i.model].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-3">{i.default_interval_days ? `${i.default_interval_days} يوم` : "—"}</td>
                  <td className="px-4 py-3">{i.devices?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3">{i.archived_at ? <StatusBadge label="مؤرشف" tone="neutral" /> : <StatusBadge label={i.is_active ? "مفعّل" : "معطّل"} tone={i.is_active ? "success" : "neutral"} />}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {manage && <Link href={`/catalog/items/${i.id}`} className={`${btnSecondary} ${btnSm}`}>تعديل</Link>}
                      <RecordActions table="catalog_items" id={i.id} archived={!!i.archived_at} back={`/catalog/${id}`} listPath={`/catalog/${id}`} noun="تعريف الجهاز"
                        canArchive={ctx.can("catalog.archive")} canDelete={ctx.can("catalog.delete") && (i.devices?.[0]?.count ?? 0) === 0} />
                    </div>
                  </td>
                </tr>
              ))}
              {(items ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">لا توجد تعريفات في هذا العرض.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          أرشفة التعريف تمنع اختياره للأجهزة الجديدة فقط؛ الأجهزة المسجلة وسجلات صيانتها تبقى كما هي. الحذف النهائي غير متاح لتعريف مرتبط بأجهزة.
          {" "}<Link href={`/devices?system=${id}`} className={link}>عرض أجهزة هذا النظام</Link>
        </p>
      </section>

      {manage && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>إضافة جهاز / موديل لهذا النظام</h2></div>
            <div className="p-5">
              <EntityForm action={createItem} fields={[{ name: "system_id", label: "", type: "hidden" }, ...withBrandSuggestions(itemFields, brands)]}
                initial={{ system_id: id, is_active: "true", default_interval_days: s.default_interval_days }} submitLabel="إضافة التعريف" />
            </div>
          </section>
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>تعديل بيانات النظام</h2></div>
            <div className="p-5">
              <EntityForm action={updateSystem} fields={[{ name: "id", label: "", type: "hidden" }, ...systemFields]}
                initial={{ ...s, is_active: String(s.is_active) }} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
