"use server";

import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { safeFileName } from "@/lib/storage";
import { hasPhase5, hasWorkOrderExecution } from "@/lib/schema";
import { str, type ActionState } from "@/lib/action-state";
import type { Permission } from "@/lib/permissions";

const ENTITY: Record<string, { perm: Permission[]; path: string }> = {
  device: { perm: ["devices.update", "devices.create"], path: "/devices" },
  customer: { perm: ["customers.update"], path: "/customers" },
  site: { perm: ["sites.update"], path: "/sites" },
  visit: { perm: ["visits.update"], path: "/visits" },
  maintenance: { perm: ["maintenance.create"], path: "/maintenance" },
  fault: { perm: ["faults.create", "faults.update"], path: "/faults" },
};
const STAGES_P5 = ["before", "after", "general"];
const STAGES_WO = [...STAGES_P5, "fault", "other"];

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|webp)|application\/pdf)$/;

/** رفع مرفق إلى مسار الشركة في حاوية خاصة، ثم تسجيله. يخضع الرفع والقراءة لسياسات التخزين وRLS. */
export async function uploadAttachment(prev: ActionState, fd: FormData): Promise<ActionState> {
  const type = str(fd, "entity_type");
  const entityId = str(fd, "entity_id");
  const cfg = ENTITY[type];
  const file = fd.get("file");
  const attempt = (prev.attempt ?? 0) + 1;
  if (!cfg || !isUuid(entityId)) return { ok: false, message: "طلب غير صالح.", attempt };
  const ctx = await orgForAction(...cfg.perm);
  if (!ctx) return { ok: false, message: "ليست لديك صلاحية إضافة مرفقات.", attempt };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "اختر ملفًا.", attempt };
  if (file.size > MAX_BYTES) return { ok: false, message: "الحد الأقصى لحجم الملف 10 ميجابايت.", attempt };
  if (!ALLOWED.test(file.type)) return { ok: false, message: "الأنواع المسموحة: صور PNG/JPEG/WebP أو PDF.", attempt };

  const supabase = await createClient();
  const path = `${ctx.orgId}/${type}/${entityId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error: upErr } = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, message: "تعذر رفع الملف. تحقق من الصلاحيات وحجم الملف.", attempt };

  // صورة الزيارة قد تُربط بجهاز وتصنيف (عامة/قبل/بعد/توثيق عطل/أخرى)؛ القاعدة تتحقق أن الجهاز ضمن الزيارة
  const [phase5, woExec] = await Promise.all([hasPhase5(supabase), hasWorkOrderExecution(supabase)]);
  const stage = phase5 ? str(fd, "photo_stage") : "";
  const deviceId = phase5 ? str(fd, "device_id") : "";
  const surveyItem = str(fd, "survey_item_id");
  const { error } = await supabase.from("attachments").insert({
    company_id: ctx.orgId, entity_type: type, entity_id: entityId, storage_path: path,
    file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size,
    ...((woExec ? STAGES_WO : STAGES_P5).includes(stage) ? { photo_stage: stage } : {}),
    ...(isUuid(deviceId) ? { device_id: deviceId } : {}),
    ...(isUuid(surveyItem) ? { survey_item_id: surveyItem } : {}),
  });
  if (error) {
    await supabase.storage.from("org-files").remove([path]);
    return { ok: false, message: dbErrorMessage(error), attempt };
  }
  revalidatePath(`${cfg.path}/${entityId}`);
  if (type === "visit") { revalidatePath(`/visits/${entityId}/run`); revalidatePath(`/visits/${entityId}/survey`); }
  return { ok: true, message: "تم رفع المرفق.", attempt };
}

/**
 * حذف مرفق محفوظ نهائيًا: الملف من التخزين أولًا (سياسة التخزين تسمح فقط لمن يحق له حذف السجل)، ثم السجل مع التدقيق
 * عبر attachment_delete التي تعيد التحقق من الصلاحية. فشل الإزالة لا يحذف شيئًا؛ إعادة المحاولة آمنة.
 */
export async function deleteAttachment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "attachment_id");
  const back = str(fd, "back");
  const ctx = await orgForAction();
  if (!ctx || !isUuid(id)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { data: a, error: e0 } = await supabase.from("attachments").select("id, storage_path").eq("id", id).eq("company_id", ctx.orgId).maybeSingle();
  if (e0) return { ok: false, message: dbErrorMessage(e0) };
  if (!a) return { ok: false, message: "المرفق غير موجود أو حُذف مسبقًا." };
  const { error: se } = await supabase.storage.from("org-files").remove([a.storage_path]);
  if (se) return { ok: false, message: "تعذر حذف الملف من التخزين؛ لم يُحذف شيء. أعد المحاولة." };
  const { error } = await supabase.rpc("attachment_delete", { p_id: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (back.startsWith("/")) revalidatePath(back);
  return { ok: true, message: "حُذف المرفق وسُجّل الحذف في سجل التدقيق." };
}
