"use server";

import { revalidatePath } from "next/cache";
import { invalidateMyContext, orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { IMAGE_TYPES, safeFileName } from "@/lib/storage";
import { isUuid } from "@/lib/list";
import { bool, fail, str, type ActionState } from "@/lib/action-state";

/** حقول يعدّلها مدير الشركة (صلاحية settings.branding). الاسم والسجل والهاتف والمدينة يديرها مالك المنصة. */
const CONTACT_KEYS = ["legal_name", "email", "website", "address", "vat_number", "license_no"] as const;
const BRAND_TEXT = ["header_text", "footer_text", "signature_name", "signature_title"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** إعدادات الصيانة الدورية للشركة (مدير الشركة؛ تتحقق القاعدة). لا تغيّر مواعيد الأجهزة القائمة. */
export async function saveMaintenanceSettings(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("settings.branding");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إدارة إعدادات الشركة.");
  const n = (k: string) => Number.parseInt(str(fd, k), 10);
  const months = n("default_interval_months"), alert = n("maintenance_alert_days"), esc = n("escalation_days");
  const policy = str(fd, "schedule_policy");
  const errors: Record<string, string> = {};
  if (!(months >= 1 && months <= 60)) errors.default_interval_months = "بين 1 و60";
  if (!(alert >= 1 && alert <= 90)) errors.maintenance_alert_days = "بين 1 و90";
  if (!(esc >= 1 && esc <= 90)) errors.escalation_days = "بين 1 و90";
  if (!["from_completion", "fixed"].includes(policy)) errors.schedule_policy = "اختر السياسة";
  if (Object.keys(errors).length) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_update_maintenance_settings", {
    p_company: ctx.orgId, p_default_months: months, p_policy: policy, p_alert_days: alert, p_escalation_days: esc,
  });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/settings/company");
  return { ok: true, message: "حُفظت إعدادات الصيانة. تُطبَّق على الأجهزة الجديدة والحسابات القادمة دون تغيير مواعيد الأجهزة القائمة.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function saveCompanySettings(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("settings.branding");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إدارة هوية الشركة.");
  const data: Record<string, string | number | boolean | null> = {};

  for (const k of CONTACT_KEYS) data[k] = str(fd, k);
  if (data.email && !EMAIL.test(String(data.email))) return fail(prev, fd, "البريد الإلكتروني غير صالح.", { email: "غير صالح" });
  const days = Number.parseInt(str(fd, "maintenance_alert_days"), 10);
  if (Number.isFinite(days)) {
    if (days < 1 || days > 180) return fail(prev, fd, "أيام التنبيه بين 1 و180.", { maintenance_alert_days: "غير صالح" });
    data.maintenance_alert_days = days;
  }
  const primary = str(fd, "primary_color");
  const secondary = str(fd, "secondary_color");
  if (!HEX.test(primary) || !HEX.test(secondary)) return fail(prev, fd, "صيغة اللون غير صحيحة.");
  data.primary_color = primary;
  data.secondary_color = secondary;
  for (const k of BRAND_TEXT) data[k] = str(fd, k);
  data.show_logo_in_reports = bool(fd, "show_logo_in_reports");
  data.show_contact_in_reports = bool(fd, "show_contact_in_reports");
  data.show_stamp_in_reports = bool(fd, "show_stamp_in_reports");

  // التحقق من الملفات كلها قبل أي رفع، ثم رفعها بالتوازي (لا تتابع ولا رفع مكرر)
  const uploads: { kind: "logo_path" | "stamp_path"; file: File; path: string }[] = [];
  for (const [field, kind] of [["logo", "logo_path"], ["stamp", "stamp_path"]] as const) {
    const file = fd.get(field);
    if (bool(fd, `remove_${field}`)) data[kind] = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024) return fail(prev, fd, "الحد الأقصى لحجم الصورة 2 ميجابايت.");
      if (!IMAGE_TYPES.includes(file.type)) return fail(prev, fd, "صيغة الصورة يجب أن تكون PNG أو JPEG أو WebP أو SVG.");
      // المسار يبدأ بمعرّف الشركة؛ سياسة التخزين ودالة الحفظ ترفضان غير ذلك
      uploads.push({ kind, file, path: `${ctx.orgId}/${field}-${Date.now()}-${safeFileName(file.name)}` });
    }
  }
  const supabase = await createClient();
  const uploaded = await Promise.all(uploads.map((u) =>
    supabase.storage.from("org-branding").upload(u.path, u.file, { contentType: u.file.type, upsert: false })));
  const removeOrphans = () => supabase.storage.from("org-branding").remove(uploads.map((u) => u.path));
  if (uploaded.some((r) => r.error)) {
    await removeOrphans();
    return fail(prev, fd, "تعذر رفع الصورة؛ لم يتغير شيء في الهوية. تحقق من صلاحية إدارة الهوية وحجم الملف.");
  }
  for (const u of uploads) data[u.kind] = u.path;

  const { error } = await supabase.rpc("company_update_branding", { p_company: ctx.orgId, p_data: data });
  if (error) {
    // الهوية القديمة باقية كما هي (الحفظ ذري)؛ تُحذف الصور التي رُفعت لهذه المحاولة فقط
    if (uploads.length) await removeOrphans();
    return fail(prev, fd, dbErrorMessage(error));
  }
  // السياق المخزن يحمل اللون ومسار الشعار: يُبطل حتى تظهر الهوية الجديدة في القائمة فورًا
  await invalidateMyContext();
  revalidatePath("/", "layout");
  return { ok: true, message: "تم حفظ هوية الشركة. حُفظت نسخة من الإعدادات السابقة ويمكن استعادتها.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function restoreBranding(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("settings.branding");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية إدارة الهوية." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_restore_branding", { p_history: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  await invalidateMyContext();
  revalidatePath("/", "layout");
  return { ok: true, message: "تمت استعادة الهوية السابقة." };
}
