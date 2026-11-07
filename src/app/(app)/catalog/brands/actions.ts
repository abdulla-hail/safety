"use server";

import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, str, type ActionState } from "@/lib/action-state";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export async function addBrand(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  if (!ctx) return fail(prev, fd, "إدارة الماركات لمن يملك إدارة الكتالوج.");
  const name = clean(str(fd, "name"));
  if (name.length < 1 || name.length > 100) return fail(prev, fd, "اكتب اسم الماركة.", { name: "مطلوب" });
  const supabase = await createClient();
  const { error } = await supabase.from("brands").insert({ company_id: ctx.orgId, name });
  if (error) return fail(prev, fd, error.code === "23505" ? "الماركة موجودة بالفعل." : dbErrorMessage(error), error.code === "23505" ? { name: "مكررة" } : undefined);
  revalidatePath("/catalog/brands");
  return { ok: true, message: `أُضيفت الماركة «${name}».`, attempt: (prev.attempt ?? 0) + 1 };
}

export async function renameBrand(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية.");
  const name = clean(str(fd, "name"));
  if (name.length < 1 || name.length > 100) return fail(prev, fd, "اكتب اسم الماركة.", { name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").update({ name }).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, error.code === "23505" ? "يوجد ماركة بهذا الاسم." : dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الماركة غير موجودة.");
  revalidatePath("/catalog/brands");
  return { ok: true, message: "حُفظ الاسم. البنود السابقة تحتفظ بالاسم المسجل وقت إضافتها.", attempt: (prev.attempt ?? 0) + 1 };
}

/** الحذف من القائمة فقط: البنود والمستندات السابقة تحتفظ باسم الماركة نصًا */
export async function deleteBrand(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").delete().eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "الماركة غير موجودة." };
  revalidatePath("/catalog/brands");
  return { ok: true, message: "حُذفت الماركة من القائمة." };
}
