"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * «تثبيت التطبيق»: يظهر فقط حين يمكن التثبيت فعلًا (المتصفح أطلق beforeinstallprompt) أو على iPhone/iPad
 * حيث التثبيت يدوي من «مشاركة ← إضافة إلى الشاشة الرئيسية». يختفي داخل التطبيق المثبّت. الأيقونة شعار الشركة النشطة.
 */
export default function InstallAppButton({ companyName }: { companyName: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // القراءة بعد التحميل (غير متاحة أثناء العرض في الخادم)
    const t = setTimeout(() => {
      setInstalled(standalone);
      setIos(!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent));
    }, 0);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  async function install() {
    if (!prompt) { setShowHelp((s) => !s); return; }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => void install()} title={`تثبيت ${companyName} كتطبيق`}
        className="icon-hover inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-soft px-2.5 py-1.5 text-xs font-semibold text-brand-strong transition hover:border-brand active:scale-[0.97]">
        <Icon name="download" className="size-4" />
        <span className="hidden sm:inline">تثبيت التطبيق</span>
      </button>
      {showHelp && (
        <div role="dialog" aria-label="تثبيت التطبيق على iPhone" className="absolute end-0 top-11 z-40 w-64 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-700 shadow-lg">
          <p className="mb-1 font-bold">تثبيت {companyName} على iPhone / iPad</p>
          <ol className="list-decimal space-y-1 ps-4">
            <li>افتح المنصة في متصفح Safari.</li>
            <li>اضغط زر «مشاركة» أسفل الشاشة.</li>
            <li>اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».</li>
          </ol>
          <p className="mt-2 text-slate-500">تظهر الأيقونة بشعار شركتك.</p>
          <button type="button" onClick={() => setShowHelp(false)} className="mt-2 font-semibold text-brand-strong underline">إغلاق</button>
        </div>
      )}
    </div>
  );
}
