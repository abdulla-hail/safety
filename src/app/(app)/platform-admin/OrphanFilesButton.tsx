"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { btnDangerOutline } from "@/components/ui/styles";

export default function OrphanFilesButton({ action }: { action: (prev: ActionState) => Promise<ActionState> }) {
  const [state, run, pending] = useActionState(action, initialActionState);
  return (
    <form action={run} className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => { if (!window.confirm("حذف ملفات الشركات المحذوفة من التخزين نهائيًا؟")) e.preventDefault(); }}>
      <button type="submit" aria-busy={pending} disabled={pending} className={btnDangerOutline}>{pending ? "جارٍ الحذف..." : "حذف هذه الملفات"}</button>
      {state.message && <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
