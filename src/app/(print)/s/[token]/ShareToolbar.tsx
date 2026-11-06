"use client";

import { btnPrimary } from "@/components/ui/styles";
import { formatDate } from "@/lib/format";

/** شريط العميل: طباعة/حفظ PDF والتواصل مع الشركة (يختفي عند الطباعة) */
export default function ShareToolbar({ title, company, expires, phone }: { title: string; company: string; expires: string | null; phone: string | null }) {
  return (
    <div className="no-print sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur" dir="rtl">
      <p className="text-sm font-semibold">{title} — {company}</p>
      <button type="button" onClick={() => window.print()} className={btnPrimary}>طباعة / حفظ PDF</button>
      {phone && <a href={`tel:${phone}`} className="text-sm text-brand-strong underline" dir="ltr">{phone}</a>}
      {expires && <span className="text-xs text-slate-500">الرابط صالح حتى {formatDate(expires)}</span>}
    </div>
  );
}
