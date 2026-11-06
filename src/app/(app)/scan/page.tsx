import PageHeader from "@/components/ui/PageHeader";
import { card } from "@/components/ui/styles";
import { requireUser } from "@/lib/auth/context";
import { param, type SearchParams } from "@/lib/list";
import Scanner from "./Scanner";

export const metadata = { title: "مسح رمز جهاز | عين السلامة" };

const MESSAGES: Record<string, [string, string]> = {
  forbidden: ["غير مصرح بعرض هذا الجهاز", "هذا الجهاز مسجل في المنصة، لكن حسابك لا يملك صلاحية الاطلاع عليه. إذا كنت فنيًا يخدم هذا العميل، اطلب من مدير شركتك إسنادك إليه أو منحك الصلاحية."],
  not_found: ["رمز غير معروف", "لم يُعثر على جهاز بهذا الرمز. تأكد من مسح الملصق الصحيح."],
  removed: ["الجهاز لم يعد مسجلًا", "هذا الرمز كان لجهاز حُذف من المنصة، ولا يُعاد استخدامه لأي جهاز آخر."],
  invalid: ["رمز غير صالح", "صيغة الرمز غير صحيحة."],
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const msg = MESSAGES[param(sp, "status")];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="مسح رمز جهاز" description="وجّه الكاميرا إلى ملصق QR أو الباركود على الجهاز، أو استخدم ماسح باركود (يكتب الرمز في الحقل ثم Enter)." />
      {msg && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-bold">{msg[0]}</p>
          <p className="mt-1 leading-7">{msg[1]}</p>
          {param(sp, "t") && <p className="mt-1 font-mono text-xs" dir="ltr">{param(sp, "t")}</p>}
        </div>
      )}
      <section className={`${card} p-5`}><Scanner /></section>
    </div>
  );
}
