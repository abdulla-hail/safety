"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  created: "تمت الإضافة بنجاح.",
  saved: "تم حفظ التغييرات بنجاح.",
  archived: "تمت الأرشفة. يمكن استعادة السجل من عرض «المؤرشفة».",
  restored: "تمت استعادة السجل من الأرشيف.",
  deleted: "تم حذف السجل نهائيًا.",
  purged: "تم حذف الشركة وكل بياناتها نهائيًا، وحُفظت لقطة منها في سجل تدقيق المنصة.",
  assigned: "تم حفظ الإسناد.",
  invited: "تم إرسال الدعوة. سيحصل المستخدم على الوصول بعد تسجيل دخوله بحساب Google بالبريد نفسه.",
  requested: "تم إرسال الطلب وسيُراجع قريبًا.",
  closed: "أُغلقت الزيارة: حُفظت نتائج الأجهزة المفحوصة في سجلاتها وصدر تقرير الزيارة.",
};

/** رسالة نجاح بعد التحويل (?ok=code) تختفي تلقائيًا وتُزال من الرابط. */
export default function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const code = sp.get("ok");
  const [shown, setShown] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  // تحديث الحالة أثناء العرض عند تغيّر الرمز (نمط React الموصى به بدل التأثيرات)
  if (code !== seen) {
    setSeen(code);
    if (code) setShown(MESSAGES[code] ?? null);
  }

  useEffect(() => {
    if (!code) return;
    const next = new URLSearchParams(sp.toString());
    next.delete("ok");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [code, sp, router, pathname]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div role="status" className="toast-enter fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-green-700 px-4 py-3 text-sm text-white shadow-lg print:hidden">
      <span>{shown}</span>
      <button type="button" onClick={() => setShown(null)} className="rounded px-2 text-white/80 hover:bg-white/10" aria-label="إغلاق">×</button>
    </div>
  );
}
