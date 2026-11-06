import { Suspense, type ReactNode } from "react";

export const instant = false;

export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-200 print:min-h-0 print:bg-white">
      <Suspense fallback={<p className="p-8 text-center text-sm text-slate-500" role="status">جارٍ تجهيز المعاينة...</p>}>
        {children}
      </Suspense>
    </div>
  );
}
