import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import StatusBadge from "@/components/ui/StatusBadge";
import { card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { archiveScope, type SearchParams } from "@/lib/list";
import { createSystem } from "./actions";
import { systemFields } from "./fields";
import CatalogTabs from "./CatalogTabs";

export const metadata = { title: "كتالوج أجهزة السلامة | عين السلامة" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("catalog.view", "catalog.manage");
  const sp = await searchParams;
  const scope = archiveScope(sp);
  const supabase = await createClient();
  let q = supabase.from("safety_systems")
    .select("id, ref_no, name, description, default_interval_days, is_active, archived_at, items:catalog_items(count), devices(count)")
    .eq("company_id", ctx.orgId).order("sort_order").order("name");
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  const { data } = await q;
  type Sys = { id: string; ref_no: string; name: string; description: string | null; default_interval_days: number | null; is_active: boolean; archived_at: string | null; items: { count: number }[]; devices: { count: number }[] };

  return (
    <div className="space-y-6">
      <PageHeader title="كتالوج أجهزة السلامة" description="تعريف أنظمة السلامة وأجهزتها وموديلاتها. يُستخدم الكتالوج عند تسجيل أجهزة العملاء لتعبئة البيانات تلقائيًا، ولا يغيّر تعديله الأجهزة المسجلة مسبقًا."
        actions={
          <div className="flex gap-2 text-sm">
            {(["active", "archived", "all"] as const).map((s) => (
              <Link key={s} href={`/catalog?archived=${s}`} className={`rounded-lg px-3 py-1.5 transition-colors duration-200 ${scope === s ? "bg-brand font-semibold text-on-brand" : "border border-slate-300 bg-white hover:border-brand hover:bg-brand-soft"}`}>
                {s === "active" ? "النشطة" : s === "archived" ? "المؤرشفة" : "الكل"}
              </Link>
            ))}
          </div>
        } />
      <CatalogTabs current="systems" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {((data ?? []) as unknown as Sys[]).map((s) => (
          <Link key={s.id} href={`/catalog/${s.id}`} className={`${card} block p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-md active:translate-y-0`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold text-foreground">{s.name}</h2>
              <span className="font-mono text-[11px] text-slate-500" dir="ltr">{s.ref_no}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{s.description ?? "—"}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>{s.items?.[0]?.count ?? 0} تعريف</span>
              <span>{s.devices?.[0]?.count ?? 0} جهاز مسجل</span>
              {s.default_interval_days && <span>كل {s.default_interval_days} يوم</span>}
              {s.archived_at ? <StatusBadge label="مؤرشف" tone="neutral" /> : !s.is_active && <StatusBadge label="معطّل" tone="neutral" />}
            </div>
          </Link>
        ))}
        {(data ?? []).length === 0 && <p className="text-sm text-slate-500">لا توجد أنظمة في هذا العرض.</p>}
      </div>
      {ctx.can("catalog.manage") && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>إضافة نظام سلامة جديد</h2></div>
          <div className="p-5"><EntityForm action={createSystem} fields={systemFields} initial={{ is_active: "true", sort_order: 0 }} submitLabel="إضافة النظام" /></div>
        </section>
      )}
      <p className="text-xs text-slate-500">لعرض الأجهزة المسجلة حسب النظام، استخدم <Link href="/reports/devices-by-system" className={link}>تقرير الأجهزة حسب النظام والحالة</Link>.</p>
    </div>
  );
}
