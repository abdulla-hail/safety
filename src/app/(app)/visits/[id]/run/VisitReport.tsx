"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { formatDateTime } from "@/lib/format";
import { saveVisitReport } from "../../../my-work/actions";

type F = { summary: string; notes: string; recommendations: string };

/**
 * تقرير الزيارة وملاحظات الفني: حفظ تلقائي بعد توقف الكتابة (ثانيتان) وزر حفظ، وحالة صريحة «محفوظ/غير محفوظ».
 * لا تُعرض «محفوظ» إلا بعد تأكيد الخادم؛ عند الفشل يبقى النص وتُحفظ نسخة في هذا المتصفح فقط لاستعادتها.
 */
export default function VisitReport({ visitId, initial, savedAt, closed }: { visitId: string; initial: F; savedAt: string | null; closed: boolean }) {
  const storeKey = `ays:visit-report:${visitId}`;
  const [f, setF] = useState<F>(initial);
  const [state, setState] = useState<{ kind: "saved" | "dirty" | "saving" | "error"; text: string }>(
    { kind: "saved", text: savedAt ? `آخر حفظ ${formatDateTime(savedAt)}` : "" });
  const [restorable, setRestorable] = useState<F | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // أحدث نص (يُحدَّث مع كل تغيير) حتى يحفظ المؤقت آخر ما كُتب لا نسخة قديمة
  const latest = useRef(initial);

  // قراءة النسخة المحلية بعد التحميل (غير متاحة أثناء العرض في الخادم)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(storeKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as F;
        if (JSON.stringify(saved) !== JSON.stringify(initial)) setRestorable(saved);
        else window.localStorage.removeItem(storeKey);
      } catch { /* التخزين المحلي غير متاح */ }
    }, 0);
    return () => clearTimeout(t);
  }, [storeKey, initial]);

  const save = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = latest.current;
    setState({ kind: "saving", text: "جارٍ الحفظ..." });
    try {
      const r = await saveVisitReport({ visitId, ...body });
      if (!r.ok) { setState({ kind: "error", text: `${r.message} النص باقٍ هنا.` }); return; }
      if (JSON.stringify(latest.current) === JSON.stringify(body)) {
        try { window.localStorage.removeItem(storeKey); } catch { /* تجاهل */ }
        setState({ kind: "saved", text: `حُفظ ${formatDateTime(r.savedAt ?? new Date().toISOString())}` });
      } else setState({ kind: "dirty", text: "تغييرات غير محفوظة" });
    } catch {
      setState({ kind: "error", text: "انقطع الاتصال؛ لم يُؤكَّد الحفظ. النص باقٍ هنا وفي هذا المتصفح." });
    }
  }, [visitId, storeKey]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const set = (k: keyof F, v: string) => {
    const next = { ...latest.current, [k]: v };
    setF(next);
    latest.current = next;
    try { window.localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* تجاهل */ }
    setState({ kind: "dirty", text: "تغييرات غير محفوظة — يُحفظ تلقائيًا" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 2000);
  };

  const area = (k: keyof F, lbl: string, rows: number, ph: string) => (
    <div>
      <label htmlFor={`vr-${k}`} className={labelCls}>{lbl}</label>
      <textarea id={`vr-${k}`} rows={rows} maxLength={4000} value={f[k]} disabled={closed} placeholder={ph} onChange={(e) => set(k, e.target.value)} className={input} />
    </div>
  );
  const tone = state.kind === "error" ? "text-red-700" : state.kind === "saved" ? "text-green-700" : "text-amber-700";
  return (
    <div className="space-y-4">
      {restorable && !closed && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          يوجد نص للتقرير لم يُحفظ في الخادم (محفوظ في هذا المتصفح فقط).
          <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={() => { setF(restorable); latest.current = restorable; setRestorable(null); void save(); }}>استعادته وحفظه</button>
          <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={() => { try { window.localStorage.removeItem(storeKey); } catch { /* تجاهل */ } setRestorable(null); }}>تجاهله</button>
        </div>
      )}
      {area("summary", "تقرير الزيارة (يظهر في التقرير النهائي)", 4, "ما تم في الزيارة: الأعمال المنفذة، النتائج العامة، ما يلزم العميل معرفته")}
      {area("notes", "ملاحظات الفني", 3, "ملاحظات فنية للفريق والمتابعة")}
      {area("recommendations", "التوصيات العامة", 2, "توصيات للعميل")}
      {!closed && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={state.kind === "saving"} className={`${btnSecondary} ${btnSm}`}>حفظ الآن</button>
          <p role="status" aria-live="polite" className={`text-xs ${tone}`}>{state.text}</p>
        </div>
      )}
    </div>
  );
}
