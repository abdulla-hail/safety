"use server";

import { revalidatePath } from "next/cache";
import { getContext, invalidateMyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { fail, intOrNull, str, type ActionState } from "@/lib/action-state";
import { rpcErrorMessage } from "@/lib/invitations";
import { siteUrl } from "@/lib/codes";
import { assistantInviteEmail, sendMail } from "@/lib/mail";
import { PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_LABELS } from "@/lib/platform-permissions";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const validPerms = (fd: FormData) =>
  [...new Set(fd.getAll("permissions").map(String))].filter((p) => (PLATFORM_PERMISSIONS as readonly string[]).includes(p));

/** للمالك الأساسي فقط (تتحقق القاعدة بـ require_platform_admin)؛ المساعد لا يدعو ولا يمنح صلاحيات */
async function owner() {
  const ctx = await getContext();
  return ctx?.platformRole === "owner" ? ctx : null;
}

/** ينشئ رابط الدعوة، ثم يحاول البريد؛ لا يُعرض «أُرسل» ولا يُسجَّل إلا بعد نجاح الإرسال فعليًا */
async function deliver(prev: ActionState, data: { invitation_id?: string; token?: string; email?: string; expires_at?: string },
  name: string | null, perms: string[], created: string): Promise<ActionState> {
  if (!data?.token || !data.invitation_id) return { ok: false, message: "لم يُنشأ رابط الدعوة.", attempt: (prev.attempt ?? 0) + 1 };
  const url = `${await siteUrl()}/assistant-invite/${encodeURIComponent(data.token)}`;
  const expires = new Date(data.expires_at ?? Date.now()).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const mail = assistantInviteEmail(url, name, perms.map((p) => PLATFORM_PERMISSION_LABELS[p as keyof typeof PLATFORM_PERMISSION_LABELS] ?? p), expires);
  const res = await sendMail(data.email ?? "", mail.subject, mail.html, mail.text);
  let note: string;
  if (res.sent) {
    const supabase = await createClient();
    await supabase.rpc("platform_mark_assistant_invitation_emailed", { p_invitation: data.invitation_id });
    note = `${created} وأُرسلت رسالة الدعوة إلى بريده.`;
  } else if (res.reason === "not_configured") {
    note = `${created} لم يُرسل بريد: لا توجد خدمة بريد مهيأة في المنصة. انسخ الرابط وأرسله يدويًا.`;
  } else {
    note = `${created} تعذر إرسال البريد (${res.detail ?? "خطأ"})؛ لم يُرسل شيء. انسخ الرابط وأرسله يدويًا.`;
  }
  revalidatePath("/platform-admin/assistants");
  return { ok: true, message: note, attempt: (prev.attempt ?? 0) + 1, invite: { url, email: data.email ?? "", expiresAt: data.expires_at ?? "", label: "مساعد المالك" } };
}

export async function inviteAssistant(prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await owner())) return fail(prev, fd, "دعوة المساعدين لمالك المنصة فقط.");
  const email = str(fd, "email").toLowerCase();
  const perms = validPerms(fd);
  if (!EMAIL.test(email)) return fail(prev, fd, "البريد غير صالح.", { email: "غير صالح" });
  if (!perms.length) return fail(prev, fd, "حدد صلاحية واحدة على الأقل.");
  const name = str(fd, "full_name").slice(0, 200) || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_invite_assistant", {
    p_email: email, p_full_name: name, p_permissions: perms, p_expires_hours: Math.min(720, Math.max(1, intOrNull(fd, "expires_hours") ?? 72)),
  });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  return deliver(prev, data as { invitation_id?: string; token?: string; email?: string; expires_at?: string }, name, perms, "أُنشئت الدعوة.");
}

export async function resendAssistantInvitation(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!(await owner()) || !isUuid(id)) return { ok: false, message: "هذه العملية لمالك المنصة فقط." };
  const supabase = await createClient();
  const { data: inv } = await supabase.from("platform_assistant_invitations").select("full_name, permissions").eq("id", id).maybeSingle();
  const { data, error } = await supabase.rpc("platform_resend_assistant_invitation", { p_invitation: id, p_expires_hours: 72 });
  if (error) return { ok: false, message: rpcErrorMessage(error), attempt: (prev.attempt ?? 0) + 1 };
  return deliver(prev, data as { invitation_id?: string; token?: string; email?: string; expires_at?: string },
    (inv?.full_name as string | null) ?? null, (inv?.permissions as string[]) ?? [], "أُنشئت دعوة بديلة وأُبطل الرابط السابق.");
}

export async function revokeAssistantInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!(await owner()) || !isUuid(id)) return { ok: false, message: "هذه العملية لمالك المنصة فقط." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_revoke_assistant_invitation", { p_invitation: id });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/platform-admin/assistants");
  return { ok: true, message: "أُلغيت الدعوة؛ الرابط لم يعد صالحًا." };
}

export async function updateAssistant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const userId = str(fd, "user_id");
  const status = str(fd, "status");
  if (!(await owner()) || !isUuid(userId) || !["active", "suspended", "revoked"].includes(status)) return { ok: false, message: "هذه العملية لمالك المنصة فقط." };
  const keepPerms = str(fd, "keep_permissions") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_update_assistant", {
    p_user: userId, p_permissions: keepPerms ? null : validPerms(fd), p_status: status,
  });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  await invalidateMyContext();
  revalidatePath("/platform-admin/assistants");
  return { ok: true, message: status === "active" ? "تم حفظ صلاحيات المساعد." : status === "suspended" ? "تم تعطيل المساعد." : "تم إلغاء صفة المساعد مع الاحتفاظ بسجله." };
}
