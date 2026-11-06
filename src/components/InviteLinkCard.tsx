"use client";

import { useState } from "react";
import { btnPrimary, btnSecondary, input } from "@/components/ui/styles";

/**
 * يعرض رابط الدعوة مرة واحدة مع النسخ والمشاركة اليدوية (بريد أو WhatsApp).
 * لا يُرسل شيء تلقائيًا؛ المستخدم يختار وسيلة الإرسال بنفسه.
 */
export default function InviteLinkCard({ invite }: { invite: { url: string; email: string; expiresAt: string; label: string } }) {
  const [copied, setCopied] = useState(false);
  const expires = invite.expiresAt
    ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }).format(new Date(invite.expiresAt))
    : "";
  const text = `دعوة للانضمام إلى منصة عين السلامة (${invite.label}). افتح الرابط وسجّل الدخول بحساب Google بالبريد ${invite.email}:\n${invite.url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-green-300 bg-green-50 p-4" role="status">
      <p className="text-sm font-bold text-green-900">تم إنشاء رابط الدعوة — {invite.label}</p>
      <p className="text-xs text-green-900">
        للبريد <b dir="ltr">{invite.email}</b>{expires && <> · صالح حتى {expires}</>}. يظهر الرابط هنا مرة واحدة فقط؛ إن فُقد أنشئ دعوة بديلة.
      </p>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="invite-url" className="sr-only">رابط الدعوة</label>
        <input id="invite-url" readOnly value={invite.url} dir="ltr" className={`${input} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy} className={btnPrimary}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <a className={btnSecondary} href={`mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent("دعوة إلى منصة عين السلامة")}&body=${encodeURIComponent(text)}`}>
          إرسال عبر البريد
        </a>
        <a className={btnSecondary} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          إرسال عبر WhatsApp
        </a>
      </div>
    </div>
  );
}
