"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, list, str, strOrNull, type ActionState } from "@/lib/action-state";

const customerSchema = z.object({
  name: z.string().min(2, "الاسم قصير جدًا").max(200),
  customer_type: z.enum(["company", "government", "individual"]),
  is_active: z.enum(["true", "false"]),
  email: z.union([z.literal(""), z.email("بريد غير صالح")]),
});

function customerPayload(fd: FormData) {
  return {
    name: str(fd, "name"),
    customer_type: str(fd, "customer_type") || "company",
    is_active: str(fd, "is_active") !== "false",
    contact_name: strOrNull(fd, "contact_name"),
    phone: strOrNull(fd, "phone"),
    email: strOrNull(fd, "email")?.toLowerCase() ?? null,
    city: strOrNull(fd, "city"),
    address: strOrNull(fd, "address"),
    commercial_registration: strOrNull(fd, "commercial_registration"),
    vat_number: strOrNull(fd, "vat_number"),
    notes: strOrNull(fd, "notes"),
  };
}

function validate(fd: FormData) {
  const r = customerSchema.safeParse({
    name: str(fd, "name"), customer_type: str(fd, "customer_type") || "company",
    is_active: str(fd, "is_active") || "true", email: str(fd, "email"),
  });
  if (r.success) return null;
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
}

export async function createCustomer(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("customers.create");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إضافة العملاء.");
  const errors = validate(fd);
  if (errors) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert({ ...customerPayload(fd), company_id: ctx.orgId }).select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/customers");
  redirect(`/customers/${data.id}?ok=created`);
}

export async function updateCustomer(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const ctx = await orgForAction("customers.update");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل العملاء.");
  const errors = validate(fd);
  if (errors) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update(customerPayload(fd)).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "العميل غير موجود أو لا تملك صلاحية تعديله.");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?ok=saved`);
}

/** إسناد عدة فنيين لعميل (إضافة دون المساس بالإسنادات الأخرى) */
export async function assignTechniciansToCustomer(prev: ActionState, fd: FormData): Promise<ActionState> {
  const customerId = str(fd, "customer_id");
  const ids = list(fd, "technician_ids").filter(isUuid);
  const ctx = await orgForAction("assignments.manage");
  if (!ctx || !isUuid(customerId)) return fail(prev, fd, "ليست لديك صلاحية الإسناد.");
  if (ids.length === 0) return fail(prev, fd, "اختر فنيًا واحدًا على الأقل.");
  const supabase = await createClient();
  const { error } = await supabase.from("technician_customers").upsert(
    ids.map((technician_id) => ({ company_id: ctx.orgId, technician_id, customer_id: customerId })),
    { onConflict: "technician_id,customer_id", ignoreDuplicates: true },
  );
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `تم إسناد ${ids.length} فني/فنيين للعميل.`, attempt: (prev.attempt ?? 0) + 1 };
}

/** إلغاء الإسناد (assignment_remove): يُحفظ حدث الإلغاء وسببه في سجل الإسناد، ولا تتغير الزيارات السابقة */
export async function unassign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const technicianId = str(fd, "technician_id");
  const customerId = str(fd, "customer_id");
  const ctx = await orgForAction("assignments.manage");
  if (!ctx || !isUuid(technicianId) || !isUuid(customerId)) return { ok: false, message: "ليست لديك صلاحية الإسناد." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assignment_remove", { p_technician: technicianId, p_customer: customerId, p_reason: str(fd, "reason").slice(0, 300) || null });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/technicians/${technicianId}`);
  revalidatePath("/assignments");
  return { ok: true, message: "تمت إزالة الإسناد دون حذف العميل أو الفني، وحُفظ في سجل الإسناد." };
}

/** الفني الأساسي للعميل (واحد فقط، ومسند للعميل كاملًا)؛ technician_id فارغ = إلغاء التعيين */
export async function setPrimaryTechnician(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const customerId = str(fd, "customer_id");
  const technicianId = str(fd, "technician_id");
  const ctx = await orgForAction("assignments.manage");
  if (!ctx || !isUuid(customerId) || (technicianId && !isUuid(technicianId))) return { ok: false, message: "ليست لديك صلاحية الإسناد." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assignment_set_primary", { p_customer: customerId, p_technician: technicianId || null, p_reason: null });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: technicianId ? "تم تعيين الفني المسؤول الأساسي عن العميل." : "أُلغي تعيين الفني الأساسي." };
}

/** نطاق إسناد فني لعميل: العميل كاملًا (بلا مواقع محددة) أو مواقع بعينها */
export async function setAssignmentScope(prev: ActionState, fd: FormData): Promise<ActionState> {
  const customerId = str(fd, "customer_id");
  const technicianId = str(fd, "technician_id");
  const ctx = await orgForAction("assignments.manage");
  if (!ctx || !isUuid(customerId) || !isUuid(technicianId)) return fail(prev, fd, "ليست لديك صلاحية الإسناد.");
  const sites = str(fd, "scope") === "sites" ? [...new Set(list(fd, "site_ids").filter(isUuid))] : [];
  if (str(fd, "scope") === "sites" && sites.length === 0) return fail(prev, fd, "حدد موقعًا واحدًا على الأقل، أو اختر العميل كاملًا.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("assignment_set", { p_technician: technicianId, p_customer: customerId, p_sites: sites, p_reason: null });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/technicians/${technicianId}`);
  return { ok: true, message: sites.length ? `صار الإسناد مقصورًا على ${sites.length} موقع/مواقع.` : "صار الإسناد للعميل كاملًا.", attempt: (prev.attempt ?? 0) + 1 };
}
