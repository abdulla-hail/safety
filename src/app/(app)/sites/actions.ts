"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, str, strOrNull, type ActionState } from "@/lib/action-state";

function payload(fd: FormData) {
  return {
    name: str(fd, "name"),
    city: strOrNull(fd, "city"),
    district: strOrNull(fd, "district"),
    address: strOrNull(fd, "address"),
    contact_name: strOrNull(fd, "contact_name"),
    contact_phone: strOrNull(fd, "contact_phone"),
    notes: strOrNull(fd, "notes"),
  };
}

export async function createSite(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("sites.create");
  const customerId = str(fd, "customer_id");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إضافة المواقع.");
  if (!isUuid(customerId)) return fail(prev, fd, "اختر العميل.", { customer_id: "مطلوب" });
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الموقع مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("customer_sites")
    .insert({ ...payload(fd), customer_id: customerId, company_id: ctx.orgId }).select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/customers/${customerId}`);
  redirect(`/sites/${data.id}?ok=created`);
}

export async function updateSite(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("sites.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل المواقع.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الموقع مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("customer_sites").update(payload(fd)).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الموقع غير موجود أو لا تملك صلاحية تعديله.");
  redirect(`/sites/${id}?ok=saved`);
}
