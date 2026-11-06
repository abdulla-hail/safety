"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, btnSecondary, btnSm } from "@/components/ui/styles";
import { permissionsByModule } from "@/lib/permissions";
import { setMemberPermissions } from "./actions";

/**
 * تخصيص صلاحيات عضو: يبدأ من صلاحياته الفعلية (الافتراضية لدوره أو المخصصة سابقًا).
 * «العودة للافتراضي» يلغي التخصيص. التحقق النهائي في قاعدة البيانات (مدير الشركة فقط، لا لنفسه ولا للمدير).
 */
export default function PermissionsEditor({ membershipId, effective, customized, available }: {
  membershipId: string; effective: string[]; customized: boolean;
  /** صلاحيات القاعدة الحالية فقط (لا تُعرض صلاحيات ترحيل لم يُطبَّق) */
  available?: string[];
}) {
  const [state, action, pending] = useActionState(setMemberPermissions, initialActionState);
  const [perms, setPerms] = useState<Set<string>>(new Set(effective));
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-600">{customized ? "صلاحيات مخصصة لهذا العضو." : "الصلاحيات الحالية هي الافتراضية لدوره."} حدّد ما يحتاجه لعمله فقط.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {permissionsByModule(available).filter((m) => m.permissions.length).map((m) => (
          <fieldset key={m.key} className="rounded-lg border border-slate-200 bg-white p-2">
            <legend className="px-1 text-xs font-bold">{m.label}</legend>
            {m.permissions.map((p) => (
              <label key={p.key} className="flex items-center gap-2 py-0.5 text-xs">
                <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} className="size-3.5 accent-[var(--brand)]" />
                {p.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="membership_id" value={membershipId} />
          {[...perms].map((p) => <input key={p} type="hidden" name="permissions" value={p} />)}
          <button aria-busy={pending} type="submit" disabled={pending} className={`${btnPrimary} ${btnSm}`}>{pending ? "..." : `حفظ الصلاحيات (${perms.size})`}</button>
        </form>
        {customized && (
          <form action={action} onSubmit={(e) => { if (!window.confirm("إلغاء التخصيص والعودة لصلاحيات الدور الافتراضية؟")) e.preventDefault(); }}>
            <input type="hidden" name="membership_id" value={membershipId} />
            <input type="hidden" name="reset" value="1" />
            <button aria-busy={pending} type="submit" disabled={pending} className={`${btnSecondary} ${btnSm}`}>العودة لصلاحيات الدور</button>
          </form>
        )}
        {state.message && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </div>
  );
}
