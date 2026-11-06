"use client";

import { useActionState, type ReactNode } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { btnPrimary, input, label } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";

export interface InviteField {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  dir?: "ltr" | "rtl";
  defaultValue?: string;
  help?: string;
}

/** نموذج ينشئ دعوة (أو شركة مع دعوة) ويعرض الرابط الناتج مع النسخ والمشاركة. */
export default function InviteForm({
  action, fields, hidden = {}, submitLabel, children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: InviteField[];
  hidden?: Record<string, string>;
  submitLabel: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const keep = !state.ok; // بعد النجاح يُفرَّغ النموذج، وعند الخطأ تبقى القيم
  return (
    <div className="space-y-4">
      {state.invite && <InviteLinkCard invite={state.invite} />}
      <form action={formAction} className="space-y-4">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {state.message && !state.invite && (
          <p role="alert" className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
        )}
        <div key={state.attempt ?? 0} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {fields.map((f) => {
            const value = keep ? String((state.values?.[f.name] as string | undefined) ?? f.defaultValue ?? "") : f.defaultValue ?? "";
            return (
              <div key={f.name}>
                <label htmlFor={`inv-${f.name}`} className={label}>{f.label}{f.required && <span className="text-danger"> *</span>}</label>
                {f.type === "select" ? (
                  <select id={`inv-${f.name}`} name={f.name} defaultValue={value} required={f.required} className={input}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={`inv-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={value} required={f.required} dir={f.dir}
                    min={f.type === "number" ? 1 : undefined} max={f.type === "number" ? 720 : undefined} className={input} />
                )}
                {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
                {state.errors?.[f.name] && <p className="mt-1 text-xs text-red-700">{state.errors[f.name]}</p>}
              </div>
            );
          })}
        </div>
        {children}
        <button aria-busy={pending} type="submit" disabled={pending} className={btnPrimary}>{pending ? "جارٍ الإنشاء..." : submitLabel}</button>
      </form>
    </div>
  );
}
