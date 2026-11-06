"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, input, label } from "@/components/ui/styles";
import { saveCompanySettings } from "./actions";

export interface CompanyValues {
  name: string; legal_name: string | null; phone: string | null; email: string | null; website: string | null; city: string | null;
  address: string | null; vat_number: string | null; license_no: string | null; commercial_registration: string | null;
  maintenance_alert_days: number; primary_color: string; secondary_color: string; header_text: string | null; footer_text: string | null;
  signature_name: string | null; signature_title: string | null; show_logo_in_reports: boolean; show_contact_in_reports: boolean;
  show_stamp_in_reports: boolean; ref_no: string | null;
}

/** رابط معاينة محلي للملف المختار، يُحرَّر عند التغيير أو الإزالة */
function usePreview(): [string | null, (f: File | null) => void] {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  const pick = (f: File | null) => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = f ? URL.createObjectURL(f) : null;
    setUrl(current.current);
  };
  return [url, pick];
}

/** نموذج بيانات الشركة والهوية البصرية مع معاينة حيّة لترويسة التقارير قبل الحفظ. */
export default function BrandingForm({ v, logoUrl, stampUrl, canCompany, canBranding }: {
  v: CompanyValues; logoUrl: string | null; stampUrl: string | null; canCompany: boolean; canBranding: boolean;
}) {
  const [state, action, pending] = useActionState(saveCompanySettings, initialActionState);
  const [p, setP] = useState({ ...v });
  const [newLogo, setLogoFile] = usePreview();
  const [newStamp, setStampFile] = usePreview();
  const [removeLogo, setRemoveLogo] = useState(false);
  const stampShown = newStamp ?? stampUrl;
  const shownLogo = removeLogo ? null : newLogo ?? logoUrl;
  const set = (k: keyof CompanyValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setP((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const text = (k: keyof CompanyValues, t: string, disabled: boolean, extra: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`c-${k}`} className={label}>{t}</label>
      <input id={`c-${k}`} name={k} value={String(p[k] ?? "")} onChange={set(k)} disabled={disabled} className={input} {...extra} />
    </div>
  );

  return (
    <form action={action} aria-busy={pending} className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        {state.message && <p role="alert" className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>}
        <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2" disabled={!canCompany}>
          <legend className="px-2 text-sm font-bold text-primary">بيانات الشركة في التقارير {!canCompany && "(عرض فقط)"}</legend>
          <p className="text-xs text-slate-500 md:col-span-2">الاسم التجاري والسجل التجاري والهاتف والمدينة يديرها مالك المنصة؛ تواصل معه لتعديلها.</p>
          {text("name", "الاسم التجاري (يديره مالك المنصة)", true)}
          {text("legal_name", "الاسم القانوني", !canCompany)}
          {text("phone", "الهاتف", true, { dir: "ltr" })}
          {text("email", "البريد الإلكتروني", !canCompany, { dir: "ltr", type: "email" })}
          {text("website", "الموقع الإلكتروني", !canCompany, { dir: "ltr" })}
          {text("city", "المدينة", true)}
          <div className="md:col-span-2">{text("address", "العنوان", !canCompany)}</div>
          {text("commercial_registration", "السجل التجاري", true, { dir: "ltr" })}
          {text("vat_number", "الرقم الضريبي", !canCompany, { dir: "ltr" })}
          {text("license_no", "رقم الترخيص (الدفاع المدني)", !canCompany, { dir: "ltr" })}
          {text("maintenance_alert_days", "التنبيه قبل موعد الصيانة (يوم)", !canCompany, { type: "number", min: 1, max: 180 })}
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2" disabled={!canBranding}>
          <legend className="px-2 text-sm font-bold text-primary">الهوية البصرية والتقارير {!canBranding && "(عرض فقط)"}</legend>
          <div>
            <label htmlFor="c-primary" className={label}>اللون الأساسي</label>
            <div className="flex items-center gap-2">
              <input id="c-primary" type="color" name="primary_color" value={p.primary_color} onChange={set("primary_color")} className="h-10 w-16 cursor-pointer rounded border border-slate-300" />
              <code dir="ltr" className="text-xs">{p.primary_color}</code>
            </div>
          </div>
          <div>
            <label htmlFor="c-secondary" className={label}>اللون الثانوي</label>
            <div className="flex items-center gap-2">
              <input id="c-secondary" type="color" name="secondary_color" value={p.secondary_color} onChange={set("secondary_color")} className="h-10 w-16 cursor-pointer rounded border border-slate-300" />
              <code dir="ltr" className="text-xs">{p.secondary_color}</code>
            </div>
          </div>
          <div>
            <label htmlFor="c-logo" className={label}>الشعار (PNG/JPEG/WebP/SVG حتى 2MB)</label>
            <input id="c-logo" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => { setLogoFile(e.target.files?.[0] ?? null); setRemoveLogo(false); }} className="text-sm" />
            <p className="mt-1 text-xs text-slate-500">يصبح الشعار أيضًا أيقونة التطبيق عند تثبيت المنصة على الجوال أو الحاسب («تثبيت التطبيق» أعلى الصفحة). الأفضل شعار مربع واضح بخلفية فاتحة.</p>
            {logoUrl && (
              <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="remove_logo" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} /> إزالة الشعار الحالي</label>
            )}
          </div>
          <div>
            <label htmlFor="c-stamp" className={label}>الختم (اختياري)</label>
            <input id="c-stamp" type="file" name="stamp" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setStampFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="c-header" className={label}>نص الترويسة</label>
            <input id="c-header" name="header_text" value={p.header_text ?? ""} onChange={set("header_text")} className={input} placeholder="مثال: مرخصة من المديرية العامة للدفاع المدني" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="c-footer" className={label}>نص التذييل</label>
            <input id="c-footer" name="footer_text" value={p.footer_text ?? ""} onChange={set("footer_text")} className={input} />
          </div>
          {text("signature_name", "اسم المفوّض بالتوقيع", !canBranding)}
          {text("signature_title", "المسمى", !canBranding)}
          <div className="flex flex-col gap-2 text-sm md:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="show_logo_in_reports" checked={p.show_logo_in_reports} onChange={set("show_logo_in_reports")} /> إظهار الشعار في التقارير والمستندات</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="show_contact_in_reports" checked={p.show_contact_in_reports} onChange={set("show_contact_in_reports")} /> إظهار بيانات الاتصال في الترويسة</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="show_stamp_in_reports" checked={p.show_stamp_in_reports} onChange={set("show_stamp_in_reports")} /> إظهار الختم والتوقيع في المستندات</label>
          </div>
        </fieldset>
        {(canCompany || canBranding) && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} aria-busy={pending} className={btnPrimary}>
              {pending ? "جارٍ رفع الصور وحفظ الهوية..." : "حفظ الإعدادات"}
            </button>
            {pending && <span className="text-xs text-slate-500" role="status">لا تغلق الصفحة؛ تظهر الهوية الجديدة في القائمة فور اكتمال الحفظ.</span>}
          </div>
        )}
      </div>

      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <p className="text-sm font-bold">معاينة ترويسة المستندات (قبل الحفظ)</p>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" dir="rtl">
          <div className="flex items-start justify-between gap-4 border-b-4 pb-3" style={{ borderColor: p.primary_color }}>
            <div className="flex items-center gap-3">
              {p.show_logo_in_reports && shownLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="معاينة الشعار" className="h-12 w-auto max-w-28 object-contain" />
              )}
              <div>
                <p className="font-extrabold" style={{ color: p.primary_color }}>{p.name || "اسم الشركة"}</p>
                {p.legal_name && <p className="text-[10px] text-slate-600">{p.legal_name}</p>}
                {p.header_text && <p className="text-[10px] text-slate-600">{p.header_text}</p>}
              </div>
            </div>
            {p.show_contact_in_reports && (
              <div className="text-left text-[9px] leading-4 text-slate-600" dir="ltr">
                <p>{p.phone}</p><p>{p.email}</p><p dir="rtl">{p.city}</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-sm font-bold">تقرير زيارة صيانة</p>
          <div className="mt-2 rounded p-2 text-[10px]" style={{ backgroundColor: `${p.secondary_color}20` }}>العميل: ... · الموقع: ... · الرقم المرجعي: VIS-000001</div>
          <table className="mt-2 w-full text-[10px]"><tbody>
            <tr><td className="border border-slate-200 bg-slate-50 p-1">جهاز</td><td className="border border-slate-200 p-1">سليم</td></tr>
          </tbody></table>
          {p.show_stamp_in_reports && (p.signature_name || stampShown) && (
            <div className="mt-3 flex items-end justify-between text-[10px]">
              <div><p className="text-slate-500">التوقيع</p><p className="mt-3 font-semibold">{p.signature_name}</p><p>{p.signature_title}</p></div>
              {stampShown && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stampShown} alt="معاينة الختم" className="size-14 object-contain" />
              )}
            </div>
          )}
          <p className="mt-3 border-t-2 pt-1 text-center text-[9px] text-slate-500" style={{ borderColor: p.secondary_color }}>{p.footer_text || `${p.name}${p.ref_no ? ` — ${p.ref_no}` : ""}`}</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg p-3 text-sm text-white" style={{ backgroundColor: p.primary_color }}>
          معاينة لون القائمة الجانبية (هوية الشركة؛ الأزرار بلون المنصة الموحد)
        </div>
      </aside>
    </form>
  );
}
