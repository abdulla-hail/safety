"use client";

import { btnPrimary } from "@/components/ui/styles";

/**
 * خطأ غير متوقع أثناء تحميل الصفحة أو تنفيذ عملية (مثل تعذر الاتصال بقاعدة البيانات مؤقتًا).
 * لا يُعرض كـ«لا صلاحية» حتى لا يضلل المستخدم؛ إعادة المحاولة تعيد الطلب نفسه.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6 text-center" role="alert">
      <h1 className="text-lg font-bold text-amber-900">تعذر إكمال الطلب مؤقتًا</h1>
      <p className="mt-2 text-sm text-amber-900">
        حدث انقطاع في الاتصال بقاعدة البيانات أو خطأ غير متوقع. لم تتغير صلاحياتك، ولم يُحفظ أي جزء من العملية إن لم تظهر رسالة نجاح.
      </p>
      <button type="button" onClick={reset} className={`${btnPrimary} mt-4`}>إعادة المحاولة</button>
    </div>
  );
}
