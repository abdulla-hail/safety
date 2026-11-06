"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { todayISO } from "@/lib/format";
import { parseReadings } from "@/lib/readings";
import { hasInspections } from "@/lib/schema";
import { parseParts, validateItem, type InspectionStatus } from "@/lib/visits";
import { fail, list, str, strOrNull, type ActionState } from "@/lib/action-state";

const KINDS = ["periodic", "emergency", "repair", "reinspection", "other"];
const NOT_READY = "تنفيذ الزيارة جهازًا جهازًا يتطلب تطبيق ترحيل قاعدة البيانات المقترح (20261106000100) بموافقة مدير المنصة.";

/**
 * بدء زيارة دورية لموقع (أو استئناف المفتوحة له) أو زيارة طارئة لأجهزة محددة.
 * مفتاح العميل يولّده النموذج مرة واحدة: إعادة الإرسال أو التحديث لا تنشئ زيارة ثانية.
 */
export async function startVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.create", "field.assigned");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية بدء الزيارات.");
  const site = str(fd, "site_id");
  const kind = str(fd, "visit_type");
  const reason = str(fd, "urgent_reason");
  const devices = [...new Set(list(fd, "device_ids").filter(isUuid))];
  if (!isUuid(site)) return fail(prev, fd, "اختر الموقع.", { site_id: "مطلوب" });
  if (!KINDS.includes(kind)) return fail(prev, fd, "اختر نوع الزيارة.", { visit_type: "مطلوب" });
  if (kind !== "periodic") {
    if (!reason) return fail(prev, fd, "اختر سبب الزيارة الطارئة.", { urgent_reason: "مطلوب" });
    if (!devices.length) return fail(prev, fd, "اختر جهازًا واحدًا على الأقل.", { device_ids: "مطلوب" });
  }
  const supabase = await createClient();
  if (!(await hasInspections(supabase))) return fail(prev, fd, NOT_READY);
  const key = str(fd, "client_key");
  const { data, error } = await supabase.rpc("visit_start", {
    p_client_key: isUuid(key) ? key : crypto.randomUUID(), p_site: site, p_type: kind,
    p_reason: kind === "periodic" ? null : reason, p_devices: kind === "periodic" ? null : devices, p_notes: strOrNull(fd, "notes"),
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/my-work");
  redirect(`/visits/${data as string}/run`);
}

export interface ItemSaveState { ok: boolean; message: string; version?: number; errors?: Record<string, string>; savedAt?: string }

/** حفظ بند جهاز في زيارة (مسودة أو نتيجة). لا يُعلَن النجاح إلا بعد تأكيد القاعدة وإعادة الإصدار الجديد. */
export async function saveVisitItem(input: { itemId: string; visitId: string; visitType: string; version: number; fields: Record<string, string> }): Promise<ItemSaveState> {
  const ctx = await orgForAction("visits.update");
  if (!ctx || !isUuid(input.itemId)) return { ok: false, message: "ليست لديك صلاحية تحديث هذه الزيارة." };
  const f = input.fields;
  const g = (k: string) => (typeof f[k] === "string" ? f[k].trim() : "");
  const status = (g("inspection_status") || "pending") as InspectionStatus;
  const readings = parseReadings(g("readings"));
  if (readings === "invalid") return { ok: false, message: "اكتب كل قراءة في سطر بصيغة: الاسم = القيمة (حتى 30 قراءة).", errors: { readings: "صيغة غير صالحة" } };
  const parts = parseParts(g("parts"));
  if (parts === "invalid") return { ok: false, message: "القطع والمواد: سطر لكل بند (حتى 50).", errors: { parts: "صيغة غير صالحة" } };
  const data = {
    inspection_status: status, result: g("result") || null, status_after: g("status_after") || null, action: g("action") || null,
    skip_reason: g("skip_reason") || null, findings: g("findings"), actions_taken: g("actions_taken"), recommendations: g("recommendations"),
    notes: g("notes"), readings, parts, resolved: g("resolved") === "yes" ? true : g("resolved") === "no" ? false : null,
    follow_up_needed: g("follow_up_needed") === "1", follow_up_technician_id: g("follow_up_technician_id") || null,
    follow_up_due: g("follow_up_due") || null, follow_up_note: g("follow_up_note"),
    next_due_override: g("next_due_override") || null, next_due_reason: g("next_due_reason") || null,
  };
  const errors = validateItem(data, { visitType: input.visitType, canReschedule: ctx.can("maintenance.reschedule"), today: todayISO() });
  if (Object.keys(errors).length) return { ok: false, message: "راجع الحقول المعلَّمة؛ لم يُحفظ شيء.", errors };
  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("visit_save_item", { p_item: input.itemId, p_data: data, p_version: input.version });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/visits/${input.visitId}/run`);
  return { ok: true, version: version as number, savedAt: new Date().toISOString(),
    message: status === "pending" ? "حُفظت المسودة." : "حُفظت نتيجة الجهاز." };
}

export async function addVisitDevices(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const visit = str(fd, "visit_id");
  const ids = [...new Set(list(fd, "device_ids").filter(isUuid))];
  if (!ctx || !isUuid(visit)) return fail(prev, fd, "ليست لديك صلاحية تحديث هذه الزيارة.");
  if (!ids.length) return fail(prev, fd, "اختر جهازًا.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visit_add_devices", { p_visit: visit, p_devices: ids });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/visits/${visit}/run`);
  return { ok: true, message: data ? `أُضيف ${data} جهاز إلى الزيارة.` : "الأجهزة المختارة موجودة في الزيارة مسبقًا.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function removeVisitDevice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const item = str(fd, "item_id");
  const visit = str(fd, "visit_id");
  if (!ctx || !isUuid(item)) return { ok: false, message: "ليست لديك صلاحية تحديث هذه الزيارة." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("visit_remove_device", { p_item: item });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/visits/${visit}/run`);
  return { ok: true, message: "أُزيل الجهاز من الزيارة." };
}

/** إغلاق الزيارة: القاعدة تتحقق من نتائج كل الأجهزة (أو الاستثناء المصرَّح) وتنشئ السجلات والمتابعات مرة واحدة */
export async function closeVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const visit = str(fd, "visit_id");
  if (!ctx || !isUuid(visit)) return fail(prev, fd, "ليست لديك صلاحية إغلاق هذه الزيارة.");
  const exception = str(fd, "exception_reason");
  if (exception && !ctx.can("visits.close_exception")) return fail(prev, fd, "الإغلاق باستثناء يتطلب صلاحية «إغلاق زيارة غير مكتملة».");
  const supabase = await createClient();
  const { error } = await supabase.rpc("visit_close", { p_visit: visit, p_exception_reason: exception || null, p_summary: strOrNull(fd, "summary") });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/my-work");
  revalidatePath(`/visits/${visit}`);
  redirect(`/visits/${visit}?ok=closed`);
}

/** بدء الزيارة من أمر عمل مسند (أو استئناف زيارته المفتوحة)؛ القاعدة تتحقق من الإسناد والصلاحية وتمنع التكرار */
export async function startWorkOrderVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update", "visits.create");
  const wo = str(fd, "work_order_id");
  if (!ctx || !isUuid(wo)) return fail(prev, fd, "ليست لديك صلاحية تنفيذ أوامر العمل.");
  const key = str(fd, "client_key");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("work_order_start_visit", { p_wo: wo, p_client_key: isUuid(key) ? key : crypto.randomUUID() });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/my-work");
  revalidatePath(`/work-orders/${wo}`);
  redirect(`/visits/${data as string}/run`);
}

export interface ReportSaveState { ok: boolean; message: string; savedAt?: string }

/** حفظ تقرير الزيارة وملاحظات الفني والتوصيات (تلقائيًا أثناء الكتابة أو يدويًا) قبل الإغلاق */
export async function saveVisitReport(input: { visitId: string; summary: string; notes: string; recommendations: string }): Promise<ReportSaveState> {
  const ctx = await orgForAction("visits.update");
  if (!ctx || !isUuid(input.visitId)) return { ok: false, message: "ليست لديك صلاحية تحديث هذه الزيارة." };
  const clip = (s: string) => (typeof s === "string" ? s.slice(0, 4000) : "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visit_save_report", {
    p_visit: input.visitId, p_summary: clip(input.summary), p_technician_notes: clip(input.notes), p_recommendations: clip(input.recommendations),
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  return { ok: true, message: "حُفظ التقرير.", savedAt: (data as string | null) ?? new Date().toISOString() };
}

const SEVERITY = ["low", "medium", "high", "critical"];
const FAULT_STATUS = ["open", "in_progress", "awaiting_verification"];

/** بلاغ عطل أثناء الزيارة: يرتبط بالزيارة وأمر العمل والعميل والموقع والجهاز؛ مفتاح العميل يمنع التكرار عند إعادة الإرسال */
export async function reportVisitFault(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("faults.create");
  const visit = str(fd, "visit_id");
  const device = str(fd, "device_id");
  if (!ctx || !isUuid(visit)) return fail(prev, fd, "ليست لديك صلاحية تسجيل البلاغات.");
  if (!isUuid(device)) return fail(prev, fd, "اختر الجهاز المعني.", { device_id: "مطلوب" });
  const description = str(fd, "description");
  if (description.length < 3) return fail(prev, fd, "صف العطل.", { description: "مطلوب" });
  const severity = str(fd, "severity");
  const status = str(fd, "status") || "open";
  if (!SEVERITY.includes(severity)) return fail(prev, fd, "اختر درجة الخطورة.", { severity: "مطلوب" });
  if (!FAULT_STATUS.includes(status)) return fail(prev, fd, "حالة البلاغ غير صالحة.", { status: "غير صالحة" });
  const action = str(fd, "action_taken");
  if (status === "awaiting_verification" && action.length < 3) return fail(prev, fd, "اذكر الإجراء المتخذ لإصلاح العطل.", { action_taken: "مطلوب" });
  const key = str(fd, "client_key");
  const supabase = await createClient();
  const { error } = await supabase.rpc("visit_report_fault", {
    p_visit: visit, p_device: device, p_client_key: isUuid(key) ? key : crypto.randomUUID(), p_description: description.slice(0, 2000),
    p_severity: severity, p_status: status, p_action: action.slice(0, 2000) || null, p_recommendation: str(fd, "recommendation").slice(0, 2000) || null,
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/visits/${visit}/run`);
  // مفتاح جديد للبلاغ التالي؛ إعادة إرسال النموذج نفسه لا تكرر البلاغ المحفوظ
  return { ok: true, message: "سُجّل البلاغ وأُشعر المسؤولون.", attempt: (prev.attempt ?? 0) + 1, values: { client_key: crypto.randomUUID(), visit_id: visit } };
}