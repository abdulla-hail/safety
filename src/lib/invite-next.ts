/**
 * كوكي قصير العمر يحفظ رابط الدعوة عبر رحلة الدخول بحساب Google، فلا يضيع إن لم تُعِد خدمة الدخول مسار العودة
 * (مثل رجوعها إلى عنوان الموقع الافتراضي). يقرؤه رد الدخول وصفحة «العضوية»، ويُحذف عند قبول الدعوة.
 */
export const INVITE_NEXT_COOKIE = "ays_invite_next";

/** قيمة الكوكي مرمّزة؛ فك الترميز آمن (قيمة تالفة ⇒ null) */
export function readCookiePath(v: string | null | undefined): string | null {
  if (!v) return null;
  try { return decodeURIComponent(v); } catch { return null; }
}

/** يقبل مسارات صفحات الدعوة فقط (لا روابط خارجية ولا مسارات أخرى) */
export function safeInvitePath(v: string | null | undefined): string | null {
  return v && /^\/(assistant-invite|invite)\/[A-Za-z0-9_%-]{20,200}$/.test(v) ? v : null;
}
