"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fromLocalInput } from "@/lib/format";
import { parseAmount } from "@/lib/money";
import { surveyIssue } from "@/lib/labels";
import { resolveBrand } from "@/lib/brands";
import { fail, str, strOrNull, type ActionState } from "@/lib/action-state";

/** إنشاء زيارة معاينة لفرع وإسنادها لفني؛ القاعدة تتحقق من النطاق (الفني لفروع نطاقه ولنفسه) وتمنع التكرار بمفتاح العميل */
export async function createSurvey(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.create", "field.assigned");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إنشاء المعاينات.");
  const site = str(fd, "site_id");
  if (!isUuid(site)) return fail(prev, fd, "اختر الفرع.", { site_id: "مطلوب" });
  const when = fromLocalInput(str(fd, "scheduled_start"));
  if (!when) return fail(prev, fd, "حدد موعد الزيارة.", { scheduled_start: "مطلوب" });
  const tech = str(fd, "technician_id");
  const key = str(fd, "client_key");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_create", {
    p_client_key: isUuid(key) ? key : crypto.randomUUID(), p_site: site, p_scheduled: when,
    p_technician: isUuid(tech) ? tech : null, p_notes: strOrNull(fd, "notes"),
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/visits");
  redirect(`/visits/${data as string}/survey?ok=created`);
}

export interface ItemState { ok: boolean; message: string; errors?: Record<string, string> }

/** إضافة بند للمعاينة أو تعديله؛ القاعدة تمنع التعديل بعد الإنهاء وتتحقق أن الجهاز من موقع المعاينة */
export async function saveSurveyItem(input: { visitId: string; id?: string; fields: Record<string, string> }): Promise<ItemState> {
  const ctx = await orgForAction("visits.update");
  if (!ctx || !isUuid(input.visitId)) return { ok: false, message: "ليست لديك صلاحية تعديل المعاينة." };
  const g = (k: string) => (typeof input.fields[k] === "string" ? input.fields[k].trim() : "");
  const errors: Record<string, string> = {};
  const title = g("title");
  if (title.length < 2) errors.title = "اكتب اسم الجهاز أو العمل";
  const issue = g("issue_type") || "needs_maintenance";
  if (!(issue in surveyIssue)) errors.issue_type = "غير صالح";
  const qty = parseAmount(g("quantity") || "1");
  if (qty === null || qty <= 0) errors.quantity = "كمية غير صالحة";
  const price = parseAmount(g("unit_price") || "0");
  if (price === null) errors.unit_price = "سعر غير صالح";
  if (Object.keys(errors).length) return { ok: false, message: "راجع الحقول المعلَّمة؛ لم يُحفظ شيء.", errors };
  const device = g("device_id");
  const supabase = await createClient();
  const brand = await resolveBrand(supabase, ctx.orgId, g("brand"), ctx.canAny("catalog.manage", "quotes.manage"));
  if (!brand.ok) return { ok: false, message: brand.message, errors: { brand: "اختر من القائمة" } };
  const row = {
    brand_id: brand.id, brand: brand.name,
    title: title.slice(0, 200), issue_type: issue, description: g("description").slice(0, 2000) || null,
    quantity: qty, unit_price: price, device_id: isUuid(device) ? device : null,
  };
  const res = input.id && isUuid(input.id)
    ? await supabase.from("survey_items").update(row).eq("id", input.id).eq("visit_id", input.visitId).select("id")
    : await supabase.from("survey_items").insert({ ...row, company_id: ctx.orgId, visit_id: input.visitId, sort_order: Date.now() % 2_000_000_000 }).select("id");
  if (res.error) return { ok: false, message: dbErrorMessage(res.error) };
  if (!res.data?.length) return { ok: false, message: "البند غير موجود أو لا تملك صلاحية تعديله." };
  revalidatePath(`/visits/${input.visitId}/survey`);
  return { ok: true, message: input.id ? "حُفظ تعديل البند." : "أُضيف البند." };
}

export async function deleteSurveyItem(input: { visitId: string; id: string }): Promise<ItemState> {
  const ctx = await orgForAction("visits.update");
  if (!ctx || !isUuid(input.id)) return { ok: false, message: "ليست لديك صلاحية تعديل المعاينة." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("survey_items").delete().eq("id", input.id).eq("visit_id", input.visitId).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "البند غير موجود أو لا تملك صلاحية حذفه." };
  revalidatePath(`/visits/${input.visitId}/survey`);
  return { ok: true, message: "حُذف البند." };
}

/** ضريبة القيمة المضافة 15٪ في تقدير المعاينة (تنتقل إلى عرض السعر) */
export async function setSurveyVat(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "visit_id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية تعديل المعاينة." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("visits").update({ survey_vat: str(fd, "vat") === "1" })
    .eq("id", id).eq("company_id", ctx.orgId).eq("visit_type", "survey").is("closed_at", null).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "المعاينة منتهية أو لا تملك صلاحية تعديلها." };
  revalidatePath(`/visits/${id}/survey`);
  return { ok: true, message: "حُفظ." };
}

export async function startSurvey(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "visit_id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية تعديل المعاينة." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("visits").update({ status: "in_progress", actual_start: new Date().toISOString() })
    .eq("id", id).eq("company_id", ctx.orgId).eq("visit_type", "survey").eq("status", "scheduled").select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "تعذر بدء المعاينة (قد تكون بدأت مسبقًا)." };
  revalidatePath(`/visits/${id}/survey`);
  return { ok: true, message: "بدأت المعاينة." };
}

export async function completeSurvey(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.update");
  const id = str(fd, "visit_id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية إنهاء المعاينة." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("survey_complete", { p_visit: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/visits/${id}/survey`);
  revalidatePath("/visits");
  return { ok: true, message: "انتهت المعاينة: يمكنك الآن طباعة تقريرها ومشاركته وإنشاء عرض السعر." };
}

export async function reopenSurvey(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("visits.create");
  const id = str(fd, "visit_id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "إعادة فتح المعاينة للمسؤول فقط.");
  const reason = str(fd, "reason");
  if (reason.length < 3) return fail(prev, fd, "اذكر سبب إعادة الفتح.", { reason: "مطلوب" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("survey_reopen", { p_visit: id, p_reason: reason.slice(0, 500) });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/visits/${id}/survey`);
  return { ok: true, message: "أُعيد فتح المعاينة وسُجّل السبب.", attempt: (prev.attempt ?? 0) + 1 };
}
