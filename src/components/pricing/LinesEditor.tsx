"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { btnDangerOutline, btnPrimary, btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { lineTotal, sar, totals } from "@/lib/money";

export interface Line { id: string; [k: string]: string | number | null }
export interface LineField { name: string; label: string; type?: "text" | "textarea" | "select" | "number"; options?: { value: string; label: string }[]; required?: boolean; wide?: boolean; placeholder?: string }
type SaveResult = { ok: boolean; message: string; errors?: Record<string, string> };

/**
 * محرر بنود مسعّرة (بنود المعاينة أو عرض السعر): إضافة وتعديل وحذف بند بند، والإجمالي والضريبة يُحسبان فورًا.
 * كل حفظ يؤكده الخادم قبل إعلانه؛ عند الفشل تبقى المدخلات. locked: عرض فقط (معاينة منتهية أو عرض غير «قيد الإعداد»).
 */
export default function LinesEditor({ lines, fields, vatRate, locked, onSave, onDelete, render, emptyText, addLabel = "+ إضافة بند" }: {
  lines: Line[]; fields: LineField[]; vatRate: number; locked: boolean; emptyText: string; addLabel?: string;
  onSave: (id: string | undefined, values: Record<string, string>) => Promise<SaveResult>;
  onDelete: (id: string) => Promise<SaveResult>;
  /** وصف البند في القائمة */
  render: (l: Line) => ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const t = totals(lines.map((l) => ({ quantity: l.quantity ?? 0, unit_price: l.unit_price ?? 0 })), vatRate);
  const blank = Object.fromEntries(fields.map((f) => [f.name, f.name === "quantity" ? "1" : f.type === "select" ? (f.required ? f.options?.[0]?.value ?? "" : "") : ""]));

  function open(l?: Line) {
    setEditing(l ? l.id : "new");
    setValues(l ? Object.fromEntries(fields.map((f) => [f.name, l[f.name] == null ? "" : String(l[f.name])])) : blank);
    setResult(null);
  }
  async function save() {
    setBusy(true);
    try {
      const r = await onSave(editing === "new" ? undefined : editing ?? undefined, values);
      setResult(r);
      if (r.ok) { setEditing(null); router.refresh(); }
    } catch { setResult({ ok: false, message: "انقطع الاتصال؛ لم يُؤكَّد الحفظ. المدخلات باقية — أعد المحاولة." }); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("حذف هذا البند؟")) return;
    setBusy(true);
    try { const r = await onDelete(id); setResult(r); if (r.ok) router.refresh(); }
    catch { setResult({ ok: false, message: "انقطع الاتصال؛ لم يُحذف البند." }); }
    finally { setBusy(false); }
  }
  const set = (k: string, v: string) => setValues((p) => {
    const next = { ...p, [k]: v };
    // اختيار جهاز يملأ الاسم إن كان فارغًا
    const f = fields.find((x) => x.name === k);
    if (k === "device_id" && f?.options && !p.title) next.title = f.options.find((o) => o.value === v)?.label ?? "";
    return next;
  });

  const form = (
    <div className="space-y-3 rounded-lg border border-brand/40 bg-brand-soft/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `ln-${f.name}`;
          const err = result?.errors?.[f.name];
          return (
            <div key={f.name} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}>
              <label htmlFor={id} className={labelCls}>{f.label}{f.required && <span className="text-danger"> *</span>}</label>
              {f.type === "textarea" ? <textarea id={id} rows={2} maxLength={2000} value={values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} className={input} />
                : f.type === "select" ? (
                  <select id={id} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} className={input}>
                    {!f.required && <option value="">—</option>}
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>)
                : <input id={id} inputMode={f.type === "number" ? "decimal" : undefined} value={values[f.name] ?? ""} placeholder={f.placeholder}
                    dir={f.type === "number" ? "ltr" : undefined} onChange={(e) => set(f.name, e.target.value)} className={input} />}
              {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} aria-busy={busy} className={`${btnPrimary} ${btnSm}`}>{busy ? "جارٍ الحفظ..." : "حفظ البند"}</button>
        <button type="button" onClick={() => setEditing(null)} disabled={busy} className={`${btnSecondary} ${btnSm}`}>إلغاء</button>
        {values.quantity && values.unit_price && <span className="text-xs text-slate-600">إجمالي البند: {sar(lineTotal({ quantity: values.quantity.replace(",", "."), unit_price: values.unit_price.replace(",", ".") }))}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-right text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">البند</th><th className="px-3 py-2">الكمية</th><th className="px-3 py-2">سعر الوحدة</th><th className="px-3 py-2">الإجمالي</th>{!locked && <th className="px-3 py-2" />}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={l.id} className="align-top">
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                <td className="px-3 py-2">{render(l)}</td>
                <td className="px-3 py-2" dir="ltr">{Number(l.quantity)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{sar(l.unit_price ?? 0)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-semibold">{sar(lineTotal({ quantity: l.quantity ?? 0, unit_price: l.unit_price ?? 0 }))}</td>
                {!locked && <td className="px-3 py-2 whitespace-nowrap">
                  <button type="button" onClick={() => open(l)} className={`${btnSecondary} !px-2 !py-1 !text-xs`}>تعديل</button>{" "}
                  <button type="button" onClick={() => void remove(l.id)} disabled={busy} className={`${btnDangerOutline} !px-2 !py-1 !text-xs`}>حذف</button>
                </td>}
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-500">{emptyText}</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 text-sm">
            <tr><td colSpan={4} className="px-3 py-1.5 text-end text-slate-600">المجموع قبل الضريبة</td><td className="px-3 py-1.5 font-semibold">{sar(t.subtotal)}</td>{!locked && <td />}</tr>
            <tr><td colSpan={4} className="px-3 py-1.5 text-end text-slate-600">ضريبة القيمة المضافة ({t.vatRate}٪)</td><td className="px-3 py-1.5">{sar(t.vat)}</td>{!locked && <td />}</tr>
            <tr className="bg-brand-soft/40"><td colSpan={4} className="px-3 py-2 text-end font-bold">الإجمالي النهائي</td><td className="px-3 py-2 text-base font-extrabold">{sar(t.total)}</td>{!locked && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {result && !editing && <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>{result.message}</p>}
      {!locked && (editing ? form : <button type="button" onClick={() => open()} className={btnSecondary}>{addLabel}</button>)}
      {editing && result && !result.ok && <p role="alert" className="text-sm text-red-700">{result.message}</p>}
    </div>
  );
}
