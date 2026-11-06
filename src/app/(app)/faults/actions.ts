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

/** أمر عمل مستقل لإصلاح البلاغ (دون إنشاء زيارة تلقائيًا)، ثم ربطه بالبلاغ */
export async function createWorkOrderForFault(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.create");
  const id = str(fd, "fault_id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية إنشاء أوامر العمل.");
  const supabase = await createClient();
  const { data: f, error: e0 } = await supabase.from("device_faults").select("id, ref_no, device_id, customer_id, site_id, description, severity, status")
    .eq("id", id).eq("company_id", ctx.orgId).maybeSingle();
  if (e0 || !f) return fail(prev, fd, "البلاغ غير موجود.");
  const priority = f.severity === "critical" ? "critical" : f.severity === "high" ? "high" : f.severity === "low" ? "low" : "medium";
  const { data: wo, error } = await supabase.from("work_orders").insert({
    company_id: ctx.orgId, customer_id: f.customer_id, site_id: f.site_id, order_type: f.severity === "critical" ? "emergency" : "corrective",
    priority, title: `إصلاح عطل ${f.ref_no ?? ""}`.trim(), description: f.description, status: "new",
  }).select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  const { error: e2 } = await supabase.from("work_order_devices").insert({ work_order_id: wo.id, device_id: f.device_id, company_id: ctx.orgId });
  if (e2) return { ok: false, message: `أُنشئ أمر العمل لكن تعذر ربط الجهاز: ${dbErrorMessage(e2)}`, attempt: (prev.attempt ?? 0) + 1 };
  const { error: e3 } = await supabase.rpc("fault_transition", {
    p_fault: id, p_status: f.status === "open" ? "in_progress" : f.status, p_note: "أُنشئ أمر عمل للإصلاح",
    p_work_order: wo.id, p_verification: null, p_device_status: null,
  });
  if (e3) return { ok: false, message: `أُنشئ أمر العمل لكن تعذر ربطه بالبلاغ: ${dbErrorMessage(e3)}`, attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath(`/faults/${id}`);
  redirect(`/work-orders/${wo.id}?ok=created`);
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