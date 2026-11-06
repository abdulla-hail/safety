"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initialActionState } from "@/lib/action-state";
import { uploadAttachment } from "@/app/(app)/attachments/actions";
import { btnSecondary, btnSm, input } from "@/components/ui/styles";

/** تصنيفات صور الزيارة؛ الأخيران يتطلبان ترحيل 20261108000100 (يمررهما من يعرضهما) */
export const PHOTO_STAGES: Record<string, string> = {
  general: "صورة عامة للزيارة", before: "قبل الصيانة", after: "بعد الصيانة", fault: "توثيق عطل", other: "مرفق آخر",
};

interface Pick { key: string; file: File; url: string | null; status: "ready" | "uploading" | "done" | "failed"; message?: string }

/**
 * رفع ملف أو عدة ملفات (من الجهاز أو كاميرا الجوال): معاينة مصغرة قبل الحفظ مع إزالة أي ملف، ثم كل ملف في طلب مستقل
 * (يبقى ضمن حد حجم الاستضافة) وتُعرض نتيجة كل ملف؛ فشل ملف لا يلغي ما نجح، ويمكن إعادة المحاولة للفاشل. لا تُستبدل أي صورة سابقة.
 */
export default function UploadForm({ entityType, entityId, devices, fixedDeviceId, surveyItems, stages = ["general", "before", "after"] }: {
  /** لصور المعاينة: ربط الصورة ببند من بنود المعاينة (اختياري) */
  surveyItems?: { id: string; name: string }[];
  entityType: string; entityId: string;
  /** لصور الزيارة: ربط الصورة بجهاز من أجهزة الزيارة (اختياري؛ الصورة العامة تُحفظ بلا جهاز) */
  devices?: { id: string; name: string }[];
  /** صور بند جهاز محدد في شاشة تنفيذ الزيارة (بلا قائمة اختيار الجهاز) */
  fixedDeviceId?: string;
  stages?: string[];
}) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [stage, setStage] = useState(fixedDeviceId ? "before" : "general");
  const [chosenDevice, setDeviceId] = useState("");
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const router = useRouter();
  const deviceId = fixedDeviceId ?? chosenDevice;
  const id = `file-${entityId}-${fixedDeviceId ?? "all"}`;

  // روابط المعاينة تُحرَّر عند إزالة الملف أو مغادرة الصفحة فقط
  const urls = useRef(new Set<string>());
  useEffect(() => { const all = urls.current; return () => all.forEach((u) => URL.revokeObjectURL(u)); }, []);

  function add(list: FileList | null) {
    const next = Array.from(list ?? []).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, status: "ready" as const,
    }));
    next.forEach((p) => p.url && urls.current.add(p.url));
    setPicks((p) => [...p.filter((x) => x.status !== "done"), ...next]);
    setInputKey((k) => k + 1);
  }
  const remove = (key: string) => setPicks((p) => {
    const gone = p.find((x) => x.key === key);
    if (gone?.url) { URL.revokeObjectURL(gone.url); urls.current.delete(gone.url); }
    return p.filter((x) => x.key !== key);
  });

  async function upload() {
    setBusy(true);
    let anyOk = false;
    for (const p of picks.filter((x) => x.status === "ready" || x.status === "failed")) {
      setPicks((all) => all.map((x) => (x.key === p.key ? { ...x, status: "uploading", message: undefined } : x)));
      const fd = new FormData();
      fd.set("entity_type", entityType); fd.set("entity_id", entityId); fd.set("file", p.file);
      if (devices || fixedDeviceId) { fd.set("photo_stage", stage); if (deviceId) fd.set("device_id", deviceId); }
      if (surveyItems) { fd.set("photo_stage", stage); if (itemId) fd.set("survey_item_id", itemId); }
      let ok = false, message = "";
      try {
        const r = await uploadAttachment(initialActionState, fd);
        ok = !!r.ok; message = r.message ?? "";
      } catch {
        message = "انقطع الاتصال أثناء الرفع؛ لم يُؤكَّد حفظ الملف.";
      }
      anyOk ||= ok;
      setPicks((all) => all.map((x) => (x.key === p.key ? { ...x, status: ok ? "done" : "failed", message } : x)));
    }
    setBusy(false);
    if (anyOk) router.refresh();
  }

  const pending = picks.filter((p) => p.status === "ready" || p.status === "failed");
  const failed = picks.filter((p) => p.status === "failed").length;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (pending.length) void upload(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={`${btnSecondary} ${btnSm} cursor-pointer`}>اختيار صور أو ملفات</label>
        <input key={inputKey} id={id} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only"
          onChange={(e) => add(e.target.files)} />
        {(devices || fixedDeviceId || surveyItems) && (
          <select aria-label="تصنيف الصورة" value={stage} onChange={(e) => setStage(e.target.value)} className={`${input} !w-auto text-sm`}>
            {stages.map((s) => <option key={s} value={s}>{PHOTO_STAGES[s] ?? s}</option>)}
          </select>
        )}
        {!fixedDeviceId && devices && devices.length > 0 && (
          <select aria-label="الجهاز المرتبط" value={chosenDevice} onChange={(e) => setDeviceId(e.target.value)} className={`${input} !w-auto text-sm`}>
            <option value="">بلا جهاز (عامة للزيارة)</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {surveyItems && surveyItems.length > 0 && (
          <select aria-label="البند المرتبط" value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${input} !w-auto max-w-56 text-sm`}>
            <option value="">بلا بند (صورة عامة)</option>
            {surveyItems.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <button aria-busy={busy} type="submit" disabled={busy || pending.length === 0} className={`${btnSecondary} ${btnSm}`}>
          {busy ? "جارٍ الرفع..." : failed ? `إعادة رفع الفاشل (${failed})` : pending.length > 1 ? `رفع ${pending.length} ملفات` : "رفع"}
        </button>
      </div>
      {picks.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-live="polite">
          {picks.map((p) => (
            <li key={p.key} className={`w-24 overflow-hidden rounded-lg border text-[10px] ${p.status === "failed" ? "border-red-400" : p.status === "done" ? "border-green-400" : "border-slate-200"}`}>
              {p.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.file.name} className="h-16 w-full object-cover" /></a>
                : <div className="flex h-16 items-center justify-center bg-slate-50 font-bold text-slate-500">PDF</div>}
              <div className="space-y-0.5 p-1">
                <p className="truncate" title={p.file.name}>{p.file.name}</p>
                <p className={p.status === "failed" ? "text-red-700" : p.status === "done" ? "text-green-700" : "text-slate-500"}>
                  {p.status === "ready" ? "لم يُرفع بعد" : p.status === "uploading" ? "جارٍ الرفع..." : p.status === "done" ? "✓ حُفظ" : `✗ ${p.message ?? "فشل"}`}
                </p>
                {(p.status === "ready" || p.status === "failed") && !busy && (
                  <button type="button" onClick={() => remove(p.key)} className="text-red-700 underline">إزالة</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
