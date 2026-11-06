"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle } from "@/components/ui/styles";
import { saveNotificationPreferences } from "./actions";

type Kind = { kind: string; label: string; group: string; applies: boolean };

export default function PrefsForm({ kinds, enabled }: { kinds: Kind[]; enabled: string[] }) {
  const [state, action, pending] = useActionState(saveNotificationPreferences, initialActionState);
  const on = new Set(enabled);
  const groups = [...new Set(kinds.map((k) => k.group))];
  const setAll = (form: HTMLFormElement | null, group: string, value: boolean) =>
    form?.querySelectorAll<HTMLInputElement>(`input[data-group="${group}"]`).forEach((i) => { i.checked = value; });

  return (
    <form action={action} className="space-y-4" key={state.attempt ?? 0}>
      {groups.map((g) => (
        <section key={g} className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>{g}</h2>
            <div className="flex gap-1">
              <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={(e) => setAll(e.currentTarget.form, g, true)}>تفعيل الكل</button>
              <button type="button" className={`${btnSecondary} ${btnSm}`} onClick={(e) => setAll(e.currentTarget.form, g, false)}>إيقاف الكل</button>
            </div>
          </div>
          <ul className="grid gap-x-6 gap-y-2 p-5 sm:grid-cols-2">
            {kinds.filter((k) => k.group === g).map((k) => (
              <li key={k.kind}>
                <label className={`flex items-center gap-2 text-sm ${k.applies ? "" : "text-slate-400"}`}>
                  <input type="checkbox" name="kinds" value={k.kind} data-group={g} defaultChecked={on.has(k.kind)} className="size-4 accent-[var(--brand)]" />
                  {k.label}{!k.applies && <span className="text-[10px]">(لا يصل لدورك حاليًا)</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending} className={btnPrimary}>{pending ? "جارٍ الحفظ..." : "حفظ التفضيلات"}</button>
        {state.message && <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
      </div>
    </form>
  );
}
