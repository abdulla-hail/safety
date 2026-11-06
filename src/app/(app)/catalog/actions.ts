"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, intOrNull, str, strOrNull, type ActionState } from "@/lib/action-state";

function systemPayload(fd: FormData) {
  return {
    name: str(fd, "name"),
    description: strOrNull(fd, "description"),
    default_interval_days: intOrNull(fd, "default_interval_days"),
    sort_order: intOrNull(fd, "sort_order") ?? 0,
    is_active: str(fd, "is_active") !== "false",
  };
}

export async function createSystem(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إدارة الكتالوج.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم النظام مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("safety_systems").insert({ ...systemPayload(fd), company_id: ctx.orgId }).select("id").single();
  if (error) return fail(prev, fd, error.code === "23505" ? "يوجد نظام بالاسم نفسه." : dbErrorMessage(error));
  revalidatePath("/catalog");
  redirect(`/catalog/${data.id}?ok=created`);
}

export async function updateSystem(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية إدارة الكتالوج.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم النظام مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  const { error } = await supabase.from("safety_systems").update(systemPayload(fd)).eq("id", id).eq("company_id", ctx.orgId);
  if (error) return fail(prev, fd, error.code === "23505" ? "يوجد نظام بالاسم نفسه." : dbErrorMessage(error));
  revalidatePath(`/catalog/${id}`);
  redirect(`/catalog/${id}?ok=saved`);
}

function parseSpecs(text: string): Record<string, string> {
  // سطر لكل خاصية بصيغة: الاسم: القيمة
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().slice(0, 60);
      const v = line.slice(i + 1).trim().slice(0, 200);
      if (k && v) out[k] = v;
    }
  }
  return out;
}

function itemPayload(fd: FormData) {
  return {
    name: str(fd, "name"),
    manufacturer: strOrNull(fd, "manufacturer"),
    model: strOrNull(fd, "model"),
    device_type: strOrNull(fd, "device_type"),
    description: strOrNull(fd, "description"),
    specs: parseSpecs(str(fd, "specs")),
    default_interval_days: intOrNull(fd, "default_interval_days"),
    is_active: str(fd, "is_active") !== "false",
  };
}

export async function createItem(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  const systemId = str(fd, "system_id");
  if (!ctx || !isUuid(systemId)) return fail(prev, fd, "ليست لديك صلاحية إدارة الكتالوج.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الجهاز مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").insert({ ...itemPayload(fd), system_id: systemId, company_id: ctx.orgId });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/catalog/${systemId}`);
  redirect(`/catalog/${systemId}?ok=created`);
}

export async function updateItem(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("catalog.manage");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية إدارة الكتالوج.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الجهاز مطلوب.", { name: "مطلوب" });
  const supabase = await createClient();
  // تعديل التعريف لا يغيّر الأجهزة المسجلة مسبقًا (تحتفظ بلقطة بياناتها)
  const { data, error } = await supabase.from("catalog_items").update(itemPayload(fd)).eq("id", id).eq("company_id", ctx.orgId).select("system_id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  redirect(`/catalog/${data.system_id}?ok=saved`);
}
