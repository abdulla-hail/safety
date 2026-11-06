"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnDangerOutline, btnPrimary, btnSecondary, btnSm, input, label } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";
import { PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_LABELS } from "@/lib/platform-permissions";
import { inviteAssistant, updateAssistant } from "./actions";

function PermissionBoxes({ selected }: { selected: string[] }) {
  return (
    <fieldset className="grid gap-1 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-2">
      <legend className="px-1 text-xs font-bold">صلاحيات المساعد</legend>
      {PLATFORM_PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-2 py-0.5 text-xs">
          <input type="checkbox" name="permissions" value={p} defaultChecked={selected.includes(p)} className="size-3.5 accent-[var(--brand)]" />
          {PLATFORM_PERMISSION_LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

/** دعوة مساعد مالك: البريد والصلاحيات تُحدد قبل الإرسال؛ الرابط يظهر للنسخ، والبريد يُرسل فقط إن كانت خدمته مهيأة */
export function InviteAssistantForm({ mailReady }: { mailReady: boolean }) {
  const [state, action, pending] = useActionState(inviteAssistant, initialActionState);
  const v = (k: string) => (!state.ok ? String((state.values?.[k] as string | undefined) ?? "") : "");
  return (
    <div className="space-y-4">
      {state.message && <p role={state.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>}
      {state.invite && <InviteLinkCard invite={state.invite} />}
      <form action={action} className="space-y-3">
        <div key={state.attempt ?? 0} className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="ai-email" className={label}>بريد المساعد (حساب Google) <span className="text-danger">*</span></label>
            <input id="ai-email" name="email" type="email" required dir="ltr" defaultValue={v("email")} className={input} />
          </div>
          <div>
            <label htmlFor="ai-name" className={label}>الاسم</label>
            <input id="ai-name" name="full_name" maxLength={200} defaultValue={v("full_name")} className={input} />
          </div>
          <div>
            <label htmlFor="ai-hours" className={label}>صلاحية الرابط (ساعة)</label>
            <input id="ai-hours" name="expires_hours" type="number" min={1} max={720} defaultValue={v("expires_hours") || "72"} className={input} />
          </div>
        </div>
        <PermissionBoxes selected={["platform.companies.view"]} />
        <p className="text-xs text-slate-500">
          {mailReady ? "تُرسل رسالة الدعوة إلى البريد، ويظهر الرابط أيضًا للنسخ." : "لا توجد خدمة بريد مهيأة حاليًا: سيظهر الرابط لتنسخه وترسله يدويًا، ولن يُدّعى إرسال بريد."}
          {" "}الرابط شخصي، يُستخدم مرة واحدة، وبحساب Google للبريد نفسه فقط.
        </p>
        <button aria-busy={pending} type="submit" disabled={pending} className={btnPrimary}>{pending ? "جارٍ إنشاء الدعوة..." : mailReady ? "إنشاء الدعوة وإرسالها بالبريد" : "إنشاء رابط الدعوة"}</button>
      </form>
    </div>
  );
}

/** تعديل صلاحيات مساعد قائم، أو تعطيله/تفعيله/إلغاء صفته (لا يُحذف السجل) */
export function AssistantEditor({ userId, permissions, status }: { userId: string; permissions: string[]; status: string }) {
  const [state, action, pending] = useActionState(updateAssistant, initialActionState);
  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2">
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="status" value="active" />
        <PermissionBoxes selected={permissions} />
        <button aria-busy={pending} type="submit" disabled={pending} className={`${btnPrimary} ${btnSm}`}>{status === "active" ? "حفظ الصلاحيات" : "إعادة التفعيل بهذه الصلاحيات"}</button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {status === "active" && (
          <form action={action} onSubmit={(e) => { if (!window.confirm("تعطيل المساعد؟ تتوقف صلاحياته فورًا.")) e.preventDefault(); }}>
            <input type="hidden" name="user_id" value={userId} /><input type="hidden" name="status" value="suspended" /><input type="hidden" name="keep_permissions" value="1" />
            <button aria-busy={pending} type="submit" disabled={pending} className={`${btnSecondary} ${btnSm}`}>تعطيل</button>
          </form>
        )}
        {status !== "revoked" && (
          <form action={action} onSubmit={(e) => { if (!window.confirm("إلغاء صفة مساعد المالك؟ يبقى السجل للمراجعة.")) e.preventDefault(); }}>
            <input type="hidden" name="user_id" value={userId} /><input type="hidden" name="status" value="revoked" /><input type="hidden" name="keep_permissions" value="1" />
            <button aria-busy={pending} type="submit" disabled={pending} className={`${btnDangerOutline} ${btnSm}`}>إلغاء الصفة</button>
          </form>
        )}
        {state.message && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </div>
  );
}
