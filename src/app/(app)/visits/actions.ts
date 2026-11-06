"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fromLocalInput } from "@/lib/format";
import { hasPhase5 } from "@/lib/schema";
import { fail, list, str, strOrNull, type ActionState } from "@/lib/action-state";

const TYPES = ["periodic", "emergency", "repair", "reinspection", "installation", "other"];
const OUTCOMES = ["completed", "completed_with_issues", "incomplete", "follow_up_required"];
const FOLLOW = ["none", "required", "scheduled", "done"];

function payload(fd: FormData, phase5: boolean) {
  const site = str(fd, "site_id");
  const wo = str(fd, "work_order_id");
  const type = str(fd, "visit_type");
  return {
    site_id: isUuid(site) ? site : null,
    work_order_id: isUuid(wo) ? wo : null,
    scheduled_start: fromLocalInput(str(fd, "scheduled_start")),
    scheduled_end: fromLocalInput(str(fd, "scheduled_end")),
    notes: strOrNull(fd, "notes"),
    ...(phase5 && TYPES.includes(type) ? { visit_type: type } : {}),
  };
}

export async function createVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.create");
  const customerId = str(fd, "customer_id");
  if (!ctx || !isUuid(customerId)) return fail(prev, fd, "ليست لديك صلاحية جدولة الزيارات.");
  const supabase = await createClient();
  const p = payload(fd, await hasPhase5(supabase));
  if (!p.scheduled_start) return fail(prev, fd, "موعد الزيارة مطلوب.", { scheduled_start: "مطلوب" });
  if (p.scheduled_end && p.scheduled_end < p.scheduled_start) return fail(prev, fd, "وقت الانتهاء قبل وقت البدء.", { scheduled_end: "غير صالح" });
  const { data, error } = await supabase.from("visits").insert({ ...p, customer_id: customerId, company_id: ctx.orgId }).select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  const techIds = list(fd, "technician_ids").filter(isUuid);
  if (techIds.length) {
    await supabase.from("visit_technicians").insert(techIds.map((technician_id) => ({ visit_id: data.id, technician_id, company_id: ctx.orgId })));
  }
  revalidatePath("/visits");
  redirect(`/visits/${data.id}?ok=created`);
}

export async function updateVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل الزيارات.");
  const supabase = await createClient();
  const phase5 = await hasPhase5(supabase);
  const p = payload(fd, phase5);
  if (!p.scheduled_start) return fail(prev, fd, "موعد الزيارة مطلوب.", { scheduled_start: "مطلوب" });
  const outcome = str(fd, "outcome");
  const follow = str(fd, "follow_up_status");
  const { data, error } = await supabase.from("visits")
    .update({
      ...p, summary: strOrNull(fd, "summary"),
      ...(phase5 ? { recommendations: strOrNull(fd, "recommendations"), outcome: OUTCOMES.includes(outcome) ? outcome : null,
        ...(FOLLOW.includes(follow) ? { follow_up_status: follow } : {}) } : {}),
    }).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الزيارة غير موجودة أو لا تملك صلاحية تعديلها.");
  redirect(`/visits/${id}?ok=saved`);
}

const STATUS = ["scheduled", "in_progress", "completed", "cancelled", "missed"];

export async function setVisitStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!ctx || !isUuid(id) || !STATUS.includes(status)) return { ok: false, message: "ليست لديك صلاحية تحديث الزيارة." };
  const now = new Date().toISOString();
  const patch: Record<string, string | null> = { status };
  if (status === "in_progress") patch.actual_start = now;
  if (status === "completed") patch.actual_end = now;
  const supabase = await createClient();
  const { data, error } = await supabase.from("visits").update(patch).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "تعذر تحديث الزيارة." };
  revalidatePath(`/visits/${id}`);
  return { ok: true, message: "تم تحديث حالة الزيارة." };
}

export async function assignVisitTechnicians(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update", "visits.create");
  const id = str(fd, "visit_id");
  const ids = list(fd, "technician_ids").filter(isUuid);
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعيين الفنيين.");
  if (!ids.length) return fail(prev, fd, "اختر فنيًا واحدًا على الأقل.");
  const supabase = await createClient();
  const { error } = await supabase.from("visit_technicians").upsert(
    ids.map((technician_id) => ({ visit_id: id, technician_id, company_id: ctx.orgId })),
    { onConflict: "visit_id,technician_id", ignoreDuplicates: true });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/visits/${id}`);
  return { ok: true, message: "تم تعيين الفنيين وإشعارهم.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function removeVisitTechnician(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "visit_id");
  const tech = str(fd, "technician_id");
  if (!ctx || !isUuid(id) || !isUuid(tech)) return { ok: false, message: "ليست لديك صلاحية تعيين الفنيين." };
  const supabase = await createClient();
  const { error } = await supabase.from("visit_technicians").delete().eq("visit_id", id).eq("technician_id", tech);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/visits/${id}`);
  return { ok: true, message: "تمت إزالة الفني من الزيارة." };
}
