"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { btnSecondary } from "@/components/ui/styles";

/**
 * زر ينفّذ Server Action مع تأكيد اختياري، ويمنع الإرسال المتكرر، ويعرض رسالة النتيجة.
 * القيم المخفية تُرسل مع النموذج (مثل المعرّف).
 */
export default function ActionButton({
  action,
  label,
  pendingLabel = "جارٍ التنفيذ...",
  confirm,
  hidden = {},
  className = btnSecondary,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  hidden?: Record<string, string>;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col items-start gap-1"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button aria-busy={pending} type="submit" disabled={pending} className={className}>
        {pending ? pendingLabel : label}
      </button>
      {state.message && (
        <span role={state.ok ? "status" : "alert"} className={`max-w-xs text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
