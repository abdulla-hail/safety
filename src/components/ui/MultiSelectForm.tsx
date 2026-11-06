"use client";

import { useActionState, useMemo, useState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { btnPrimary, input } from "@/components/ui/styles";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** قائمة بمربعات اختيار مع بحث محلي وتحديد الكل، تُرسل القيم دفعة واحدة. */
export default function MultiSelectForm({
  action,
  name,
  options,
  hidden = {},
  submitLabel = "حفظ",
  emptyText = "لا توجد خيارات متاحة.",
  searchPlaceholder = "تصفية القائمة...",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  name: string;
  options: Option[];
  hidden?: Record<string, string>;
  submitLabel?: string;
  emptyText?: string;
  searchPlaceholder?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [filter, setFilter] = useState("");
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  // بعد الحفظ تختفي العناصر المسندة من الخيارات؛ لا تُرسل قيم لم تعد ظاهرة
  const selected = useMemo(() => new Set([...rawSelected].filter((v) => options.some((o) => o.value === v))), [rawSelected, options]);
  const visible = useMemo(
    () => options.filter((o) => !filter || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(filter.toLowerCase())),
    [options, filter],
  );

  if (options.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;

  const toggle = (v: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  });
  const allVisible = visible.length > 0 && visible.every((o) => selected.has(o.value));

  return (
    <form action={formAction} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {[...selected].map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={searchPlaceholder} className={`${input} max-w-xs`} aria-label="تصفية" />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={allVisible} className="size-4 accent-[var(--brand)]"
            onChange={() => setSelected((s) => {
              const n = new Set(s);
              visible.forEach((o) => (allVisible ? n.delete(o.value) : n.add(o.value)));
              return n;
            })} />
          تحديد الظاهر ({visible.length})
        </label>
        <span className="text-xs text-slate-500">المحدد: {selected.size}</span>
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {visible.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--brand)]" />
              <span className="flex-1">{o.label}</span>
              {o.hint && <span className="text-xs text-slate-500" dir="ltr">{o.hint}</span>}
            </label>
          </li>
        ))}
        {visible.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">لا نتائج للتصفية.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button aria-busy={pending} type="submit" disabled={pending || selected.size === 0} className={btnPrimary}>
          {pending ? "جارٍ الحفظ..." : `${submitLabel} (${selected.size})`}
        </button>
        {state.message && <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
