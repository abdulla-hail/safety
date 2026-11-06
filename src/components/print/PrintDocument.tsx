import type { ReactNode } from "react";
import type { Branding } from "@/lib/branding";
import { formatDateTime } from "@/lib/format";

export type MetaValue = ReactNode | null | undefined;

/** يحذف الحقول الفارغة حتى لا تُطبع عناوين بلا قيم */
export function filled(meta: [string, MetaValue][]): [string, ReactNode][] {
  return meta.filter(([, v]) => v !== null && v !== undefined && v !== false && !(typeof v === "string" && (v.trim() === "" || v.trim() === "—"))) as [string, ReactNode][];
}

/** ترويسة جارية تتكرر أعلى كل صفحة مطبوعة (thead): الشعار والاسم وبيانات الاتصال المسموح بعرضها. */
function RunningHeader({ b }: { b: Branding }) {
  const contact = b.show_contact_in_reports ? [b.phone, b.email, b.website].filter(Boolean) : [];
  return (
    <div className="doc-running-header flex items-center justify-between gap-6 border-b-[3px] pb-2" style={{ borderColor: b.primary_color }}>
      <div className="flex items-center gap-3">
        {b.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt="" className="h-14 w-auto max-w-36 object-contain" />
        )}
        <div>
          <p className="text-base font-extrabold" style={{ color: b.primary_color }}>{b.name}</p>
          {b.legal_name && <p className="text-[10px] text-slate-700">{b.legal_name}</p>}
          {b.header_text && <p className="text-[10px] text-slate-700">{b.header_text}</p>}
        </div>
      </div>
      {contact.length > 0 && (
        <div className="text-left text-[9.5px] leading-4 text-slate-700" dir="ltr">
          {contact.map((x) => <p key={x}>{x}</p>)}
        </div>
      )}
    </div>
  );
}

/** تذييل جارٍ يتكرر أسفل كل صفحة (tfoot). رقم الصفحة يطبعه المتصفح في هامش الصفحة (@page). */
function RunningFooter({ b }: { b: Branding }) {
  const parts = b.show_contact_in_reports
    ? [[b.city, b.address].filter(Boolean).join(" — "), b.commercial_registration && `س.ت: ${b.commercial_registration}`,
       b.vat_number && `الرقم الضريبي: ${b.vat_number}`, b.license_no && `الترخيص: ${b.license_no}`].filter(Boolean)
    : [];
  return (
    <div className="doc-running-footer mt-3 border-t-2 pt-1.5 text-center text-[9.5px] leading-4 text-slate-700" style={{ borderColor: b.secondary_color }}>
      <p>{b.footer_text ?? `${b.name}${b.ref_no ? ` — ${b.ref_no}` : ""}`}</p>
      {parts.length > 0 && <p>{parts.join(" · ")}</p>}
    </div>
  );
}

/**
 * مستند طباعة موحد: الترويسة والتذييل يتكرران في كل صفحة عبر thead/tfoot (سلوك الطباعة القياسي للجداول)،
 * والعنوان والبيانات الوصفية مرة واحدة أعلى المحتوى. لا يعتمد على طباعة الخلفيات: الفواصل حدود ونصوص داكنة.
 */
export function PrintDocument({ b, title, refNo, meta = [], signature = true, children }: {
  b: Branding; title: string; refNo?: string | null; meta?: [string, MetaValue][]; signature?: boolean; children: ReactNode;
}) {
  const rows = filled(meta);
  return (
    <article className="print-doc" dir="rtl">
      <table className="doc-frame">
        <thead><tr><td><RunningHeader b={b} /></td></tr></thead>
        <tfoot><tr><td><RunningFooter b={b} /></td></tr></tfoot>
        <tbody><tr><td>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-xl font-extrabold">{title}</h1>
            <div className="text-[10.5px] text-slate-700">
              {refNo && <span className="ms-3">الرقم المرجعي: <b dir="ltr">{refNo}</b></span>}
              <span>تاريخ الطباعة: {formatDateTime(new Date().toISOString())}</span>
            </div>
          </div>
          {rows.length > 0 && (
            <dl className="doc-meta mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-slate-300 p-3 text-[11px] sm:grid-cols-3">
              {rows.map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="font-bold text-slate-700">{k}:</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          <div className="doc-body mt-4">{children}</div>
          {signature && (b.signature_name || b.stampUrl) && (
            <div className="mt-8 flex items-end justify-between gap-6 break-inside-avoid">
              <div className="text-[11px]">
                <p className="text-slate-600">التوقيع</p>
                <p className="mt-8 font-semibold">{b.signature_name ?? ""}</p>
                {b.signature_title && <p className="text-slate-600">{b.signature_title}</p>}
              </div>
              {b.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.stampUrl} alt="ختم الشركة" className="h-24 w-24 object-contain opacity-90" />
              )}
            </div>
          )}
        </td></tr></tbody>
      </table>
    </article>
  );
}

/** جدول بيانات مفتاح/قيمة يتجاهل القيم الفارغة */
export function KeyValueTable({ rows, keyWidth = "32%" }: { rows: [string, MetaValue][]; keyWidth?: string }) {
  const list = filled(rows);
  if (!list.length) return null;
  return (
    <table className="kv">
      <tbody>{list.map(([k, v]) => <tr key={k}><th style={{ width: keyWidth }}>{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  );
}
