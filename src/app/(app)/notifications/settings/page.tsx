import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { btnSecondary } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { notificationKinds } from "@/lib/labels";
import PrefsForm from "./PrefsForm";

export const metadata = { title: "تفضيلات الإشعارات | عين السلامة" };

/** يحدد كل مستخدم أنواع الإشعارات التي تصله؛ ما يصل أساسًا تحدده صلاحياته (الأنشطة لمن يتابع الفريق) */
export default async function NotificationSettingsPage() {
  const ctx = await requireOrg();
  const supabase = await createClient();
  const { data } = await supabase.from("notification_preferences").select("kind, enabled").eq("company_id", ctx.orgId).eq("user_id", ctx.user.id);
  const disabled = new Set((data ?? []).filter((p) => !p.enabled).map((p) => p.kind));
  // أنشطة الفريق تصل لمن لا يعمل ميدانيًا فقط أو يملك الإسناد؛ عروض الأسعار لمن يرى العروض
  const office = !ctx.can("field.assigned") || ctx.can("assignments.manage");
  const applies = (group: string) =>
    group === "أنشطة الفنيين" ? office : group === "عروض الأسعار" ? office && ctx.canAny("quotes.view", "quotes.manage") : true;
  const kinds = notificationKinds.map((k) => ({ ...k, applies: applies(k.group) }));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="تفضيلات الإشعارات" crumbs={[{ label: "الإشعارات", href: "/notifications" }, { label: "التفضيلات" }]}
        description="اختر الأحداث التي تريد إشعارك بها. الإشعارات تصل فورًا داخل المنصة (الجرس أعلى الصفحة) دون تحديث الصفحة."
        actions={<Link href="/notifications" className={btnSecondary}>سجل الإشعارات</Link>} />
      <PrefsForm kinds={kinds} enabled={notificationKinds.map((k) => k.kind).filter((k) => !disabled.has(k))} />
      <p className="text-xs text-slate-500">البريد الإلكتروني وقنوات أخرى يمكن إضافتها لاحقًا؛ الإشعارات حاليًا داخل المنصة فقط.</p>
    </div>
  );
}
