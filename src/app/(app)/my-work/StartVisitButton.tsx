"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary } from "@/components/ui/styles";
import { startVisit } from "./actions";

/**
 * بدء أو استئناف الزيارة الدورية لموقع. مفتاح العميل يأتي من الخادم مرة واحدة مع الصفحة:
 * الضغط المكرر أو إعادة الإرسال يعيد الزيارة نفسها، والقاعدة تستأنف الزيارة الدورية المفتوحة للموقع بدل إنشاء أخرى.
 */
export default function StartVisitButton({ siteId, clientKey, label, className = btnPrimary }: { siteId: string; clientKey: string; label: string; className?: string }) {
  const [state, action, pending] = useActionState(startVisit, initialActionState);
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="visit_type" value="periodic" />
      <input type="hidden" name="client_key" value={clientKey} />
      <button type="submit" disabled={pending} aria-busy={pending} className={className}>{pending ? "جارٍ الفتح..." : label}</button>
      {state.message && !state.ok && <p role="alert" className="text-xs text-red-700">{state.message}</p>}
    </form>
  );
}
