"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { fail, list, str, strOrNull, type ActionState } from "@/lib/action-state";
import { TECHNICIAN_SPECIALTIES } from "@/lib/labels";

function payload(fd: FormData) {
  const userId = str(fd, "user_id");
  return {
    full_name: str(fd, "full_name"),
    phone: strOrNull(fd, "phone"),
    email: strOrNull(fd, "email")?.toLowerCase() ?? null,
    job_title: strOrNull(fd, "job_title"),
    specialties: list(fd, "specialties").filter((s) => s in TECHNICIAN_SPECIALTIES),
    availability: ["available", "busy", "on_leave"].includes(str(fd, "availability")) ? str(fd, "availability") : "available",
    is_active: str(fd, "is_active") !== "false",
    hire_date: strOrNull(fd, "hire_date"),
    user_id: isUuid(userId) ? userId : null,
    notes: strOrNull(fd, "notes"),
  };
}

// إنشاء الفني يتم بدعوة من «فريق الشركة» (قبولها ينشئ سجله التشغيلي ويربطه بعضويته)؛ هنا التعديل والإسناد فقط
export async function updateTechnician(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("technicians.update");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل الفنيين.");
  if (str(fd, "full_name").length < 2) return fail(prev, fd, "الاسم مطلوب.", { full_name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("technicians").update(payload(fd)).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "الفني غير موجود أو لا تملك صلاحية تعديله.");
  redirect(`/technicians/${id}?ok=saved`);
}

/** إسناد عدة عملاء لفني دفعة واحدة (لا يمس الإسنادات القائمة، ويتجاهل المكرر) */
export async function assignCustomersToTechnician(prev: ActionState, fd: FormData): Promise<ActionState> {
  const technicianId = str(fd, "technician_id");
  const ids = [...new Set(list(fd, "customer_ids").filter(isUuid))];
  const ctx = await orgForAction("assignments.manage");
  if (!ctx || !isUuid(technicianId)) return fail(prev, fd, "ليست لديك صلاحية الإسناد.");
  if (ids.length === 0) return fail(prev, fd, "حدد عميلًا واحدًا على الأقل.");
  const supabase = await createClient();
  const { error } = await supabase.from("technician_customers").upsert(
    ids.map((customer_id) => ({ company_id: ctx.orgId, technician_id: technicianId, customer_id })),
    { onConflict: "technician_id,customer_id", ignoreDuplicates: true },
  );
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath(`/technicians/${technicianId}`);
  revalidatePath("/assignments");
  return { ok: true, message: `تم إسناد ${ids.length} عميل/عملاء للفني.`, attempt: (prev.attempt ?? 0) + 1 };
}
