"use client";

import { useEffect, useState } from "react";
import { btnPrimary } from "@/components/ui/styles";

/** ينتظر اكتمال تحميل صور المستند (أو مهلة) قبل فتح نافذة الطباعة، حتى لا يخرج PDF بصور فارغة */
export async function printWhenImagesReady(timeoutMs = 10_000) {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".print-doc img"))
    .filter((img) => !document.documentElement.classList.contains("print-hide-photos") || !img.closest(".doc-photos"));
  imgs.forEach((img) => { img.loading = "eager"; });
  await Promise.race([
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.addEventListener("load", () => r(), { once: true }); img.addEventListener("error", () => r(), { once: true }); })))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
  window.print();
}

/**
 * زر الطباعة مع خيار «مع الصور / بدون صور». الاختيار يُطبَّق على المعاينة فورًا (ما تراه هو ما يُطبع) ويُحفظ في المتصفح.
 * hasPhotos=false يُخفي الخيار للمستندات بلا صور.
 */
export default function PrintPhotosControl({ hasPhotos = true, label = "طباعة / حفظ PDF" }: { hasPhotos?: boolean; label?: string }) {
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try { if (window.localStorage.getItem("ays:print-photos") === "0") setWithPhotos(false); } catch { /* التخزين المحلي غير متاح */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("print-hide-photos", hasPhotos && !withPhotos);
    try { window.localStorage.setItem("ays:print-photos", withPhotos ? "1" : "0"); } catch { /* تجاهل */ }
    return () => document.documentElement.classList.remove("print-hide-photos");
  }, [withPhotos, hasPhotos]);

  return (
    <>
      {hasPhotos && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs" role="radiogroup" aria-label="الصور في الطباعة">
          {[[true, "مع الصور"], [false, "بدون صور"]].map(([v, l]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={withPhotos === v} onClick={() => setWithPhotos(v as boolean)}
              className={`rounded-md px-3 py-1.5 font-semibold ${withPhotos === v ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l as string}</button>
          ))}
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => { setBusy(true); void printWhenImagesReady().finally(() => setBusy(false)); }} className={btnPrimary}>
        {busy ? "تجهيز الصور..." : label}
      </button>
    </>
  );
}
