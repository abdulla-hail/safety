"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { btnPrimary, btnSecondary, input, label as labelCls } from "@/components/ui/styles";
import { initialActionState, type ActionState } from "@/lib/action-state";

export type FieldType =
  | "text" | "email" | "tel" | "textarea" | "select" | "date" | "datetime-local"
  | "number" | "checkbox" | "checkboxes" | "color" | "hidden" | "url";

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  /** عرض الحقل على عمودين */
  wide?: boolean;
  min?: number;
  max?: number;
  dir?: "ltr" | "rtl";
  maxLength?: number;
}

type Values = Record<string, string | string[] | boolean | number | null | undefined>;

function asString(v: Values[string]): string {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  return Array.isArray(v) ? v[0] ?? "" : String(v);
}
function asList(v: Values[string]): string[] {
  if (Array.isArray(v)) return v;
  return v ? [String(v)] : [];
}

export default function EntityForm({
  action,
  fields,
  initial = {},
  submitLabel = "حفظ",
  cancelHref,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  initial?: Values;
  submitLabel?: string;
  cancelHref?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const values: Values = { ...initial, ...(state.values ?? {}) };
  // عند وجود قيم معادة بعد خطأ: تتحول الحقول غير المحددة لنصوص فارغة للخانات
  const fromState = state.values !== undefined;

  return (
    <form action={formAction} className="space-y-6" noValidate={false}>
      {state.message && (
        <p role="alert" className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {state.message}
        </p>
      )}
      <div key={state.attempt ?? 0} className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {fields.map((f) => {
          const id = `fld-${f.name}`;
          const err = state.errors?.[f.name];
          const common = {
            id,
            name: f.name,
            required: f.required,
            "aria-invalid": err ? true : undefined,
            "aria-describedby": err ? `${id}-err` : f.help ? `${id}-help` : undefined,
          } as const;
          if (f.type === "hidden") {
            return <input key={f.name} type="hidden" name={f.name} defaultValue={asString(values[f.name])} />;
          }
          let control: ReactNode;
          switch (f.type) {
            case "textarea":
              control = <textarea {...common} rows={3} defaultValue={asString(values[f.name])} placeholder={f.placeholder} maxLength={f.maxLength ?? 2000} className={input} />;
              break;
            case "select":
              control = (
                <select {...common} defaultValue={asString(values[f.name])} className={input}>
                  {!f.required && <option value="">—</option>}
                  {f.required && !asString(values[f.name]) && <option value="">اختر...</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              );
              break;
            case "checkbox": {
              const v = values[f.name];
              const checked = fromState ? asString(v) === "on" : v === true || v === "true" || v === "on";
              control = (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name={f.name} id={id} defaultChecked={checked} className="size-4 accent-[var(--brand)]" />
                  {f.help ?? f.label}
                </label>
              );
              break;
            }
            case "checkboxes": {
              const selected = new Set(asList(values[f.name]));
              control = (
                <fieldset className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-slate-200 p-3" aria-labelledby={`${id}-lbl`}>
                  {f.options?.map((o) => (
                    <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name={f.name} value={o.value} defaultChecked={selected.has(o.value)} className="size-4 accent-[var(--brand)]" />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
              );
              break;
            }
            default:
              control = (
                <input {...common} type={f.type ?? "text"} defaultValue={asString(values[f.name])} placeholder={f.placeholder}
                       min={f.min} max={f.max} dir={f.dir} maxLength={f.maxLength ?? 300}
                       className={f.type === "color" ? "h-10 w-24 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" : input} />
              );
          }
          return (
            <div key={f.name} className={f.wide || f.type === "textarea" || f.type === "checkboxes" ? "md:col-span-2" : ""}>
              {f.type !== "checkbox" && (
                <label htmlFor={id} id={`${id}-lbl`} className={labelCls}>
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
              )}
              {control}
              {f.help && f.type !== "checkbox" && <p id={`${id}-help`} className="mt-1 text-xs text-slate-500">{f.help}</p>}
              {err && <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{err}</p>}
            </div>
          );
        })}
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
        <button aria-busy={pending} type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "جارٍ الحفظ..." : submitLabel}
        </button>
        {cancelHref && <Link href={cancelHref} className={btnSecondary}>إلغاء</Link>}
      </div>
    </form>
  );
}
