"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { input } from "@/components/ui/styles";

type Option = { id: string; name: string };

/**
 * فلتر العميل ثم الموقع: تغيير العميل يمسح الموقع ويعيد ترقيم الصفحات، ويُحدَّث الرابط بتنقل داخلي
 * (دون إعادة تحميل الصفحة). قائمة المواقع يجلبها الخادم للعميل المحدد فقط، وكلتا القائمتين تخضع لـ RLS.
 */
export default function CustomerSiteFilter({
  basePath, query, customers, sites, customer, site, showSite = true,
}: {
  basePath: string;
  /** معايير الرابط الحالية (عدا customer وsite) */
  query: Record<string, string>;
  customers: Option[];
  sites: Option[];
  customer: string;
  site: string;
  showSite?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(next: { customer: string; site: string }) {
    const u = new URLSearchParams(query);
    u.delete("page");
    if (next.customer) u.set("customer", next.customer);
    if (next.site) u.set("site", next.site);
    const s = u.toString();
    start(() => router.push(s ? `${basePath}?${s}` : basePath, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3" aria-busy={pending}>
      <div className="min-w-56">
        <label htmlFor="flt-customer" className="mb-1 block text-xs font-semibold text-slate-500">العميل</label>
        <select id="flt-customer" value={customer} disabled={pending} className={input}
          onChange={(e) => go({ customer: e.target.value, site: "" })}>
          <option value="">جميع العملاء</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {showSite && (
        <div className="min-w-56">
          <label htmlFor="flt-site" className="mb-1 block text-xs font-semibold text-slate-500">الموقع</label>
          <select id="flt-site" value={site} disabled={pending || !customer} className={input}
            onChange={(e) => go({ customer, site: e.target.value })}>
            <option value="">{customer ? (sites.length ? "جميع مواقع العميل" : "لا توجد مواقع لهذا العميل") : "اختر العميل أولًا"}</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {pending && <span className="pb-2 text-xs text-slate-500" role="status">جارٍ التحديث...</span>}
    </div>
  );
}
