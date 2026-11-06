"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary } from "@/components/ui/styles";
import { startWorkOrderVisit } from "./actions";

/** «بدء الزيارة» لأمر عمل مسند؛ المفتاح يأتي من الخادم مرة واحدة فلا يُنشئ الضغط المكرر زيارة ثانية */
export default function StartWoVisitButton({ workOrderId, clientKey, label = "بدء الزيارة", className = btnPrimary }: {
  workOrderId: string; clientKey: string; label?: string; className?: string;
}) {
  const [state, action, pending] = useActionState(startWorkOrderVisit, initialActionState);
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <input type="hidden" name="client_key" value={clientKey} />
      <button type="submit" disabled={pending} aria-busy={pending} className={className}>{pending ? "جارٍ فتح الزيارة..." : label}</button>
      {state.message && !state.ok && <p role="alert" className="text-xs text-red-700">{state.message}</p>}
    </form>
  );
}
