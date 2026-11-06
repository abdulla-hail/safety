import Link from "next/link";
import { btnPrimary } from "@/components/ui/styles";

export const metadata = { title: "غير مصرح | عين السلامة" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-5xl font-extrabold text-slate-300">403</p>
      <h1 className="mt-4 text-xl font-bold">ليست لديك صلاحية الوصول إلى هذه الصفحة</h1>
      <p className="mt-2 text-sm text-slate-500">إذا كنت تحتاج هذا الوصول لعملك، اطلب من مدير الشركة منحك الصلاحية المناسبة.</p>
      <Link href="/dashboard" className={`${btnPrimary} mt-6`}>العودة إلى لوحة التحكم</Link>
    </div>
  );
}
