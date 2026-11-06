"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";

/** شريط أدوات المعاينة (يختفي عند الطباعة). */
export default function PrintToolbar({ children, note }: { children?: ReactNode; note?: string }) {
  const router = useRouter();
  return (
    <div className="no-print sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
      <button type="button" onClick={() => window.print()} className={btnPrimary}>
        طباعة
      </button>
      <button type="button" onClick={() => router.back()} className={btnSecondary}>
        رجوع
      </button>
      {children}
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}
