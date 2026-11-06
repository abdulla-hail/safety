"use server";

import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { notificationKinds } from "@/lib/labels";
import type { ActionState } from "@/lib/action-state";

/**
 * تفضيلات الإشعارات للمستخدم الحالي في الشركة النشطة: كل نوع غير محدد يُحفظ «موقوفًا»، والمحدد «مفعّلًا».
 * القاعدة تطبق التفضيل عند إنشاء الإشعار (الأنواع الموقوفة لا تُنشأ أصلًا)؛ الصلاحيات تحدد ما يصل أساسًا.
 */
export async function saveNotificationPreferences(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction();
  if (!ctx) return { ok: false, message: "يجب تسجيل الدخول." };
  const on = new Set(fd.getAll("kinds").map(String));
  const rows = notificationKinds.map((k) => ({ company_id: ctx.orgId, user_id: ctx.user.id, kind: k.kind, enabled: on.has(k.kind), updated_at: new Date().toISOString() }));
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "company_id,user_id,kind" });
  if (error) return { ok: false, message: dbErrorMessage(error), attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath("/notifications/settings");
  return { ok: true, message: `حُفظت التفضيلات: ${on.size} نوعًا مفعّلًا من ${rows.length}.`, attempt: (prev.attempt ?? 0) + 1 };
}
