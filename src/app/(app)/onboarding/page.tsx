import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnSecondary, card, cardHeader, cardTitle } from "@/components/ui/styles";
import { cookies } from "next/headers";
import { platformHome, requireUser } from "@/lib/auth/context";
import { INVITE_NEXT_COOKIE, readCookiePath, safeInvitePath } from "@/lib/invite-next";
import { companyMemberStatus, roleLabel } from "@/lib/labels";

export const metadata: Metadata = { title: "العضوية | عين السلامة" };

const COMPANY_STATE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral"; reason: string }> = {
  approved: { label: "نشطة", tone: "success", reason: "" },
  pending: { label: "بانتظار تفعيل الشركة", tone: "warning", reason: "الشركة لم تُفعّل بعد." },
  suspended: { label: "موقوفة أو مؤرشفة", tone: "danger", reason: "الشركة موقوفة أو مؤرشفة من إدارة المنصة." },
  rejected: { label: "غير متاحة", tone: "neutral", reason: "الشركة غير متاحة." },
};

export default async function OnboardingPage() {
  const ctx = await requireUser();
  if (ctx.active) redirect("/dashboard");
  if (ctx.platformRole === "owner") redirect("/platform-admin/assistants");
  if (ctx.platformRole === "assistant") redirect(platformHome(ctx));
  // دخل من رابط دعوة ولم يعد إليه بعد تسجيل الدخول: نعيده لصفحة الدعوة ليقبلها (بدل «لا توجد عضوية»)
  const pendingInvite = safeInvitePath(readCookiePath((await cookies()).get(INVITE_NEXT_COOKIE)?.value));
  if (pendingInvite) redirect(pendingInvite);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="مرحبًا بك في عين السلامة"
        description="تم تسجيل دخولك، لكن لا توجد لديك عضوية فعّالة في شركة. الانضمام لأي شركة يتم برابط دعوة من مديرها فقط."
      />

      {ctx.memberships.length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>عضوياتك</h2></div>
          <ul className="divide-y divide-slate-100">
            {ctx.memberships.map((m) => {
              const company = COMPANY_STATE[m.organization_status] ?? COMPANY_STATE.rejected;
              const memberReason = m.member_status === "suspended" ? "عضويتك معطّلة. تواصل مع مدير الشركة."
                : m.member_status === "removed" ? "أُزيلت عضويتك من الشركة." : "";
              return (
                <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-semibold">{m.organization_name} <span className="text-xs font-normal text-slate-500">· {roleLabel(m.role, m.is_primary)}</span></p>
                    <p className="mt-1 text-sm text-slate-500">{memberReason || company.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge label={company.label} tone={company.tone} />
                    <StatusBadge {...(companyMemberStatus[m.member_status] ?? { label: m.member_status, tone: "neutral" })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={`${card} space-y-3 p-5 text-sm leading-7 text-slate-700`}>
        <h2 className={cardTitle}>كيف أنضم إلى شركة؟</h2>
        <ol className="list-decimal space-y-1 ps-5">
          <li>اطلب من مدير شركتك إرسال رابط دعوة إلى بريدك <b dir="ltr">{ctx.user.email}</b>.</li>
          <li>افتح الرابط وأنت مسجل الدخول بهذا البريد نفسه، ثم اضغط «قبول الدعوة».</li>
          <li>إن كنت صاحب شركة صيانة جديدة، تواصل مع إدارة المنصة لتسجيل شركتك ودعوتك كمدير لها.</li>
        </ol>
        <p className="text-xs text-slate-500">إن وصلتك الدعوة على بريد آخر، سجّل الخروج ثم ادخل بحساب Google لذلك البريد.</p>
      </section>

      <p className="text-center text-xs text-slate-500">مساعدو مالك المنصة يُضافون بدعوة مباشرة من المالك تصل بالبريد أو برابط شخصي.</p>

      <form action="/auth/signout" method="post" className="text-center">
        <button type="submit" className={btnSecondary}>تسجيل الخروج</button>
      </form>
    </div>
  );
}
