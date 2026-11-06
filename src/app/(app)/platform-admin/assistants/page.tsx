import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import InvitationRowActions from "@/components/InvitationRowActions";
import { card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { mailConfigured } from "@/lib/mail";
import { effectiveInvitationStatus } from "@/lib/invitations";
import { assistantInvitationStatus, assistantRequestStatus, assistantStatus, PLATFORM_PERMISSION_LABELS } from "@/lib/platform-permissions";
import { AssistantEditor, InviteAssistantForm } from "./AssistantForms";
import { resendAssistantInvitation, revokeAssistantInvitation } from "./actions";

export const metadata: Metadata = { title: "مساعدو المالك | عين السلامة" };

type Inv = { id: string; email: string; full_name: string | null; permissions: string[]; status: string; expires_at: string; created_at: string; email_sent_at: string | null; accepted_at: string | null };
type Asst = { user_id: string; email: string; full_name: string | null; permissions: string[]; status: string; granted_at: string; updated_at: string };
type Req = { id: string; email: string; full_name: string | null; status: string; created_at: string; reviewed_at: string | null };
type Audit = { id: string; action: string; actor_email: string | null; details: Record<string, unknown>; created_at: string };

const permText = (ps: string[]) => ps.map((p) => PLATFORM_PERMISSION_LABELS[p as keyof typeof PLATFORM_PERMISSION_LABELS] ?? p).join("، ");
const AUDIT: Record<string, string> = {
  assistant_invited: "دعوة مساعد", assistant_invitation_revoked: "إلغاء دعوة", assistant_invitation_emailed: "إرسال بريد الدعوة",
  assistant_invitation_accepted: "قبول دعوة", assistant_granted: "منح صفة المساعد", assistant_updated: "تعديل مساعد", platform_logo_updated: "تغيير شعار المنصة",
};

/** دعوات ومساعدو المالك: للمالك الأساسي فقط (RLS ودوال القاعدة تمنع غيره أيضًا). */
export default async function AssistantsPage() {
  const ctx = await requireUser();
  if (ctx.platformRole !== "owner") redirect("/forbidden");
  const supabase = await createClient();
  const [invites, assistants, requests, audit] = await Promise.all([
    supabase.from("platform_assistant_invitations").select("id, email, full_name, permissions, status, expires_at, created_at, email_sent_at, accepted_at")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("platform_assistants").select("user_id, email, full_name, permissions, status, granted_at, updated_at").order("granted_at"),
    supabase.from("platform_assistant_requests").select("id, email, full_name, status, created_at, reviewed_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("platform_audit_log").select("id, action, actor_email, details, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const invs = (invites.data ?? []) as Inv[];
  const list = (assistants.data ?? []) as Asst[];
  const oldRequests = (requests.data ?? []) as Req[];

  return (
    <div className="space-y-6">
      <PageHeader title="مساعدو مالك المنصة" crumbs={[{ label: "إدارة الشركات", href: "/platform-admin" }, { label: "مساعدو المالك" }]}
        description="يُضاف المساعد بدعوة منك فقط، بصلاحيات تحددها قبل الإرسال. لا تُمنح الصفة إلا بعد قبوله بحساب Google للبريد نفسه. المساعد لا يدعو مساعدين ولا يعدّل صلاحياته، ولا يصل إلى بيانات الشركات التشغيلية." />

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>دعوة مساعد جديد</h2></div>
        <div className="p-5"><InviteAssistantForm mailReady={mailConfigured()} /></div>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الدعوات ({invs.length})</h2></div>
        <ul className="divide-y divide-slate-100">
          {invs.map((i) => {
            const st = effectiveInvitationStatus(i.status, i.expires_at);
            return (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p><span dir="ltr" className="font-semibold">{i.email}</span>{i.full_name && ` · ${i.full_name}`}</p>
                  <p className="text-xs text-slate-500">{permText(i.permissions)}</p>
                  <p className="text-xs text-slate-500">أُنشئت {formatDateTime(i.created_at)} · {i.email_sent_at ? `أُرسل البريد ${formatDateTime(i.email_sent_at)}` : "لم يُرسل بريد (رابط يدوي)"}
                    {st === "accepted" ? ` · قُبلت ${formatDateTime(i.accepted_at)}` : ` · تنتهي ${formatDateTime(i.expires_at)}`}</p>
                </div>
                <div className="flex items-start gap-3">
                  <StatusBadge {...(assistantInvitationStatus[st] ?? { label: st, tone: "neutral" })} />
                  {st !== "accepted" && (
                    <InvitationRowActions invitationId={i.id} canResend canRevoke={st === "pending"} resend={resendAssistantInvitation} revoke={revokeAssistantInvitation} />
                  )}
                </div>
              </li>
            );
          })}
          {invs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد دعوات بعد.</li>}
        </ul>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>المساعدون ({list.filter((a) => a.status === "active").length} نشط)</h2></div>
        <ul className="divide-y divide-slate-100">
          {list.map((a) => (
            <li key={a.user_id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[1fr_1.4fr]">
              <div>
                <p className="font-semibold">{a.full_name ?? "—"} <span className="font-normal text-slate-500" dir="ltr">{a.email}</span></p>
                <p className="mt-1"><StatusBadge {...(assistantStatus[a.status] ?? { label: a.status, tone: "neutral" })} /></p>
                <p className="mt-1 text-xs text-slate-500">منذ {formatDateTime(a.granted_at)} · آخر تعديل {formatDateTime(a.updated_at)}</p>
                <p className="mt-1 text-xs text-slate-600">{permText(a.permissions) || "بلا صلاحيات"}</p>
              </div>
              <AssistantEditor userId={a.user_id} permissions={a.permissions} status={a.status} />
            </li>
          ))}
          {list.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا يوجد مساعدون بعد.</li>}
        </ul>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>سجل تدقيق المنصة</h2></div>
        <ul className="divide-y divide-slate-100 text-sm">
          {((audit.data ?? []) as Audit[]).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
              <span>{AUDIT[a.action] ?? a.action} {typeof a.details?.email === "string" && <span className="text-xs text-slate-500" dir="ltr">{a.details.email}</span>}
                <span className="text-xs text-slate-500"> · بواسطة <span dir="ltr">{a.actor_email ?? "النظام"}</span></span></span>
              <span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span>
            </li>
          ))}
          {(audit.data ?? []).length === 0 && <li className="px-5 py-4 text-slate-500">لا توجد عمليات مسجلة بعد.</li>}
        </ul>
      </section>

      {oldRequests.length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>طلبات الانضمام القديمة (أرشيف للاطلاع)</h2></div>
          <p className="px-5 pt-3 text-xs text-slate-500">أُلغي مسار الطلبات واستُبدل بالدعوات؛ تبقى هذه السجلات كما هي دون تعديل.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {oldRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                <span>{r.full_name ?? "—"} <span className="text-xs text-slate-500" dir="ltr">{r.email}</span></span>
                <span className="flex items-center gap-2 text-xs text-slate-500">{formatDateTime(r.reviewed_at ?? r.created_at)}
                  <StatusBadge {...(assistantRequestStatus[r.status] ?? { label: r.status, tone: "neutral" })} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
