"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, btnSecondary, btnSm } from "@/components/ui/styles";
import { MANAGEMENT_PERMISSIONS, permissionsByModule } from "@/lib/permissions";
import { setMemberPermissions } from "./actions";

/**
 * تخصيص صلاحيات عضو: يبدأ من صلاحياته الفعلية (الافتراضية لدوره أو المخصصة سابقًا).
 * «العودة للافتراضي» يلغي التخصيص (للمدير: كل الصلاحيات). صلاحيات الإدارة لا تُعرض للفني.
 * التحقق النهائي في قاعدة البيانات: مدير يملك إدارة الفريق، لا لنفسه ولا للمدير الأساسي، والمديرون للمدير الأساسي فقط.
 */
export default function PermissionsEditor({ membershipId, effective, customized, available, manager = false, grantable }: {
  membershipId: string; effective: string[]; customized: boolean;
  /** صلاحيات القاعدة الحالية فقط (لا تُعرض صلاحيات ترحيل لم يُطبَّق) */
  available?: string[];
  /** العضو مدير: تظهر صلاحيات الإدارة وزر «كل الصلاحيات» */
  manager?: boolean;
  /** ما يستطيع المنفّذ منحه (غير المدير الأساسي يمنح ما يملكه فقط)؛ undefined = الكل */
  grantable?: string[];
}) {
  const shown = (k: string) => (manager || !MANAGEMENT_PERMISSIONS.includes(k)) && (!manager || k !== "field.assigned");
  const canGrant = (k: string) => !grantable || grantable.includes(k) || perms.has(k);
  const [state, action, pending] = useActionState(setMemberPermissions, initialActionState);
  const [perms, setPerms] = useState<Set<string>>(new Set(effective));
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-600">{manager
        ? (customized ? "صلاحيات محددة لهذا المدير." : "هذا المدير يملك كل الصلاحيات.") + " «إدارة الفريق» تتيح له إدارة الفنيين ودعواتهم."
        : (customized ? "صلاحيات مخصصة لهذا العضو." : "الصلاحيات الحالية هي الافتراضية لدوره.") + " حدّد ما يحتاجه لعمله فقط."}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {permissionsByModule(available).map((m) => ({ ...m, permissions: m.permissions.filter((p) => shown(p.key)) })).filter((m) => m.permissions.length).map((m) => (
          <fieldset key={m.key} className="rounded-lg border border-slate-200 bg-white p-2">
            <legend className="px-1 text-xs font-bold">{m.label}</legend>
            {m.permissions.map((p) => (
              <label key={p.key} className={`flex items-center gap-2 py-0.5 text-xs ${canGrant(p.key) ? "" : "text-slate-400"}`}>
                <input type="checkbox" checked={perms.has(p.key)} disabled={!canGrant(p.key)} onChange={() => toggle(p.key)} className="size-3.5 accent-[var(--brand)]" />
                {p.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <input type="hidden" name="membership_id" value={membershipId} />
          {[...perms].filter(shown).map((p) => <input key={p} type="hidden" name="permissions" value={p} />)}
          <button aria-busy={pending} type="submit" disabled={pending} className={`${btnPrimary} ${btnSm}`}>{pending ? "..." : `حفظ الصلاحيات (${perms.size})`}</button>
        </form>
        {customized && (
          <form action={action} onSubmit={(e) => { if (!window.confirm(manager ? "منح هذا المدير كل الصلاحيات؟" : "إلغاء التخصيص والعودة لصلاحيات الدور الافتراضية؟")) e.preventDefault(); }}>
            <input type="hidden" name="membership_id" value={membershipId} />
            <input type="hidden" name="reset" value="1" />
            <button aria-busy={pending} type="submit" disabled={pending} className={`${btnSecondary} ${btnSm}`}>{manager ? "منح كل الصلاحيات" : "العودة لصلاحيات الدور"}</button>
          </form>
        )}
        {state.message && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </div>
  );
}
