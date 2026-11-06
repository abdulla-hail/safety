"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";
import { savePlatformLogo } from "./actions";

/** رفع شعار المنصة مع معاينة وفحص الأبعاد في المتصفح قبل الإرسال (والخادم يعيد التحقق) */
export default function PlatformLogoForm({ currentUrl }: { currentUrl: string | null }) {
  const [state, action, pending] = useActionState(savePlatformLogo, initialActionState);
  const [preview, setPreview] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [problem, setProblem] = useState("");
  const obj = useRef<string | null>(null);
  useEffect(() => () => { if (obj.current) URL.revokeObjectURL(obj.current); }, []);
  // بعد الحفظ الناجح تُستبدل المعاينة بالشعار المعتمد من الخادم
  const [seen, setSeen] = useState(state.attempt);
  if (seen !== state.attempt) {
    setSeen(state.attempt);
    if (state.ok) { setPreview(null); setInfo(""); }
  }

  function pick(f: File | undefined) {
    if (obj.current) URL.revokeObjectURL(obj.current);
    obj.current = null;
    setPreview(null); setInfo(""); setProblem("");
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setProblem("المسموح PNG أو JPEG أو WebP.");
    if (f.size > 1024 * 1024) return setProblem("الحد الأقصى 1 ميجابايت.");
    const url = URL.createObjectURL(f);
    obj.current = url;
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w < 64 || h < 64) setProblem(`الأبعاد ${w}×${h} صغيرة؛ الحد الأدنى 64×64.`);
      else if (w > 2048 || h > 2048) setProblem(`الأبعاد ${w}×${h} كبيرة؛ الحد الأقصى 2048×2048.`);
      else if (w / h > 6 || h / w > 3) setProblem("نسبة الأبعاد غير مناسبة لشعار.");
      setInfo(`${w}×${h} بكسل · ${Math.round(f.size / 1024)} ك.ب`);
      setPreview(url);
    };
    img.onerror = () => setProblem("تعذر قراءة الصورة.");
    img.src = url;
  }

  const shown = preview ?? currentUrl;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <form action={action} className="space-y-4">
        {state.message && <p role={state.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>}
        <div key={state.attempt ?? 0}>
          <label htmlFor="pl-logo" className="mb-1.5 block text-sm font-semibold text-slate-700">ملف الشعار الجديد</label>
          <input id="pl-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} className="text-sm" />
          <p className="mt-1 text-xs text-slate-500">PNG أو JPEG أو WebP، حتى 1 ميجابايت، من 64×64 إلى 2048×2048 بكسل. يُفضّل خلفية شفافة.</p>
          {info && <p className="mt-1 text-xs text-slate-600">{info}</p>}
          {problem && <p role="alert" className="mt-1 text-xs text-red-700">{problem}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button aria-busy={pending} type="submit" disabled={pending || !preview || !!problem} className={btnPrimary}>{pending ? "جارٍ الرفع والاعتماد..." : "اعتماد الشعار الجديد"}</button>
          {currentUrl && (
            <button aria-busy={pending} type="submit" name="reset" value="1" disabled={pending} className={btnSecondary}
              onClick={(e) => { if (!window.confirm("إعادة الشعار الافتراضي للمنصة؟")) e.preventDefault(); }}>إعادة الشعار الافتراضي</button>
          )}
        </div>
      </form>
      <aside className="space-y-3">
        <p className="text-sm font-bold">{preview ? "معاينة قبل الاعتماد" : "الشعار الحالي"}</p>
        <div className="flex items-center gap-3 rounded-xl bg-[#1e3a5f] p-4 text-white">
          <span className="flex size-10 items-center justify-center overflow-hidden rounded-lg bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shown ? <img src={shown} alt="" className="size-full object-contain p-0.5" /> : <span className="text-xs text-slate-400">افتراضي</span>}
          </span>
          <span className="text-sm font-bold">عين السلامة</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shown ? <img src={shown} alt="" className="mx-auto h-16 object-contain" /> : <p className="text-xs text-slate-400">الرمز الافتراضي</p>}
          <p className="mt-2 text-sm font-bold text-[#1e3a5f]">صفحة الدخول</p>
        </div>
      </aside>
    </div>
  );
}
