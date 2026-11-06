import "server-only";

/**
 * إرسال البريد الصادر للمنصة. لا توجد حاليًا خدمة بريد مهيأة في المشروع (لا مفتاح مزود ولا مفتاح خدمة Supabase)،
 * وبريد Supabase المدمج مخصص لرسائل المصادقة فقط. لذلك:
 *  - إن ضُبط RESEND_API_KEY وMAIL_FROM في متغيرات البيئة يُرسل عبر واجهة Resend HTTP (دون حزم إضافية).
 *  - وإلا يعيد { sent: false, reason: "not_configured" } ولا يدّعي الإرسال أبدًا.
 */
export type MailResult = { sent: true } | { sent: false; reason: "not_configured" | "failed"; detail?: string };

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { sent: false, reason: "failed", detail: `HTTP ${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: "failed", detail: "network" };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** رسالة دعوة مساعد المالك (عربية RTL) */
export function assistantInviteEmail(link: string, name: string | null, permissions: string[], expiresAt: string) {
  const subject = "دعوة للانضمام كمساعد لمالك منصة عين السلامة";
  const list = permissions.map((p) => `<li>${esc(p)}</li>`).join("");
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1f2933">
    <h2 style="color:#1e3a5f">دعوة من مالك منصة عين السلامة</h2>
    <p>${name ? `مرحبًا ${esc(name)}،` : "مرحبًا،"}</p>
    <p>دعاك مالك منصة «عين السلامة» لتكون مساعدًا له بالصلاحيات التالية:</p><ul>${list}</ul>
    <p><a href="${esc(link)}" style="display:inline-block;background:#d98e04;color:#1c1300;font-weight:bold;padding:10px 18px;border-radius:8px;text-decoration:none">فتح الدعوة</a></p>
    <p style="font-size:12px;color:#64748b">الرابط شخصي ويُستخدم مرة واحدة بحساب Google لهذا البريد نفسه، وصالح حتى ${esc(expiresAt)}. إن لم تتوقع هذه الرسالة فتجاهلها.</p>
  </div>`;
  const text = `دعوة من مالك منصة عين السلامة لتكون مساعدًا له.\nالصلاحيات: ${permissions.join("، ")}\nافتح الرابط: ${link}\nصالح حتى ${expiresAt}، ويُستخدم مرة واحدة بالبريد نفسه.`;
  return { subject, html, text };
}
