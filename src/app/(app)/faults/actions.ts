"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, str, type ActionState } from "@/lib/action-state";

const SEVERITY = ["low", "medium", "high", "critical"];
const SOURCE = ["technician", "customer", "inspection", "other"];
const STATUS = ["open", "in_progress", "awaiting_verification", "closed", "cancelled"];

/** بلاغ عطل لجهاز: لا يغيّر موعد صيانته ولا مواعيد بقية الأجهزة؛ القاعدة تتحقق من رؤية الجهاز والصلاحية */
export async function reportFault(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("faults.create");
  const deviceId = str(fd, "device_id");
  if (!ctx || !isUuid(deviceId)) return fail(prev, fd, "ليست لديك صلاحية تسجيل البلاغات.");
  const description = str(fd, "description");
  if (description.length < 3) return fail(prev, fd, "صف العطل.", { description: "مطلوب" });
  const severity = SEVERITY.includes(str(fd, "severity")) ? str(fd, "severity") : "medium";
  const source = SOURCE.includes(str(fd, "source")) ? str(fd, "source") : "technician";
  const supabase = await createClient();
  const { data, error } = await supabase.from("device_faults")
    .insert({ company_id: ctx.orgId, device_id: deviceId, description: description.slice(0, 2000), severity, source })
    .select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath("/faults");
  redirect(`/faults/${data.id}?ok=created`);
}

/** انتقال حالة البلاغ عبر fault_transition (سجل أحداث، تحقق لاحق، وحالة الجهاز باختيار صريح فقط) */
export async function transitionFault(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("faults.update");
  const id = str(fd, "fault_id");
  const status = str(fd, "status");
  if (!ctx || !isUuid(id) || !STATUS.includes(status)) return fail(prev, fd, "ليست لديك صلاحية إدارة البلاغات.");
  const wo = str(fd, "work_order_id");
  const verification = ["passed", "failed"].includes(str(fd, "verification")) ? str(fd, "verification") : null;
  const deviceStatus = str(fd, "device_status") || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("fault_transition", {
    p_fault: id, p_status: status, p_note: str(fd, "note").slice(0, 2000) || null,
    p_work_order: isUuid(wo) ? wo : null, p_verification: verification, p_device_status: deviceStatus,
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/faults/${id}`);
  revalidatePath("/faults");
  return { ok: true, message: "تم تحديث البلاغ وحُفظ في سجله.", attempt: (prev.attempt ?? 0) + 1 };
}


/** تعديل مسؤول المتابعة وتاريخها (تحديث مباشر مسموح بأعمدته فقط؛ التدقيق يحفظ القديم والجديد) */
export async function updateFaultFollowUp(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("faults.update");
  const id = str(fd, "fault_id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية إدارة البلاغات.");
  const tech = str(fd, "assigned_technician_id");
  const due = str(fd, "follow_up_due");
  if (!isUuid(tech)) return fail(prev, fd, "حدد المسؤول.", { assigned_technician_id: "مطلوب" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail(prev, fd, "حدد تاريخ المتابعة.", { follow_up_due: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("device_faults").update({ assigned_technician_id: tech, follow_up_due: due })
    .eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "البلاغ غير موجود أو لا تملك صلاحية تعديله.");
  revalidatePath(`/faults/${id}`);
  return { ok: true, message: "حُفظ المسؤول وتاريخ المتابعة.", attempt: (prev.attempt ?? 0) + 1 };
}