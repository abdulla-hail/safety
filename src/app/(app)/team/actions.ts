"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { fail, intOrNull, list, str, type ActionState } from "@/lib/action-state";
import { INVITE_ROLES, inviteResult, rpcErrorMessage } from "@/lib/invitations";
import { companyRole, TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * الشركة الفعّالة للمستخدم إن كان مديرها. فحص أول للواجهة فقط؛
 * كل دالة في قاعدة البيانات تتحقق بنفسها من أن المنفّذ مدير الشركة المعنية (current_company_role).
 * معرّف الشركة يُؤخذ من الجلسة لا من النموذج.
 */
async function managedCompany() {
  const ctx = await getContext();
  const m = ctx?.active;
  return m && m.can_manage_team ? m.organization_id : null;
}

function hours(fd: FormData) {
  return Math.min(720, Math.max(1, intOrNull(fd, "expires_hours") ?? 72));
}

export async function inviteMember(prev: ActionState, fd: FormData): Promise<ActionState> {
  const company = await managedCompany();
  if (!company) return fail(prev, fd, "دعوة الأعضاء لمن يملك صلاحية إدارة الفريق.");
  const email = str(fd, "email").toLowerCase();
  const role = str(fd, "role");
  const errors: Record<string, string> = {};
  if (!EMAIL.test(email)) errors.email = "بريد غير صالح";
  if (!(INVITE_ROLES as readonly string[]).includes(role)) errors.role = "اختر دورًا";
  if (Object.keys(errors).length) return fail(prev, fd, "يرجى تصحيح الحقول المحددة.", errors);
  // تخصصات الفني تُحفظ مفاتيحَ مفصولة بفواصل، وتتحول عند القبول إلى تخصصات سجل الفني
  const specialty = role === "technician"
    ? list(fd, "specialties").filter((s) => s in TECHNICIAN_SPECIALTIES).join(",")
    : str(fd, "specialty");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_invite_member", {
    p_company: company, p_email: email, p_role: role, p_full_name: str(fd, "full_name") || null,
    p_job_title: str(fd, "job_title") || null, p_specialty: specialty || null, p_expires_hours: hours(fd),
  });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  let note = "تم إنشاء الدعوة.";
  if (str(fd, "custom_permissions") === "1") {
    const perms = [...new Set(fd.getAll("permissions").map(String))].filter((p) => (ALL_PERMISSIONS as readonly string[]).includes(p));
    const { error: pe } = await supabase.rpc("company_set_invitation_permissions", {
      p_invitation: (data as { invitation_id?: string }).invitation_id, p_permissions: perms,
    });
    note = pe ? `تم إنشاء الدعوة بصلاحيات الدور الافتراضية؛ تعذر حفظ التخصيص: ${rpcErrorMessage(pe)}` : `تم إنشاء الدعوة بصلاحيات مخصصة (${perms.length}).`;
  }
  revalidatePath("/team");
  return inviteResult(prev, data as { token?: string }, companyRole[role] ?? "عضو", note);
}

/** ربط عضو فني نشط (انضم قبل الربط التلقائي) بسجل فني تشغيلي واحد */
export async function linkTechnicianMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  if (!(await managedCompany()) || !isUuid(id)) return { ok: false, message: "غير مصرح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_link_technician_member", { p_membership: id });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/team");
  revalidatePath("/assignments");
  return { ok: true, message: "تم ربط العضو بسجل فني." };
}

export async function resendInvitation(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!(await managedCompany()) || !isUuid(id)) return { ok: false, message: "غير مصرح." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_resend_invitation", { p_invitation: id, p_expires_hours: 72 });
  if (error) return { ok: false, message: rpcErrorMessage(error), attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath("/team");
  return inviteResult(prev, data as { token?: string }, "دعوة بديلة", "أُنشئت دعوة بديلة وأُبطل الرابط السابق.");
}

export async function revokeInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "invitation_id");
  if (!(await managedCompany()) || !isUuid(id)) return { ok: false, message: "غير مصرح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_revoke_invitation", { p_invitation: id });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/team");
  return { ok: true, message: "تم إلغاء الدعوة." };
}

export async function updateMember(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  if (!(await managedCompany()) || !isUuid(id)) return fail(prev, fd, "غير مصرح.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_update_member", {
    p_membership: id, p_full_name: str(fd, "full_name"), p_job_title: str(fd, "job_title"), p_specialty: str(fd, "specialty"),
  });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath("/team");
  return { ok: true, message: "تم حفظ بيانات العضو.", attempt: (prev.attempt ?? 0) + 1 };
}

export async function setMemberRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  const role = str(fd, "role");
  if (!(await managedCompany()) || !isUuid(id) || !(INVITE_ROLES as readonly string[]).includes(role)) return { ok: false, message: "الأدوار المتاحة: مدير أو فني." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_set_member_role", { p_membership: id, p_role: role });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/team");
  return { ok: true, message: "تم تغيير الدور." };
}

export async function setMemberStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  const status = str(fd, "status");
  if (!(await managedCompany()) || !isUuid(id) || !["active", "suspended", "removed"].includes(status)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_set_member_status", { p_membership: id, p_status: status });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/team");
  return { ok: true, message: status === "removed" ? "أُزيل العضو مع الاحتفاظ بسجلاته." : status === "suspended" ? "تم تعطيل العضوية." : "تم تفعيل العضوية." };
}

export async function changeMemberEmail(prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  const email = str(fd, "email").toLowerCase();
  if (!(await managedCompany()) || !isUuid(id)) return fail(prev, fd, "غير مصرح.");
  if (!EMAIL.test(email)) return fail(prev, fd, "البريد غير صالح.", { email: "غير صالح" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_change_member_email", { p_membership: id, p_new_email: email, p_expires_hours: hours(fd) });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath("/team");
  return inviteResult(prev, data as { token?: string }, "تغيير البريد",
    "أُنشئت دعوة تحقق للبريد الجديد. تنتقل العضوية إلى الحساب الجديد بعد قبولها فقط.");
}

export async function transferManagement(prev: ActionState, fd: FormData): Promise<ActionState> {
  const company = await managedCompany();
  const email = str(fd, "email").toLowerCase();
  if (!company) return fail(prev, fd, "هذه العملية للمدير الأساسي فقط.");
  if (!EMAIL.test(email)) return fail(prev, fd, "البريد غير صالح.", { email: "غير صالح" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_transfer_management", { p_company: company, p_new_email: email, p_expires_hours: hours(fd) });
  if (error) return fail(prev, fd, rpcErrorMessage(error));
  revalidatePath("/team");
  return inviteResult(prev, data as { token?: string }, "نقل إدارة الشركة",
    "أُنشئت دعوة نقل الإدارة. عند قبولها يصبح صاحب البريد الجديد المدير الأساسي وتبقى أنت مديرًا.");
}

export async function setMemberPermissions(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "membership_id");
  if (!(await managedCompany()) || !isUuid(id)) return { ok: false, message: "غير مصرح." };
  const reset = str(fd, "reset") === "1";
  const perms = reset ? null : [...new Set(fd.getAll("permissions").map(String))].filter((p) => (ALL_PERMISSIONS as readonly string[]).includes(p));
  const supabase = await createClient();
  const { error } = await supabase.rpc("company_set_member_permissions", { p_membership: id, p_permissions: perms });
  if (error) return { ok: false, message: rpcErrorMessage(error) };
  revalidatePath("/team");
  return { ok: true, message: reset ? "عادت صلاحيات العضو إلى الافتراضية لدوره (المدير: كل الصلاحيات)." : "تم حفظ صلاحيات العضو وإشعاره." };
}
