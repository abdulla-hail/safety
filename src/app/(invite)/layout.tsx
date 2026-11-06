import { Suspense, type ReactNode } from "react";

export const instant = false;

/** صفحات الدعوة العامة: بلا إطار التطبيق، وتُعرض بهوية الجهة الداعية بعد التحقق من الرمز */
export default function InviteLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-slate-500" role="status">جارٍ التحقق من الدعوة...</p>}>
      {children}
    </Suspense>
  );
}
