"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fromLocalInput } from "@/lib/format";
import { fail, list, str, strOrNull, type ActionState } from "@/lib/action-state";

const TYPES = ["preventive", "corrective", "inspection", "installation", "emergency"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["new", "scheduled", "in_progress", "on_hold", "completed", "cancelled"];

function payload(fd: FormData) {
  const site = str(fd, "site_id");
  return {
    title: str(fd, "title"),
    description: strOrNull(fd, "description"),
    order_type: TYPES.includes(str(fd, "order_type")) ? str(fd, "order_type") : "preventive",
    priority: PRIORITIES.includes(str(fd, "priority")) ? str(fd, "priority") : "medium",
    site_id: isUuid(site) ? site : null,
    scheduled_for: fromLocalInput(str(fd, "scheduled_for")),
    due_at: fromLocalInput(str(fd, "due_at")),
  };
}

export async function createWorkOrder(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.create");
  const customerId = str(fd, "customer_id");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إنشاء أوامر العمل.");
  if (!isUuid(customerId)) return fail(prev, fd, "العميل مطلوب.");
  if (str(fd, "title").length < 3) return fail(prev, fd, "عنوان أمر العمل مطلوب.", { title: "مطلوب" });
  const supabase = await createClient();
  const p = payload(fd);
  const { data, error } = await supabase.from("work_orders")
    .insert({ ...p, customer_id: customerId, company_id: ctx.orgId, status: p.scheduled_for ? "scheduled" : "new" })
    .select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));

  const deviceIds = list(fd, "device_ids").filter(isUuid);
  const techIds = list(fd, "technician_ids").filter(isUuid);
  const problems: string[] = [];
  if (deviceIds.length) {
    const { error: e } = await supabase.from("work_order_devices").insert(deviceIds.map((device_id) => ({ work_order_id: data.id, device_id, company_id: ctx.orgId })));
    if (e) problems.push("الأجهزة");
  }
  if (techIds.length && ctx.can("work_orders.assign")) {
    const { error: e } = await supabase.from("work_order_technicians").insert(techIds.map((technician_id) => ({ work_order_id: data.id, technician_id, company_id: ctx.orgId })));
    if (e) problems.push("الفنيين");
  }
  revalidatePath("/work-orders");
  redirect(`/work-orders/${data.id}?ok=${problems.length ? "saved" : "created"}`);
}

export async function updateWorkOrder(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل أوامر العمل.");
  if (str(fd, "title").length < 3) return fail(prev, fd, "عنوان أمر العمل مطلوب.", { title: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").update(payload(fd)).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "أمر العمل غير موجود أو لا تملك صلاحية تعديله.");
  redirect(`/work-orders/${id}?ok=saved`);
}

export async function setWorkOrderStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.update");
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!ctx || !isUuid(id) || !STATUSES.includes(status)) return { ok: false, message: "ليست لديك صلاحية تغيير الحالة." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders")
    .update({ status, completed_at: status === "completed" ? new Date().toISOString() : null })
    .eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "تعذر تغيير الحالة." };
  revalidatePath(`/work-orders/${id}`);
  return { ok: true, message: "تم تحديث الحالة وإشعار المعنيين." };
}

export async function approveWorkOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.approve");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية الاعتماد." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders")
    .update({ approved_at: new Date().toISOString(), approved_by: ctx.user.id })
    .eq("id", id).eq("company_id", ctx.orgId).eq("status", "completed").is("approved_at", null).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "يمكن اعتماد أوامر العمل المكتملة غير المعتمدة فقط." };
  revalidatePath(`/work-orders/${id}`);
  return { ok: true, message: "تم اعتماد أمر العمل." };
}

export async function assignWorkOrderTechnicians(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.assign");
  const id = str(fd, "work_order_id");
  const ids = list(fd, "technician_ids").filter(isUuid);
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعيين الفنيين.");
  if (!ids.length) return fail(prev, fd, "اختر فنيًا واحدًا على الأقل.");
  const supabase = await createClient();
  const { error } = await supabase.from("work_order_technicians").upsert(
    ids.map((technician_id) => ({ work_order_id: id, technician_id, company_id: ctx.orgId })),
    { onConflict: "work_order_id,technician_id", ignoreDuplicates: true });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/work-orders/${id}`);
  return { ok: true, message: "تم تعيين الفنيين وإشعارهم.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function removeWorkOrderTechnician(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.assign");
  const id = str(fd, "work_order_id");
  const tech = str(fd, "technician_id");
  if (!ctx || !isUuid(id) || !isUuid(tech)) return { ok: false, message: "ليست لديك صلاحية تعيين الفنيين." };
  const supabase = await createClient();
  const { error } = await supabase.from("work_order_technicians").delete().eq("work_order_id", id).eq("technician_id", tech);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/work-orders/${id}`);
  return { ok: true, message: "تمت إزالة الفني من أمر العمل." };
}

export async function addWorkOrderDevices(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("work_orders.update");
  const id = str(fd, "work_order_id");
  const ids = list(fd, "device_ids").filter(isUuid);
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل أمر العمل.");
  if (!ids.length) return fail(prev, fd, "اختر جهازًا واحدًا على الأقل.");
  const supabase = await createClient();
  const { error } = await supabase.from("work_order_devices").upsert(
    ids.map((device_id) => ({ work_order_id: id, device_id, company_id: ctx.orgId })),
    { onConflict: "work_order_id,device_id", ignoreDuplicates: true });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/work-orders/${id}`);
  return { ok: true, message: "تمت إضافة الأجهزة.", attempt: (prev.attempt ?? 0) + 1 };
}
