"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContext, invalidateMyContext, platformHome } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { str, type ActionState } from "@/lib/action-state";
import { rpcErrorMessage } from "@/lib/invitations";
import { INVITE_NEXT_COOKIE } from "@/lib/invite-next";

/**
 * قبول دعوة مساعد المالك: البريد والصلاحية والاستخدام السابق والفصل عن الشركات كلها داخل القاعدة
 * (accept_platform_assistant_invitation). بعد القبول يُوجَّه المساعد لأول صفحة منصة يملك صلاحيتها، لا لصفحة الانضمام لشركة.
 */
export async function acceptAssistantInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, "token");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, message: "رابط الدعوة غير صالح." };
  if (!(await getContext())) redirect(`/login?next=${encodeURIComponent(`/assistant-invite/${token}`)}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_platform_assistant_invitation", { p_token: token });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  (await cookies()).delete(INVITE_NEXT_COOKIE);
  await invalidateMyContext();
  // السياق بعد القبول (يُقرأ من القاعدة من جديد) يحدد الصفحة الأولى حسب الصلاحيات الممنوحة فعليًا
  const ctx = await getContext();
  redirect(ctx?.platformRole ? platformHome(ctx) : "/platform-admin");
}
