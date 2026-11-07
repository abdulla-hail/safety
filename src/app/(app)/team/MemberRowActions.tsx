"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnDangerOutline, btnPrimary, btnSecondary, btnSm, input } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";
import { changeMemberEmail, setMemberRole, setMemberStatus, updateMember } from "./actions";

/**
 * إجراءات عضو (لا تظهر للمدير الأساسي ولا لحساب المستخدم نفسه، ولا لمدير إلا للمدير الأساسي؛ وقاعدة البيانات تفرض ذلك أيضًا).
 * الدوران: فني، ومدير (يعيّنه المدير الأساسي فقط).
 */
export default function MemberRowActions({ id, role, status, fullName, jobTitle, specialty, canAssignManager }: {
  id: string; role: string; status: string; fullName: string; jobTitle: string; specialty: string; canAssignManager: boolean;
}) {
  const roles = [{ value: "technician", label: "فني" }, ...(canAssignManager || role === "company_manager" ? [{ value: "company_manager", label: "مدير" }] : [])];
  const known = roles.some((r) => r.value === role);
  const [open, setOpen] = useState<"" | "edit" | "email">("");
  const [roleState, roleAction, rolePending] = useActionState(setMemberRole, initialActionState);
  const [stState, stAction, stPending] = useActionState(setMemberStatus, initialActionState);
  const [edState, edAction, edPending] = useActionState(updateMember, initialActionState);
  const [emState, emAction, emPending] = useActionState(changeMemberEmail, initialActionState);
  const confirmThen = (msg: string) => (e: React.FormEvent) => { if (!window.confirm(msg)) e.preventDefault(); };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "removed" && (
          <form action={roleAction} className="flex items-center gap-1" onSubmit={confirmThen("تغيير دور العضو؟ تعود صلاحياته إلى افتراضيات الدور الجديد (المدير: كل الصلاحيات).")}>
            <input type="hidden" name="membership_id" value={id} />
            <label htmlFor={`role-${id}`} className="sr-only">الدور</label>
            <select id={`role-${id}`} name="role" defaultValue={known ? role : ""} required className={`${input} !w-auto !py-1 text-xs`}>
              {!known && <option value="" disabled>اختر الدور</option>}
              {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button aria-busy={rolePending} type="submit" disabled={rolePending} className={`${btnSecondary} ${btnSm}`}>حفظ الدور</button>
          </form>
        )}
        {status === "active" && (
          <form action={stAction} onSubmit={confirmThen("تعطيل العضوية؟ يفقد العضو الوصول فورًا وتبقى سجلاته.")}>
            <input type="hidden" name="membership_id" value={id} /><input type="hidden" name="status" value="suspended" />
            <button aria-busy={stPending} type="submit" disabled={stPending} className={`${btnSecondary} ${btnSm}`}>تعطيل</button>
          </form>
        )}
        {status !== "active" && (
          <form action={stAction} onSubmit={confirmThen("إعادة تفعيل العضوية؟")}>
            <input type="hidden" name="membership_id" value={id} /><input type="hidden" name="status" value="active" />
            <button aria-busy={stPending} type="submit" disabled={stPending} className={`${btnPrimary} ${btnSm}`}>تفعيل</button>
          </form>
        )}
        {status !== "removed" && (
          <form action={stAction} onSubmit={confirmThen("إزالة العضو من الشركة؟ تبقى سجلات أعماله التاريخية.")}>
            <input type="hidden" name="membership_id" value={id} /><input type="hidden" name="status" value="removed" />
            <button aria-busy={stPending} type="submit" disabled={stPending} className={`${btnDangerOutline} ${btnSm}`}>إزالة</button>
          </form>
        )}
        <button type="button" onClick={() => setOpen(open === "edit" ? "" : "edit")} className={`${btnSecondary} ${btnSm}`}>تعديل البيانات</button>
        {status !== "removed" && <button type="button" onClick={() => setOpen(open === "email" ? "" : "email")} className={`${btnSecondary} ${btnSm}`}>تغيير البريد</button>}
      </div>
      {[roleState, stState].map((s, i) => s.message && <p key={i} role={s.ok ? "status" : "alert"} className={`text-xs ${s.ok ? "text-green-700" : "text-red-700"}`}>{s.message}</p>)}

      {open === "edit" && (
        <form action={edAction} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <input type="hidden" name="membership_id" value={id} />
          <input name="full_name" defaultValue={fullName} placeholder="الاسم" aria-label="الاسم" className={input} />
          <input name="job_title" defaultValue={jobTitle} placeholder="المسمى الوظيفي" aria-label="المسمى الوظيفي" className={input} />
          <input name="specialty" defaultValue={specialty} placeholder="التخصص" aria-label="التخصص" className={input} />
          <button aria-busy={edPending} type="submit" disabled={edPending} className={`${btnPrimary} ${btnSm} sm:col-span-3 sm:justify-self-start`}>حفظ</button>
          {edState.message && <p role="alert" className={`text-xs sm:col-span-3 ${edState.ok ? "text-green-700" : "text-red-700"}`}>{edState.message}</p>}
        </form>
      )}
      {open === "email" && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <form action={emAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="membership_id" value={id} />
            <input name="email" type="email" required dir="ltr" placeholder="البريد الجديد" aria-label="البريد الجديد" className={`${input} max-w-xs`} />
            <button aria-busy={emPending} type="submit" disabled={emPending} className={`${btnPrimary} ${btnSm}`}>إنشاء دعوة تحقق</button>
          </form>
          <p className="text-xs text-slate-500">لا يتغير البريد إلا بعد أن يفتح صاحب البريد الجديد الرابط ويسجل الدخول به.</p>
          {emState.invite ? <InviteLinkCard invite={emState.invite} /> : emState.message && <p role="alert" className="text-xs text-red-700">{emState.message}</p>}
        </div>
      )}
    </div>
  );
}
