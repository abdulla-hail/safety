"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { btnSecondary, btnSm, btnDangerOutline } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** إعادة إرسال (دعوة بديلة برابط جديد) أو إلغاء دعوة. */
export default function InvitationRowActions({ invitationId, canResend, canRevoke, resend, revoke }: {
  invitationId: string; canResend: boolean; canRevoke: boolean; resend: Act; revoke: Act;
}) {
  const [rs, resendAction, resendPending] = useActionState(resend, initialActionState);
  const [vs, revokeAction, revokePending] = useActionState(revoke, initialActionState);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {canResend && (
          <form action={resendAction} onSubmit={(e) => { if (!window.confirm("إنشاء دعوة بديلة؟ سيتوقف الرابط السابق فورًا.")) e.preventDefault(); }}>
            <input type="hidden" name="invitation_id" value={invitationId} />
            <button aria-busy={resendPending} type="submit" disabled={resendPending} className={`${btnSecondary} ${btnSm}`}>{resendPending ? "..." : "إعادة إرسال"}</button>
          </form>
        )}
        {canRevoke && (
          <form action={revokeAction} onSubmit={(e) => { if (!window.confirm("إلغاء الدعوة؟ لن يعمل رابطها بعد ذلك.")) e.preventDefault(); }}>
            <input type="hidden" name="invitation_id" value={invitationId} />
            <button aria-busy={revokePending} type="submit" disabled={revokePending} className={`${btnDangerOutline} ${btnSm}`}>{revokePending ? "..." : "إلغاء"}</button>
          </form>
        )}
      </div>
      {rs.invite && <div className="w-full max-w-xl text-start"><InviteLinkCard invite={rs.invite} /></div>}
      {[rs, vs].map((s, i) => s.message && (
        <span key={i} role={s.ok ? "status" : "alert"} className={`max-w-xs text-xs ${s.ok ? "text-green-700" : "text-red-700"}`}>{s.message}</span>
      ))}
    </div>
  );
}
