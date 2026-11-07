"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, str, strOrNull, type ActionState } from "@/lib/action-state";
import { parseLocation, validLatLng } from "@/lib/geo";
import { resolveShortMapsUrl } from "@/lib/geo-resolve";

/**
 * نص الموقع كما أدخله المستخدم (رابط مختصر، إحداثيات، عنوان وطني...): يُحفظ دائمًا كما هو دون رفض أو استبدال.
 * التحويل إلى إحداثيات منفصل: النقطة المحددة على الخريطة أولًا، وإلا يُستخرج من النص (أو بتتبع الرابط المختصر) إن أمكن؛
 * والفشل لا يمنع الحفظ ولا يغيّر النص.
 */
function locationText(fd: FormData): string | null {
  const v = fd.get("location_text");
  if (typeof v !== "string" || !v.trim()) return null;
  return v.slice(0, 2000);
}

async function location(fd: FormData, text: string | null): Promise<{ latitude: number | null; longitude: number | null }> {
  const p = validLatLng(str(fd, "latitude"), str(fd, "longitude"));
  if (p) return { latitude: p.lat, longitude: p.lng };
  // أزال المستخدم النقطة صراحةً: لا تُشتق من النص
  if (str(fd, "location_cleared") === "1" || !text) return { latitude: null, longitude: null };
  const d = parseLocation(text) ?? (await resolveShortMapsUrl(text));
  return d ? { latitude: d.lat, longitude: d.lng } : { latitude: null, longitude: null };
}

/** قبل تطبيق ترحيل 20261112000100 لا يوجد عمود location_text: يُحفظ الفرع بدونه بدل فشل الحفظ */
const missingTextColumn = (e: { message?: string } | null) => !!e && /location_text/.test(e.message ?? "");

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
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الفرع مطلوب.", { name: "مطلوب" });
  const text = locationText(fd);
  const loc = await location(fd, text);
  const supabase = await createClient();
  const row = { ...payload(fd), ...loc, customer_id: customerId, company_id: ctx.orgId };
  let { data, error } = await supabase.from("customer_sites").insert({ ...row, location_text: text }).select("id").single();
  if (missingTextColumn(error)) ({ data, error } = await supabase.from("customer_sites").insert(row).select("id").single());
  if (error || !data) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/customers/${customerId}`);
  redirect(`/sites/${data.id}?ok=created`);
}

export async function updateSite(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("sites.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل المواقع.");
  if (str(fd, "name").length < 2) return fail(prev, fd, "اسم الفرع مطلوب.", { name: "مطلوب" });
  const text = locationText(fd);
  const loc = await location(fd, text);
  const supabase = await createClient();
  const row = { ...payload(fd), ...loc };
  let { data, error } = await supabase.from("customer_sites").update({ ...row, location_text: text }).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (missingTextColumn(error)) ({ data, error } = await supabase.from("customer_sites").update(row).eq("id", id).eq("company_id", ctx.orgId).select("id"));
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الموقع غير موجود أو لا تملك صلاحية تعديله.");
  redirect(`/sites/${id}?ok=saved`);
}
