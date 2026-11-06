"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { INSPECTION_STATUS, validateItem, type InspectionStatus } from "@/lib/visits";
import { saveVisitItem, type ItemSaveState } from "../../../my-work/actions";

export interface ItemView {
  id: string; version: number; deviceId: string; deviceName: string; deviceRef: string; location: string | null; system: string | null;
  serial: string | null; dueLabel: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } | null;
  openFaults: { id: string; ref: string; text: string }[]; expectedNextDue: string | null; inspectedBy: string | null; inspectedAt: string | null;
  fields: Record<string, string>;
}

type Opt = { value: string; label: string };
const STATUSES = Object.entries(INSPECTION_STATUS) as [InspectionStatus, (typeof INSPECTION_STATUS)[InspectionStatus]][];

/**
 * بند جهاز واحد في الزيارة. الحفظ صريح بزر، ولا تُعرض «تم الحفظ» إلا بعد تأكيد القاعدة وإصدار جديد.
 * ما يُكتب ولم يُحفظ يُنسخ في هذا المتصفح فقط (localStorage) لاستعادته بعد تحديث الصفحة؛ ليس عملًا دون اتصال.
 */
export default function ItemCard({ item, visitId, visitType, today, canReschedule, options, photos, closed }: {
  item: ItemView; visitId: string; visitType: string; today: string; canReschedule: boolean; closed: boolean;
  options: { results: Opt[]; statuses: Opt[]; actions: Opt[]; technicians: Opt[] };
  photos: ReactNode;
}) {
  const storeKey = `ays:visit-item:${item.id}:v${item.version}`;
  const [f, setF] = useState<Record<string, string>>(item.fields);
  const [version, setVersion] = useState(item.version);
  const [state, setState] = useState<ItemSaveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restorable, setRestorable] = useState<Record<string, string> | null>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (raw) setRestorable(JSON.parse(raw) as Record<string, string>);
    } catch { /* التخزين المحلي غير متاح: لا استعادة */ }
  }, [storeKey]);

  const set = (k: string, v: string) => {
    setF((prev) => {
      const next = { ...prev, [k]: v };
      try { window.localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* تجاهل */ }
      return next;
    });
    setDirty(true);
    setState(null);
  };

  const status = (f.inspection_status || "pending") as InspectionStatus;
  const urgent = visitType !== "periodic";
  const clientErrors = validateItem({
    inspection_status: status, result: f.result || null, status_after: f.status_after || null, skip_reason: f.skip_reason,
    follow_up_needed: f.follow_up_needed === "1", follow_up_technician_id: f.follow_up_technician_id || null, follow_up_due: f.follow_up_due || null,
    next_due_override: f.next_due_override || null, next_due_reason: f.next_due_reason,
  }, { visitType, canReschedule, today });
  const errors = { ...(state?.errors ?? {}) };

  async function save() {
    if (Object.keys(clientErrors).length) {
      setState({ ok: false, message: "راجع الحقول المعلَّمة؛ لم يُحفظ شيء.", errors: clientErrors });
      return;
    }
    setBusy(true);
    try {
      const r = await saveVisitItem({ itemId: item.id, visitId, visitType, version, fields: f });
      setState(r);
      if (r.ok && r.version) {
        try { window.localStorage.removeItem(storeKey); } catch { /* تجاهل */ }
        setVersion(r.version);
        setDirty(false);
        setRestorable(null);
        router.refresh();
      }
    } catch {
      setState({ ok: false, message: "انقطع الاتصال قبل تأكيد الحفظ؛ لم يُؤكَّد حفظ شيء. ما أدخلته باقٍ في النموذج — أعد المحاولة." });
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-red-700">{errors[k]}</p> : null);
  const text = (k: string, lbl: string, ph?: string, rows = 2) => (
    <div>
      <label htmlFor={`${item.id}-${k}`} className={labelCls}>{lbl}</label>
      <textarea id={`${item.id}-${k}`} rows={rows} value={f[k] ?? ""} placeholder={ph} maxLength={2000} disabled={closed}
        onChange={(e) => set(k, e.target.value)} className={input} />
      {fieldErr(k)}
    </div>
  );
  const select = (k: string, lbl: string, opts: Opt[], help?: string, required?: boolean) => (
    <div>
      <label htmlFor={`${item.id}-${k}`} className={labelCls}>{lbl}{required && <span className="text-danger"> *</span>}</label>
      <select id={`${item.id}-${k}`} value={f[k] ?? ""} disabled={closed} onChange={(e) => set(k, e.target.value)} className={input}
        aria-invalid={errors[k] ? true : undefined}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      {fieldErr(k)}
    </div>
  );

  return (
    <details open={status === "pending" && !closed} className="group rounded-xl border border-slate-200 bg-card shadow-sm open:shadow">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="font-bold">{item.deviceName} <span className="font-mono text-xs font-normal text-slate-500" dir="ltr">{item.deviceRef}</span></p>
          <p className="truncate text-xs text-slate-500">{[item.system, item.location, item.serial && `تسلسلي ${item.serial}`].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.dueLabel && <StatusBadge {...item.dueLabel} />}
          {item.openFaults.length > 0 && <StatusBadge label={`بلاغ مفتوح (${item.openFaults.length})`} tone="danger" />}
          <StatusBadge {...INSPECTION_STATUS[status]} />
          {dirty && <span className="text-xs font-semibold text-amber-700">تغييرات غير محفوظة</span>}
        </div>
      </summary>

      <div className="space-y-4 border-t border-slate-100 p-4">
        {restorable && !closed && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            توجد مدخلات لهذا الجهاز لم تُحفظ في الخادم (محفوظة في هذا المتصفح فقط).
            <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={() => { setF(restorable); setDirty(true); setRestorable(null); }}>استعادتها</button>
            <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={() => { try { window.localStorage.removeItem(storeKey); } catch { /* تجاهل */ } setRestorable(null); }}>تجاهلها</button>
          </div>
        )}
        {item.openFaults.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-xs text-red-800">
            {item.openFaults.map((x) => <li key={x.id}><a href={`/faults/${x.id}`} className="font-semibold underline">{x.ref}</a> — {x.text}</li>)}
          </ul>
        )}

        <fieldset disabled={closed}>
          <legend className={labelCls}>حالة الجهاز في هذه الزيارة <span className="text-danger">*</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATUSES.map(([k, s]) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${status === k ? "border-brand bg-brand-soft font-semibold" : "border-slate-200 hover:border-slate-300"}`}>
                <input type="radio" name={`${item.id}-status`} value={k} checked={status === k} onChange={() => set("inspection_status", k)} className="accent-[var(--brand)]" />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        {(status === "unable" || status === "not_found") && text("skip_reason", status === "unable" ? "سبب تعذر الفحص *" : "ما الذي وُجد بدل الجهاز؟ *", "مثال: الغرفة مقفلة ولم يتوفر المفتاح")}

        {(status === "inspected" || status === "pending") && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {select("action", "العملية المنفذة", options.actions)}
              {select("result", "نتيجة الفحص", options.results, "هل اجتاز الجهاز الفحص؟", status === "inspected")}
              {select("status_after", "الحالة التشغيلية بعد الفحص", options.statuses, "حالة الجهاز الآن، منفصلة عن نتيجة الفحص.", status === "inspected")}
            </div>
            {urgent && (
              <div className="grid gap-4 sm:grid-cols-2">
                {text("findings", "الوصف والحالة الموجودة والتقييم", "ما وُجد عند الوصول وتقييمك للعطل")}
                {select("resolved", "هل حُلت المشكلة؟", [{ value: "yes", label: "نعم، حُلت" }, { value: "no", label: "لا، تحتاج إصلاحًا أو متابعة" }])}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {!urgent && text("findings", "الملاحظات الفنية عند الفحص")}
              {text("actions_taken", "الإجراءات المنفذة")}
              {text("readings", "القراءات (سطر لكل قراءة: الاسم = القيمة)", "الضغط = 12 بار")}
              {text("parts", "القطع والمواد المستخدمة (سطر لكل بند: الاسم × الكمية)", "حلقة إحكام × 2")}
              {text("recommendations", "التوصيات")}
              {text("notes", "ملاحظات")}
            </div>
          </>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={f.follow_up_needed === "1"} disabled={closed} onChange={(e) => set("follow_up_needed", e.target.checked ? "1" : "")} className="size-4 accent-[var(--brand)]" />
            يحتاج متابعة أو طلب إصلاح
          </label>
          {f.follow_up_needed === "1" && (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {select("follow_up_technician_id", "المسؤول *", options.technicians)}
              <div>
                <label htmlFor={`${item.id}-fud`} className={labelCls}>تاريخ المتابعة *</label>
                <input id={`${item.id}-fud`} type="date" min={today} value={f.follow_up_due ?? ""} disabled={closed} onChange={(e) => set("follow_up_due", e.target.value)} className={input} />
                {fieldErr("follow_up_due")}
              </div>
              {text("follow_up_note", "المطلوب في المتابعة")}
              <p className="text-xs text-slate-500 sm:col-span-3">يُفتح بلاغ متابعة بحالة «مفتوح» ومسؤول وتاريخ عند إغلاق الزيارة، ويُشعَر المسؤول.</p>
            </div>
          )}
        </div>

        {!urgent && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            الموعد القادم يُحسب تلقائيًا عند إغلاق الزيارة من تاريخ الفحص الفعلي وفترة خطة الجهاز
            {item.expectedNextDue ? <> (المتوقع إن أُغلقت اليوم: <b dir="ltr">{item.expectedNextDue}</b>)</> : " (الجهاز بلا خطة صيانة: لا يُحدَّد موعد)"}.
            لا يُحسب للجهاز غير المفحوص.
            {canReschedule && status === "inspected" && (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold text-primary">تحديد موعد مختلف (استثنائي وموثق)</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`${item.id}-ndo`} className={labelCls}>الموعد القادم</label>
                    <input id={`${item.id}-ndo`} type="date" value={f.next_due_override ?? ""} disabled={closed} onChange={(e) => set("next_due_override", e.target.value)} className={input} />
                    {fieldErr("next_due_override")}
                  </div>
                  {text("next_due_reason", "سبب التعديل")}
                </div>
              </details>
            )}
          </div>
        )}

        {item.inspectedAt && <p className="text-xs text-slate-500">سُجّل بواسطة {item.inspectedBy ?? "—"} · {item.inspectedAt}</p>}

        {!closed && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy} aria-busy={busy} className={btnPrimary}>
              {busy ? "جارٍ الحفظ..." : status === "pending" ? "حفظ مسودة" : "حفظ نتيجة الجهاز"}
            </button>
            {state && <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
          </div>
        )}
        {photos}
      </div>
    </details>
  );
}
