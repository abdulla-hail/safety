import type { Branding } from "@/lib/branding";
import { PrintDocument } from "@/components/print/PrintDocument";
import { formatDate, formatDateTime } from "@/lib/format";
import { quoteStatus, surveyIssue } from "@/lib/labels";
import { lineTotal, sar, totals } from "@/lib/money";
import { directionsUrl } from "@/lib/geo";

/**
 * مستندا المعاينة وعرض السعر بشكل واحد للطباعة الداخلية ولرابط المشاركة مع العميل (نفس المحتوى ونفس الحساب).
 * المجاميع تُحسب من البنود نفسها بدقة هللتين (lib/money)، وتطابق حساب القاعدة في رابط المشاركة.
 */
export interface DocSite { name: string; city?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null }
export interface SurveyDocData {
  ref_no: string; scheduled_start: string; actual_end: string | null; summary: string | null; recommendations: string | null; technician_notes: string | null;
  customer: { name: string; phone?: string | null } | null; site: DocSite | null; technicians: string[]; vat_rate: number; draft?: boolean;
  items: { id: string; title: string; issue_type: string; description: string | null; quantity: number; unit_price: number; device?: string | null; device_ref?: string | null }[];
  photos: { url: string | null; name: string; mime: string | null; item_id: string | null }[];
}
export interface QuoteDocData {
  ref_no: string; status: string; title: string | null; issue_date: string; valid_until: string | null; vat_rate: number; notes: string | null; terms: string | null;
  customer: { name: string; vat_number?: string | null; phone?: string | null } | null; site: DocSite | null; visit_ref: string | null;
  items: { description: string; quantity: number; unit_price: number }[];
}

const siteText = (s: DocSite | null) => s && [s.name, s.city, s.address].filter(Boolean).join(" — ");

function TotalsTable({ subtotal, vatRate, vat, total }: { subtotal: number; vatRate: number; vat: number; total: number }) {
  return (
    <table className="ms-auto mt-2 w-full max-w-xs text-[11px]">
      <tbody>
        <tr><th className="text-start">المجموع قبل الضريبة</th><td className="text-end">{sar(subtotal)}</td></tr>
        <tr><th className="text-start">ضريبة القيمة المضافة ({vatRate}٪)</th><td className="text-end">{sar(vat)}</td></tr>
        <tr className="border-t-2 border-slate-400 text-[12.5px]"><th className="text-start">الإجمالي النهائي</th><td className="text-end font-extrabold">{sar(total)}</td></tr>
      </tbody>
    </table>
  );
}

function Signatures({ boxes }: { boxes: string[] }) {
  return (
    <div className={`mt-8 grid gap-6 break-inside-avoid text-[11px]`} style={{ gridTemplateColumns: `repeat(${boxes.length}, minmax(0, 1fr))` }}>
      {boxes.map((b) => (
        <div key={b} className="rounded border border-slate-400 p-3">
          <p className="font-bold">{b}</p>
          <p className="mt-6 border-b border-dotted border-slate-500 pb-1 text-slate-500">الاسم:</p>
          <p className="mt-4 border-b border-dotted border-slate-500 pb-1 text-slate-500">التوقيع:</p>
          <p className="mt-4 border-b border-dotted border-slate-500 pb-1 text-slate-500">التاريخ:</p>
        </div>
      ))}
    </div>
  );
}

export function SurveyDoc({ b, d }: { b: Branding; d: SurveyDocData }) {
  const t = totals(d.items, d.vat_rate);
  const photosOf = (id: string | null) => d.photos.filter((p) => p.item_id === id && p.url && p.mime?.startsWith("image/"));
  const general = photosOf(null);
  const loc = d.site?.latitude != null && d.site?.longitude != null ? { lat: d.site.latitude, lng: d.site.longitude } : null;
  return (
    <PrintDocument b={b} title="تقرير معاينة موقع" refNo={d.ref_no} meta={[
      ["العميل", d.customer?.name], ["الفرع / الموقع", siteText(d.site)],
      ["الإحداثيات", loc && <a href={directionsUrl(loc)} dir="ltr">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</a>],
      ["تاريخ الزيارة", formatDateTime(d.scheduled_start)], ["تاريخ الإنهاء", d.actual_end && formatDateTime(d.actual_end)],
      ["الفني المسؤول", d.technicians.join("، ")], ["عدد البنود", String(d.items.length)],
    ]}>
      {d.draft && <p className="mb-3 rounded border border-amber-400 p-2 text-[11px] font-bold text-amber-800">مسودة: المعاينة لم تُنهَ بعد والأرقام قابلة للتغيير.</p>}
      {d.summary && (<><h2>نتيجة المعاينة</h2><p className="whitespace-pre-line text-[11px]">{d.summary}</p></>)}
      <h2>الأجهزة والأنظمة والأعمال المقترحة</h2>
      {d.items.length === 0 ? <p className="text-[11px]">لا توجد بنود مسجلة.</p> : (
        <table className="doc-table w-full text-[10.5px]">
          <thead><tr><th>#</th><th>الجهاز / النظام</th><th>المشكلة</th><th>الوصف والعمل المقترح</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {d.items.map((it, i) => (
              <tr key={it.id} className="break-inside-avoid align-top">
                <td>{i + 1}</td>
                <td><b>{it.title}</b>{it.device_ref && <span className="block text-slate-600" dir="ltr">{it.device_ref}</span>}</td>
                <td>{surveyIssue[it.issue_type] ?? it.issue_type}</td>
                <td className="whitespace-pre-line">{it.description ?? "—"}</td>
                <td dir="ltr">{Number(it.quantity)}</td>
                <td className="whitespace-nowrap">{sar(it.unit_price)}</td>
                <td className="whitespace-nowrap font-bold">{sar(lineTotal(it))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <TotalsTable {...t} />
      <p className="mt-1 text-[10px] text-slate-600">التكلفة تقديرية لأغراض المعاينة، ويصدر بها عرض سعر رسمي مستقل.</p>
      {d.recommendations && (<><h2>التوصيات</h2><p className="whitespace-pre-line text-[11px]">{d.recommendations}</p></>)}
      {d.technician_notes && (<><h2>ملاحظات عامة</h2><p className="whitespace-pre-line text-[11px]">{d.technician_notes}</p></>)}
      {d.photos.some((p) => p.url && p.mime?.startsWith("image/")) && (
        <>
          <h2>الصور</h2>
          {d.items.map((it, i) => {
            const ps = photosOf(it.id);
            return ps.length ? (
              <div key={it.id} className="mb-2 break-inside-avoid">
                <p className="mb-1 text-[10.5px] font-bold">{i + 1}. {it.title}</p>
                <div className="flex flex-wrap gap-2">{ps.map((p) => <Photo key={p.url} url={p.url!} name={p.name} />)}</div>
              </div>
            ) : null;
          })}
          {general.length > 0 && (
            <div className="break-inside-avoid">
              <p className="mb-1 text-[10.5px] font-bold">صور عامة للموقع</p>
              <div className="flex flex-wrap gap-2">{general.map((p) => <Photo key={p.url} url={p.url!} name={p.name} />)}</div>
            </div>
          )}
        </>
      )}
      <Signatures boxes={["الفني المسؤول", "ممثل العميل"]} />
    </PrintDocument>
  );
}

function Photo({ url, name }: { url: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} loading="lazy" className="h-32 w-44 rounded border border-slate-300 object-cover" />;
}

export function QuoteDoc({ b, d }: { b: Branding; d: QuoteDocData }) {
  const t = totals(d.items, d.vat_rate);
  return (
    <PrintDocument b={b} title="عرض سعر" refNo={d.ref_no} meta={[
      ["العميل", d.customer?.name], ["الرقم الضريبي للعميل", d.customer?.vat_number], ["الفرع / الموقع", siteText(d.site)],
      ["تاريخ العرض", formatDate(d.issue_date)], ["صالح حتى", d.valid_until && formatDate(d.valid_until)],
      ["مرجع المعاينة", d.visit_ref], ["الحالة", d.status !== "draft" ? quoteStatus[d.status]?.label : "مسودة"],
    ]}>
      {d.title && <p className="mb-3 text-[13px] font-bold">{d.title}</p>}
      <table className="doc-table w-full text-[10.5px]">
        <thead><tr><th>#</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>
          {d.items.map((it, i) => (
            <tr key={i} className="break-inside-avoid align-top">
              <td>{i + 1}</td><td className="whitespace-pre-line">{it.description}</td><td dir="ltr">{Number(it.quantity)}</td>
              <td className="whitespace-nowrap">{sar(it.unit_price)}</td><td className="whitespace-nowrap font-bold">{sar(lineTotal(it))}</td>
            </tr>
          ))}
          {d.items.length === 0 && <tr><td colSpan={5}>لا توجد بنود.</td></tr>}
        </tbody>
      </table>
      <TotalsTable {...t} />
      {d.notes && (<><h2>ملاحظات</h2><p className="whitespace-pre-line text-[11px]">{d.notes}</p></>)}
      {d.terms && (<><h2>الشروط والأحكام</h2><p className="whitespace-pre-line text-[11px]">{d.terms}</p></>)}
      <Signatures boxes={["عن الشركة", "اعتماد العميل"]} />
    </PrintDocument>
  );
}
