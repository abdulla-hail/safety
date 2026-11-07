import "server-only";

import { siteUrl } from "@/lib/codes";
import { dbErrorMessage } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

/** خطأ «الدالة أو الجدول غير موجود» يعني أن تغييرات قاعدة البيانات المقترحة لم تُطبَّق بعد. */
export function isMissingSchema(error: { code?: string } | null | undefined) {
  return !!error && ["PGRST202", "PGRST205", "42883", "42P01", "42703", "PGRST204"].includes(error.code ?? "");
}

export const SCHEMA_PENDING_MESSAGE =
  "هذه الميزة تتطلب تطبيق تغييرات قاعدة البيانات المقترحة (supabase/proposed). لم تُطبَّق بعد بانتظار موافقتك.";

export function rpcErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  return isMissingSchema(error) ? SCHEMA_PENDING_MESSAGE : dbErrorMessage(error);
}

/** الدوران المتاحان للدعوة وتغيير الدور: مدير (للمدير الأساسي فقط) أو فني */
export const INVITE_ROLES = ["company_manager", "technician"] as const;

/** يبني رابط الدعوة من الرمز الخام الذي تعيده قاعدة البيانات مرة واحدة. */
export async function inviteLink(token: string) {
  return `${await siteUrl()}/invite/${encodeURIComponent(token)}`;
}

export async function inviteResult(
  prev: ActionState,
  data: { token?: string; email?: string; expires_at?: string } | null,
  label: string,
  message: string,
): Promise<ActionState> {
  if (!data?.token) return { ok: false, message: "لم يُنشأ رابط الدعوة.", attempt: (prev.attempt ?? 0) + 1 };
  return {
    ok: true,
    message,
    attempt: (prev.attempt ?? 0) + 1,
    invite: { url: await inviteLink(data.token), email: data.email ?? "", expiresAt: data.expires_at ?? "", label },
  };
}

/** حالة الدعوة الفعلية: المعلّقة المنتهي وقتها تُعرض «منتهية» */
export function effectiveInvitationStatus(status: string, expiresAt: string | null | undefined) {
  return status === "pending" && expiresAt && Date.parse(expiresAt) <= Date.now() ? "expired" : status;
}
