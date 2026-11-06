"use client";

import { useState } from "react";
import { btnPrimary, btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { createShareLink, type ShareState } from "@/app/(app)/quotes/actions";

/**
 * مشاركة مستند مع العميل: رابط آمن يفتح دون حساب (صالح لمدة محددة وقابل للإلغاء)، مع نسخ وواتساب ومشاركة الجهاز،
 * وإرسال بالبريد فقط إن كانت خدمة البريد مهيأة (وإلا يُقال ذلك صراحة). الطباعة/PDF من زر الطباعة في صفحة المستند.
 */
export default function ShareBox({ kind, id, title, customerEmail }: { kind: "quote" | "survey"; id: string; title: string; customerEmail?: string | null }) {
  const [days, setDays] = useState("30");
  const [email, setEmail] = useState(customerEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ShareState | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(withEmail: boolean) {
    setBusy(true); setCopied(false);
    try {
      setState(await createShareLink({ kind, id, days: Number(days), email: withEmail ? email : undefined, subject: title }));
    } catch {
      setState({ ok: false, message: "انقطع الاتصال؛ لم يُنشأ الرابط. أعد المحاولة." });
    } finally { setBusy(false); }
  }
  const url = state?.url;
  const text = url ? `${title}\n${url}` : "";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`sh-days-${id}`} className={labelCls}>صلاحية الرابط</label>
          <select id={`sh-days-${id}`} value={days} onChange={(e) => setDays(e.target.value)} className={`${input} !w-auto`}>
            <option value="7">7 أيام</option><option value="30">30 يومًا</option><option value="90">90 يومًا</option>
          </select>
        </div>
        <button type="button" disabled={busy} onClick={() => void create(false)} className={btnPrimary}>{busy ? "جارٍ الإنشاء..." : "إنشاء رابط للعميل"}</button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`sh-mail-${id}`} className={labelCls}>أو أرسله بالبريد</label>
          <input id={`sh-mail-${id}`} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" className={input} />
        </div>
        <button type="button" disabled={busy || !email} onClick={() => void create(true)} className={btnSecondary}>إرسال</button>
      </div>
      {state && <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-green-700" : "text-red-700"}>{state.message}</p>}
      {url && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input readOnly value={url} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label="رابط المشاركة" className={`${input} text-xs`} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btnSecondary} ${btnSm}`}
              onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "✓ نُسخ" : "نسخ الرابط"}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>واتساب</a>
            <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`} className={`${btnSecondary} ${btnSm}`}>تطبيق البريد</a>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={() => void navigator.share({ title, text: title, url }).catch(() => {})}>مشاركة…</button>
            )}
            <a href={url} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>معاينة كما يراها العميل</a>
          </div>
          <p className="text-xs text-slate-500">الرابط يُعرض مرة واحدة هنا؛ احفظه أو أرسله الآن. يمكن إلغاؤه من قائمة الروابط.</p>
        </div>
      )}
    </div>
  );
}
