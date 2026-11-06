"use client";

import { useState } from "react";

/**
 * صورة مرفق تُعاد محاولة تحميلها تلقائيًا (انقطاع مؤقت أو انتهاء رابط موقّع) بدل أن يظهر اسم الملف وحده.
 * بعد فشل المحاولتين يظهر «تعذر تحميل الصورة» مع زر إعادة المحاولة؛ الملف نفسه محفوظ ولم يُفقد.
 */
export default function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}r=${attempt}`;
  if (failed) {
    return (
      <span className={`flex flex-col items-center justify-center gap-1 bg-slate-50 p-1 text-center text-[10px] text-slate-500 ${className ?? ""}`}>
        تعذر تحميل الصورة
        <button type="button" onClick={(e) => { e.preventDefault(); setFailed(false); setAttempt((a) => a + 1); }}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-semibold text-slate-700">إعادة المحاولة</button>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={url} src={url} alt={alt} className={className}
      onError={() => { if (attempt < 1) setTimeout(() => setAttempt((a) => a + 1), 1200); else setFailed(true); }} />
  );
}
