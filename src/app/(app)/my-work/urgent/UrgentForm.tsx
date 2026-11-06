"use client";

import { useActionState, useMemo, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, input, label as labelCls } from "@/components/ui/styles";
import { URGENT_REASONS } from "@/lib/visits";
import { startVisit } from "../actions";

interface Dev { id: string; name: string; ref: string; hint: string; flagged: boolean }

/** الخطوة الأخيرة للزيارة الطارئة: الأجهزة (بحث محلي) ← السبب ← وصف مختصر. البيانات تبقى عند فشل الإرسال. */
export default function UrgentForm({ siteId, devices, clientKey, preselect, reason }: {
  siteId: string; devices: Dev[]; clientKey: string; preselect: string[]; reason: string;
}) {
  const [state, action, pending] = useActionState(startVisit, initialActionState);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? devices.filter((d) => `${d.name} ${d.ref} ${d.hint}`.toLowerCase().includes(n)) : devices;
  }, [q, devices]);
  const v = state.values ?? {};
  const kind = typeof v.visit_type === "string" ? v.visit_type : "emergency";
  const why = typeof v.urgent_reason === "string" ? v.urgent_reason : reason;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="client_key" value={clientKey} />
      {state.message && !state.ok && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.message}</p>}

      <fieldset>
        <legend className={labelCls}>الأجهزة <span className="text-danger">*</span> <span className="font-normal text-slate-500">(اختر جهازًا أو أكثر؛ لكل جهاز نتيجة مستقلة)</span></legend>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو الرقم أو الرقم التسلسلي..." aria-label="بحث الأجهزة" className={`${input} mb-2`} />
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {shown.map((d) => (
            <li key={d.id}>
              <label className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm ${picked.has(d.id) ? "bg-brand-soft" : "hover:bg-slate-50"}`}>
                <input type="checkbox" name="device_ids" value={d.id} checked={picked.has(d.id)} className="size-4 accent-[var(--brand)]"
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{d.name}</span> <span className="font-mono text-xs text-slate-500" dir="ltr">{d.ref}</span>
                  <span className="block truncate text-xs text-slate-500">{d.hint}</span>
                </span>
                {d.flagged && <span className="text-xs font-semibold text-danger">بلاغ مفتوح</span>}
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">لا توجد أجهزة مطابقة في هذا الموقع.</li>}
        </ul>
        <p className="mt-1 text-xs text-slate-500">المحدد: {picked.size}. يمكن إضافة أجهزة أخرى من الموقع نفسه أثناء الزيارة.</p>
        {state.errors?.device_ids && <p className="text-xs text-red-700">{state.errors.device_ids}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ug-reason" className={labelCls}>سبب الزيارة <span className="text-danger">*</span></label>
          <select id="ug-reason" name="urgent_reason" required defaultValue={why} className={input}>
            <option value="">اختر...</option>
            {Object.entries(URGENT_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ug-kind" className={labelCls}>نوع الزيارة</label>
          <select id="ug-kind" name="visit_type" defaultValue={kind} className={input}>
            <option value="emergency">طارئة</option><option value="repair">إصلاح</option><option value="reinspection">إعادة فحص</option><option value="other">أخرى</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="ug-notes" className={labelCls}>وصف البلاغ أو الطلب</label>
        <textarea id="ug-notes" name="notes" rows={3} maxLength={2000} defaultValue={typeof v.notes === "string" ? v.notes : ""} className={input}
          placeholder="ما أبلغ عنه العميل أو سبب الحضور؛ تفاصيل كل جهاز (الحالة الموجودة، الصور، الإجراء) تُسجل في الخطوة التالية" />
      </div>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">الزيارة الطارئة تُنشئ تقريرًا مستقلًا، ولا تُنشئ صيانة دورية ولا تغيّر موعد الصيانة الدورية للأجهزة. إن لم تُحل المشكلة تُفتح متابعة بمسؤول وتاريخ.</p>
      <button type="submit" disabled={pending || picked.size === 0} aria-busy={pending} className={btnPrimary}>{pending ? "جارٍ البدء..." : "بدء الزيارة الطارئة"}</button>
    </form>
  );
}
