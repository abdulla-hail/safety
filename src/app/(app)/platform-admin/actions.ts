"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { platformForAction, type PlatformPermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { bool, fail, intOrNull, str, type ActionState } from "@/lib/action-state";
import { inviteResult, rpcErrorMessage } from "@/lib/invitations";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * صلاحيات المنصة (المالك يملكها كلها، والمساعد ما مُنح له) من get_my_context. هذا فحص أول فقط؛
 * دوال قاعدة البيانات (require_platform_perm) ترفض أي عملية بلا الصلاحية مهما كان مصدرها.
 */
const NO_PERM = "ليست لديك صلاحية هذه العملية في إدارة المنصة.";
const allowed = (perm: PlatformPermission) => platformForAction(perm);

function hours(fd: FormData) {
  const h = intOrNull(fd, "expires_hours") ?? 72;
  return Math.min(720, Math.max(1, h));
}

export async function createCompany(prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await allowed("platform.companies.create"))) return fail(prev, fd, NO_PERM);
  const name = str(fd, "name");
  const email = str(fd, "manager_email").toLowerCase();
  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 200) errors.name = "اسم الشركة مطلوب (2–200 حرف)";
  if (!EMAIL.test(email)) errors.manager_email = "بريد مدير الشركة غير صالح";
  if (Object.keys(errors).length) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_create_company", {
    p_name: name,
    p_manager_email: email,
    p_commercial_registration: str(fd, "commercial_registration") || null,
    p_phone: str(fd, "phone") || null,
    p_city: str(fd, "city") || null,
    p_expires_hours: hours(fd),
  });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath("/platform-admin");
  const r = data as { token?: string; email?: string; expires_at?: string; ref_no?: string };
  return inviteResult(prev, r, "مدير الشركة", `تم تسجيل الشركة ${r.ref_no ?? ""} وإنشاء دعوة مديرها.`);
}

const COMPANY_FIELDS = ["name", "legal_name", "commercial_registration", "vat_number", "license_no",
  "phone", "email", "website", "city", "address"] as const;

/** التحقق الأول هنا لرسائل الحقول؛ القاعدة (platform_update_company_details) تعيد التحقق وتسجل التدقيق قبل/بعد */
export async function updateCompany(prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await allowed("platform.companies.update"))) return fail(prev, fd, NO_PERM);
  const id = str(fd, "id");
  if (!isUuid(id)) return fail(prev, fd, "طلب غير صالح.");
  const data = Object.fromEntries(COMPANY_FIELDS.map((k) => [k, str(fd, k)]));
  const errors: Record<string, string> = {};
  if (data.name.length < 2 || data.name.length > 200) errors.name = "اسم الشركة مطلوب (2–200 حرف)";
  if (data.email && !EMAIL.test(data.email)) errors.email = "بريد غير صالح";
  if (data.website && !/^https?:\/\/\S+\.\S+$/i.test(data.website)) errors.website = "يبدأ بـ http:// أو https://";
  if (data.phone && !/^[0-9+()\s-]{5,30}$/.test(data.phone)) errors.phone = "رقم غير صالح";
  if (data.vat_number && !/^[0-9]{15}$/.test(data.vat_number)) errors.vat_number = "15 رقمًا";
  if (Object.keys(errors).length) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_update_company_details", { p_company: id, p_data: data });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath(`/platform-admin/${id}`);
  revalidatePath("/platform-admin");
  return { ok: true, message: "تم حفظ بيانات الشركة.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function setCompanyStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await allowed("platform.companies.status"))) return { ok: false, message: NO_PERM };
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!isUuid(id) || !["active", "suspended", "archived"].includes(status)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_company_status", { p_company: id, p_status: status });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/platform-admin");
  revalidatePath(`/platform-admin/${id}`);
  return { ok: true, message: "تم تحديث حالة الشركة." };
}

export async function inviteManager(prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await allowed("platform.companies.invitations"))) return fail(prev, fd, NO_PERM);
  const id = str(fd, "company_id");
  const email = str(fd, "email").toLowerCase();
  if (!isUuid(id)) return fail(prev, fd, "طلب غير صالح.");
  if (!EMAIL.test(email)) return fail(prev, fd, "البريد غير صالح.", { email: "غير صالح" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_invite_manager", { p_company: id, p_email: email, p_expires_hours: hours(fd) });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath(`/platform-admin/${id}`);
  return inviteResult(prev, data as { token?: string }, "مدير الشركة",
    "تم إنشاء دعوة المدير. إن كان للشركة مدير أساسي فستنتقل الإدارة عند قبول الدعوة ويصبح المدير السابق مشرفًا.");
}

export async function resendInvitation(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!isUuid(id)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_resend_invitation", { p_invitation: id, p_expires_hours: hours(fd) });
  if (error) return { ok: false, message: rpcErrorMessage(error), attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/team");
  return inviteResult(prev, data as { token?: string }, "دعوة بديلة", "أُنشئت دعوة بديلة وأُبطل الرابط السابق.");
}

export async function revokeInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!isUuid(id)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_revoke_invitation", { p_invitation: id });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/team");
  return { ok: true, message: "تم إلغاء الدعوة؛ الرابط لم يعد صالحًا." };
}

export async function deleteCompany(prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await allowed("platform.companies.delete"))) return fail(prev, fd, NO_PERM);
  const id = str(fd, "id");
  if (!isUuid(id)) return fail(prev, fd, "طلب غير صالح.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_delete_company", { p_company: id, p_confirm_ref: str(fd, "confirm_ref") });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath("/platform-admin");
  redirect("/platform-admin?ok=deleted");
}

type StorageFile = { bucket: string; name: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * حذف ملفات شركة لم تعد موجودة من التخزين بجلسة المالك نفسها (لا مفتاح خدمة): سياسة التخزين تسمح للمالك
 * بحذف ملفات org-files/org-branding التي تتبع شركة محذوفة فقط. يعيد عدد ما حُذف فعليًا.
 */
async function removeFiles(supabase: Supabase, files: StorageFile[]): Promise<number> {
  let removed = 0;
  for (const bucket of new Set(files.map((f) => f.bucket))) {
    const names = files.filter((f) => f.bucket === bucket).map((f) => f.name);
    for (let i = 0; i < names.length; i += 100) {
      const { data, error } = await supabase.storage.from(bucket).remove(names.slice(i, i + 100));
      if (error) console.error("storage remove failed:", bucket, error.message);
      removed += data?.length ?? 0;
    }
  }
  return removed;
}

/**
 * الحذف الكامل للشركة (مالك المنصة الأساسي فقط): القاعدة تحذف كل صفوفها في معاملة واحدة وتحفظ اللقطة،
 * ثم تُحذف ملفاتها من التخزين. ما يتعذر حذفه من الملفات يظهر في «ملفات شركات محذوفة» لإعادة المحاولة.
 */
export async function purgeCompany(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await platformForAction("platform.companies.delete");
  if (ctx?.platformRole !== "owner") return fail(prev, fd, "الحذف الكامل لمالك المنصة فقط.");
  const id = str(fd, "id");
  const name = str(fd, "confirm_name");
  if (!isUuid(id)) return fail(prev, fd, "طلب غير صالح.");
  if (!name) return fail(prev, fd, "اكتب اسم الشركة للتأكيد.", { confirm_name: "مطلوب" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_purge_company", {
    p_company: id, p_confirm_name: name, p_delete_accounts: bool(fd, "delete_accounts"),
  });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  const files = ((data as { files?: StorageFile[] } | null)?.files ?? []);
  const removed = await removeFiles(supabase, files);
  revalidatePath("/platform-admin");
  redirect(`/platform-admin?ok=purged${removed < files.length ? `&files_left=${files.length - removed}` : ""}`);
}

/** حذف ملفات الشركات المحذوفة المتبقية في التخزين (فشل سابق أو ملفات اختبار قديمة) */
// الوسيط تفرضه useActionState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cleanOrphanFiles(_prev: ActionState): Promise<ActionState> {
  const ctx = await platformForAction("platform.companies.delete");
  if (ctx?.platformRole !== "owner") return { ok: false, message: "لمالك المنصة فقط." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_orphan_company_files", { p_limit: 1000 });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  const files = (data ?? []) as StorageFile[];
  const removed = await removeFiles(supabase, files);
  revalidatePath("/platform-admin");
  return removed === files.length
    ? { ok: true, message: `حُذف ${removed} ملفًا.` }
    : { ok: false, message: `حُذف ${removed} من ${files.length} ملفًا؛ أعد المحاولة لاحقًا.` };
}
