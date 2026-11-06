"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary } from "@/components/ui/styles";
import { acceptAssistantInvitation } from "./actions";

export default function AcceptAssistant({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptAssistantInvitation, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.message && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.message}</p>}
      <button aria-busy={pending} type="submit" disabled={pending} className={`${btnPrimary} w-full py-3`}>{pending ? "جارٍ التحقق والقبول..." : "قبول الدعوة"}</button>
    </form>
  );
}
