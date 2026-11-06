"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnSecondary, btnSm } from "@/components/ui/styles";
import { linkTechnicianMember } from "./actions";

/** لعضو فني انضم قبل الربط التلقائي: إنشاء سجل فني له أو ربط سجل قائم بالبريد نفسه */
export default function LinkTechnicianButton({ membershipId }: { membershipId: string }) {
  const [state, action, pending] = useActionState(linkTechnicianMember, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="membership_id" value={membershipId} />
      <span className="text-xs text-amber-700">لا يوجد سجل فني مرتبط بهذا العضو.</span>
      <button aria-busy={pending} type="submit" disabled={pending} className={`${btnSecondary} ${btnSm}`}>{pending ? "..." : "إنشاء/ربط سجل الفني"}</button>
      {state.message && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
