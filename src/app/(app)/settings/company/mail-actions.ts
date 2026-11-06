"use server";

import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { encryptSecret, secretsConfigured } from "@/lib/secret";
import { documentEmail, loadCompanyMail, mailFailureText, sendCompanyMail } from "@/lib/company-mail";
import { str, type ActionState } from "@/lib/action-state";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST = /^[A-Za-z0-9.-]{3,253}$/;

/** القيم المعادة للنموذج عند الخطأ — بلا كلمة المرور أبدًا */
function values(fd: FormData) {
  const v: Record<string, string> = {};
  for (const k of ["sender_name", "sender_email", "reply_to", "smtp_host", "smtp_port", "smtp_user"]) v[k] = str(fd, k);
  v.smtp_secure = fd.get("smtp_secure") === "on" ? "on" : "";
  v.enabled = fd.get("enabled") === "on" ? "on" : "";
  return v;
}
const bad = (prev: ActionState, fd: FormData, message: string, errors?: Record<string, string>): ActionState =>
  ({ ok: false, message, errors, values: values(fd), attempt: (prev.attempt ?? 0) + 1 });

/** حفظ بيانات المرسل وخادم SMTP؛ كلمة المرور تُشفَّر في الخادم قبل الحفظ، والحقل الفارغ يُبقي كلمة المرور الحالية */
export async function saveMailSettings(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("settings.branding");
  if (!ctx) return bad(prev, fd, "ليست لديك صلاحية إدارة إعدادات الشركة.");
  const g = (k: string) => str(fd, k).trim();
  const errors: Record<string, string> = {};
  const port = Number.parseInt(g("smtp_port") || "0", 10);
  if (g("sender_email") && !EMAIL.test(g("sender_email"))) errors.sender_email = "بريد غير صالح";
  if (g("reply_to") && !EMAIL.test(g("reply_to"))) errors.reply_to = "بريد غير صالح";
  if (g("smtp_host") && !HOST.test(g("smtp_host"))) errors.smtp_host = "اسم خادم غير صالح";
  if (g("smtp_host") && !(port >= 1 && port <= 65535)) errors.smtp_port = "منفذ غير صالح (465 أو 587 عادةً)";
  const enabled = fd.get("enabled") === "on";
  const password = str(fd, "smtp_password");
  if (enabled && (!g("sender_email") || !g("smtp_host"))) errors.enabled = "أكمل البريد الرسمي وخادم SMTP قبل التفعيل";
  if (password && !secretsConfigured()) return bad(prev, fd, "لا يمكن حفظ كلمة المرور: مفتاح التشفير MAIL_ENCRYPTION_KEY غير مضبوط على الخادم.");
  if (Object.keys(errors).length) return bad(prev, fd, "راجع الحقول المحددة؛ لم يُحفظ شيء.", errors);
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    company_id: ctx.orgId, sender_name: g("sender_name") || null, sender_email: g("sender_email") || null, reply_to: g("reply_to") || null,
    smtp_host: g("smtp_host") || null, smtp_port: g("smtp_host") ? port : null, smtp_secure: fd.get("smtp_secure") === "on",
    smtp_user: g("smtp_user") || null, enabled, updated_by: ctx.user.id,
    ...(password ? { smtp_password_enc: encryptSecret(password) } : {}),
  };
  const { error } = await supabase.from("company_mail_settings").upsert(row, { onConflict: "company_id" });
  if (error) return bad(prev, fd, dbErrorMessage(error));
  if (enabled && !password) {
    const cfg = await loadCompanyMail(supabase, ctx.orgId);
    if (!cfg?.smtp_password_enc) {
      revalidatePath("/settings/company");
      return { ok: true, message: "حُفظت البيانات، لكن كلمة مرور البريد لم تُدخل بعد؛ لن يُرسل شيء حتى تُدخلها.", attempt: (prev.attempt ?? 0) + 1 };
    }
  }
  revalidatePath("/settings/company");
  return { ok: true, message: "حُفظت إعدادات البريد الرسمي. أرسل رسالة تجريبية للتأكد من وصولها.", attempt: (prev.attempt ?? 0) + 1 };
}

/** رسالة تجريبية حقيقية من خادم الشركة إلى بريد المستخدم الحالي (أو بريد يحدده)، وتسجيل النتيجة */
export async function testMailSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("settings.branding");
  if (!ctx) return { ok: false, message: "ليست لديك صلاحية." };
  const to = str(fd, "to").trim() || ctx.user.email || "";
  if (!EMAIL.test(to)) return { ok: false, message: "حدد بريدًا صالحًا لاستلام الرسالة التجريبية." };
  const supabase = await createClient();
  const [cfg, { data: co }] = await Promise.all([
    loadCompanyMail(supabase, ctx.orgId),
    supabase.from("companies").select("name, phone, email, primary_color").eq("id", ctx.orgId).maybeSingle(),
  ]);
  const company = cfg?.sender_name || co?.name || ctx.active.organization_name;
  const m = documentEmail({ company, title: "رسالة تجريبية من البريد الرسمي", url: "https://example.com", days: 1, phone: co?.phone, email: cfg?.sender_email, color: co?.primary_color });
  const r = await sendCompanyMail(cfg, { to, subject: `رسالة تجريبية — ${company}`, html: m.html.replace(/<p><a[\s\S]*?<\/p>\s*<p style[\s\S]*?<\/p>/, "<p>هذه رسالة تجريبية للتأكد من إعدادات البريد.</p>"), text: `رسالة تجريبية من ${company}` }, { ignoreDisabled: true });
  await supabase.rpc("company_mail_test_result", { p_company: ctx.orgId, p_ok: r.sent, p_error: r.sent ? null : mailFailureText(r) });
  revalidatePath("/settings/company");
  return r.sent
    ? { ok: true, message: `أرسل خادم البريد الرسالة إلى ${to} بنجاح. تحقق من صندوق الوارد (والرسائل غير المرغوبة).` }
    : { ok: false, message: mailFailureText(r) };
}
