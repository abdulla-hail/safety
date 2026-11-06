"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE, getContext, invalidateMyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { str, type ActionState } from "@/lib/action-state";
import { rpcErrorMessage } from "@/lib/invitations";
import { INVITE_NEXT_COOKIE } from "@/lib/invite-next";

/** قبول الدعوة: كل التحقق (البريد، الانتهاء، الإلغاء، الاستخدام السابق، الدور، الشركة) داخل قاعدة البيانات. */
export async function acceptInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const token = str(fd, "token");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, message: "رابط الدعوة غير صالح." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_company_invitation", { p_token: token });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  const r = data as { company_id?: string; kind?: string };
  // العضوية الجديدة يجب أن تظهر فورًا (السياق المخزن قديم)
  await invalidateMyContext();
  const jar = await cookies();
  if (r.company_id) {
    jar.set(ACTIVE_ORG_COOKIE, r.company_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  jar.delete(INVITE_NEXT_COOKIE);
  redirect(r.kind === "manager" || r.kind === "manager_transfer" ? "/team" : "/dashboard");
}
