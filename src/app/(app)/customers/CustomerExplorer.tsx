import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, input, link } from "@/components/ui/styles";
import { customerType } from "@/lib/labels";
import { classifyLocation, directionsHref, LOCATION_KIND_LABEL, locationHref } from "@/lib/geo";
import { isUuid } from "@/lib/list";
import { withLocationText } from "@/lib/schema";

type Site = {
  id: string; ref_no: string; name: string; city: string | null; district: string | null; address: string | null;
  contact_name: string | null; contact_phone: string | null; latitude: number | null; longitude: number | null; location_text?: string | null;
};

/**
 * استعراض عميل وفروعه في شاشة واحدة: يختار المستخدم العميل فتظهر تحته بياناته وكل فروعه النشطة مع مواقعها،
 * وزر طباعة بيانات العميل وفروعه (A4). يعمل دون JavaScript (نموذج GET)، والقاعدة تقيد العملاء والفروع بالصلاحيات.
 */
export default async function CustomerExplorer({ supabase, orgId, selected, hasText, canPrint }: {
  supabase: SupabaseClient; orgId: string; selected: string; hasText: boolean; canPrint: boolean;
}) {
  const id = isUuid(selected) ? selected : "";
  const [options, cust, sites] = await Promise.all([
    supabase.from("customers").select("id, name, ref_no").eq("company_id", orgId).is("archived_at", null).order("name").limit(1000),
    id ? supabase.from("customers").select("id, ref_no, name, customer_type, contact_name, phone, email, city, address, is_active").eq("id", id).eq("company_id", orgId).maybeSingle() : null,
    id ? supabase.from("customer_sites").select(withLocationText("id, ref_no, name, city, district, address, contact_name, contact_phone, latitude, longitude", hasText))
      .eq("customer_id", id).eq("company_id", orgId).is("archived_at", null).order("name") : null,
  ]);
  const c = cust?.data ?? null;
  const rows = (sites?.data ?? []) as unknown as Site[];

  return (
    <section className={`${card} mb-6`} aria-labelledby="explorer-title">
      <div className={cardHeader}>
        <h2 id="explorer-title" className={cardTitle}>استعراض عميل وفروعه</h2>
        {c && canPrint && <Link href={`/print/customer/${c.id}/branches`} className={`${btnPrimary} ${btnSm}`}>🖨 طباعة بيانات العميل وفروعه</Link>}
      </div>
      <form action="/customers" method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="explorer-customer" className="mb-1 block text-xs font-semibold text-slate-600">اختر العميل</label>
          <select id="explorer-customer" name="c" defaultValue={id} className={input}>
            <option value="">— اختر عميلًا لعرض فروعه —</option>
            {(options.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.ref_no})</option>)}
          </select>
        </div>
        <button type="submit" className={`${btnSecondary}`}>عرض الفروع</button>
        {id && <Link href="/customers" className="text-xs text-slate-600 underline">إغلاق</Link>}
      </form>

      {id && !c && <p role="alert" className="px-5 py-4 text-sm text-red-700">العميل غير موجود أو لا تملك صلاحية عرضه.</p>}
      {c && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="min-w-0">
              <p className="text-base font-bold"><Link href={`/customers/${c.id}`} className={link}>{c.name}</Link> <span className="font-mono text-xs font-normal text-slate-500" dir="ltr">{c.ref_no}</span></p>
              <p className="mt-1 text-xs text-slate-600">
                {[customerType[c.customer_type] ?? c.customer_type, c.contact_name, c.city, c.address].filter(Boolean).join(" · ")}
                {c.phone && <> · <a href={`tel:${c.phone}`} dir="ltr" className="underline">{c.phone}</a></>}
                {c.email && <> · <span dir="ltr">{c.email}</span></>}
              </p>
            </div>
            <StatusBadge label={c.is_active ? "نشط" : "غير نشط"} tone={c.is_active ? "success" : "neutral"} />
          </div>

          <h3 className="text-sm font-bold">الفروع ({rows.length})</h3>
          {rows.length === 0 ? <p className="text-sm text-slate-500">لا توجد فروع نشطة لهذا العميل.</p> : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((s) => {
                const open = locationHref(s), dir = directionsHref(s);
                const t = (s.location_text ?? "").trim();
                return (
                  <li key={s.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/sites/${s.id}`} className={`${link} font-semibold`}>{s.name}</Link>
                      <span className="font-mono text-[11px] text-slate-500" dir="ltr">{s.ref_no}</span>
                    </div>
                    <p className="text-xs text-slate-600">{[s.city, s.district, s.address].filter(Boolean).join(" · ") || "بلا عنوان"}</p>
                    {t && <p className="break-all text-xs text-slate-600" dir="auto">📍 {t} <span className="rounded bg-slate-100 px-1 text-[10px]">{LOCATION_KIND_LABEL[classifyLocation(t)]}</span></p>}
                    {(s.contact_name || s.contact_phone) && <p className="text-xs text-slate-500">{s.contact_name ?? ""} {s.contact_phone && <a href={`tel:${s.contact_phone}`} dir="ltr" className="underline">{s.contact_phone}</a>}</p>}
                    <div className="mt-auto flex flex-wrap gap-1.5">
                      {open ? <a href={open} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>📍 الموقع</a> : <span className="text-[11px] text-amber-700">بلا موقع</span>}
                      {dir && <a href={dir} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>الاتجاهات</a>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
