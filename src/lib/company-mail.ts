import "server-only";

import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/secret";

/**
 * بريد الشركة الصادر: يُرسل من خادم SMTP الخاص بالشركة وبريدها الرسمي (المرسل الظاهر للعميل = اسم الشركة وبريدها)،
 * لا من بريد المنصة. الإعدادات من «هوية الشركة ← البريد الرسمي». لا يُدّعى الإرسال أبدًا إن لم يكتمل فعليًا.
 */
export interface CompanyMailConfig {
  sender_name: string | null; sender_email: string | null; reply_to: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_secure: boolean; smtp_user: string | null; smtp_password_enc: string | null;
  enabled: boolean;
}
export type CompanyMailResult = { sent: true } | { sent: false; reason: "not_configured" | "disabled" | "key_missing" | "failed"; detail?: string };

export async function loadCompanyMail(supabase: SupabaseClient, companyId: string): Promise<CompanyMailConfig | null> {
  const { data, error } = await supabase.rpc("company_mail_config", { p_company: companyId });
  if (error || !data) return null;
  return data as CompanyMailConfig;
}

export function companyMailReady(c: CompanyMailConfig | null): boolean {
  return !!c && c.enabled && !!c.smtp_host && !!c.smtp_port && !!c.sender_email && !!c.smtp_password_enc;
}

/** إرسال فعلي عبر SMTP الشركة (مهلة 20 ثانية). override لاختبار الإعدادات قبل حفظها/تفعيلها. */
export async function sendCompanyMail(cfg: CompanyMailConfig | null, msg: { to: string; subject: string; html: string; text: string },
  opts: { ignoreDisabled?: boolean; password?: string } = {}): Promise<CompanyMailResult> {
  if (!cfg || !cfg.smtp_host || !cfg.smtp_port || !cfg.sender_email) return { sent: false, reason: "not_configured" };
  if (!cfg.enabled && !opts.ignoreDisabled) return { sent: false, reason: "disabled" };
  const pass = opts.password ?? decryptSecret(cfg.smtp_password_enc);
  if (!pass) return { sent: false, reason: cfg.smtp_password_enc ? "key_missing" : "not_configured" };
  try {
    const t = nodemailer.createTransport({
      host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_secure,
      auth: { user: cfg.smtp_user || cfg.sender_email, pass },
      connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    await t.sendMail({
      from: { name: cfg.sender_name || cfg.sender_email, address: cfg.sender_email },
      replyTo: cfg.reply_to || undefined,
      to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
    });
    return { sent: true };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    return { sent: false, reason: "failed", detail: [err.code, err.responseCode, (err.message ?? "").slice(0, 160)].filter(Boolean).join(" ") };
  }
}

export function mailFailureText(r: CompanyMailResult): string {
  if (r.sent) return "";
  switch (r.reason) {
    case "not_configured": return "البريد الرسمي للشركة غير مهيأ (هوية الشركة ← البريد الرسمي).";
    case "disabled": return "الإرسال من البريد الرسمي غير مفعّل في إعدادات الشركة.";
    case "key_missing": return "مفتاح تشفير البريد غير مضبوط على الخادم (MAIL_ENCRYPTION_KEY)، أو تغيّر؛ أعد إدخال كلمة مرور البريد.";
    default: return `تعذر الإرسال من خادم بريد الشركة${r.detail ? ` (${r.detail})` : ""}.`;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** رسالة مستند للعميل بهوية الشركة فقط (لا اسم المنصة) */
export function documentEmail(o: { company: string; title: string; url: string; days: number; phone?: string | null; email?: string | null; color?: string | null }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(o.color ?? "") ? o.color! : "#0f766e";
  const contact = [o.phone, o.email].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#1f2933;max-width:560px">
  <h2 style="color:${color};margin:0 0 8px">${esc(o.company)}</h2>
  <p>السادة الكرام،</p>
  <p>تجدون ${esc(o.title)} على الرابط التالي:</p>
  <p><a href="${esc(o.url)}" style="display:inline-block;background:${color};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">عرض المستند</a></p>
  <p style="font-size:12px;color:#52606d">الرابط صالح ${o.days} يومًا. يمكنكم طباعته أو حفظه PDF من الصفحة.</p>
  <p>مع التحية،<br>${esc(o.company)}${contact ? `<br><span style="font-size:12px">${contact}</span>` : ""}</p></div>`;
  const text = `${o.company}\n\nتجدون ${o.title} على الرابط: ${o.url}\n(صالح ${o.days} يومًا)\n\n${o.company}${contact ? `\n${[o.phone, o.email].filter(Boolean).join(" · ")}` : ""}`;
  return { html, text };
}
