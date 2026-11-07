"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, input, label } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";
import { MANAGEMENT_PERMISSIONS, permissionsByModule } from "@/lib/permissions";
import { TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { inviteMember } from "./actions";

/**
 * دعوة عضو بدور «فني» أو «مدير» (المدير للمدير الأساسي فقط): البيانات والتخصصات والصلاحيات تُحفظ مع الدعوة، وعند القبول
 * بالبريد نفسه يصبح عضوًا بصلاحيات دوره (المدير: كل الصلاحيات ما لم تُحدد)، ويُنشأ/يُربط سجل الفني التشغيلي تلقائيًا.
 */
export default function MemberInviteForm({ roleDefaults, available, canInviteManager, grantable }: {
  roleDefaults: Record<string, string[]>; available?: string[]; canInviteManager: boolean; grantable?: string[];
}) {
  const ROLES = [["technician", "فني"], ...(canInviteManager ? [["company_manager", "مدير"] as const] : [])] as const;
  const [state, action, pending] = useActionState(inviteMember, initialActionState);
  const [role, setRole] = useState("technician");
  const [custom, setCustom] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set(roleDefaults.technician ?? []));
  const v = (k: string) => (!state.ok ? String((state.values?.[k] as string | undefined) ?? "") : "");
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const isManager = role === "company_manager";
  const shown = (k: string) => isManager ? k !== "field.assigned" : !MANAGEMENT_PERMISSIONS.includes(k);
  const canGrant = (k: string) => !grantable || grantable.includes(k);

  return (
    <div className="space-y-4">
      {state.invite && <InviteLinkCard invite={state.invite} />}
      {state.message && (!state.invite || !state.ok) && (
        <p role="alert" className={`rounded-lg p-3 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
      <form action={action} className="space-y-4">
        <div key={state.attempt ?? 0} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="mi-name" className={label}>الاسم</label>
            <input id="mi-name" name="full_name" defaultValue={v("full_name")} className={input} maxLength={200} />
          </div>
          <div>
            <label htmlFor="mi-email" className={label}>البريد الإلكتروني (حساب Google) <span className="text-danger">*</span></label>
            <input id="mi-email" name="email" type="email" required dir="ltr" defaultValue={v("email")} className={input} />
            {state.errors?.email && <p className="mt-1 text-xs text-red-700">{state.errors.email}</p>}
          </div>
          <div>
            <label htmlFor="mi-role" className={label}>الدور <span className="text-danger">*</span></label>
            <select id="mi-role" name="role" value={role} className={input}
              onChange={(e) => { setRole(e.target.value); setPerms(new Set(roleDefaults[e.target.value] ?? [])); }}>
              {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mi-title" className={label}>المسمى الوظيفي</label>
            <input id="mi-title" name="job_title" defaultValue={v("job_title")} className={input} maxLength={120} />
          </div>
          {role === "technician" ? (
            <fieldset className="md:col-span-2">
              <legend className={label}>التخصصات</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-slate-200 p-3">
                {Object.entries(TECHNICIAN_SPECIALTIES).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="specialties" value={k} className="size-4 accent-[var(--brand)]" /> {l}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">عند قبول الدعوة يُنشأ سجل الفني التشغيلي بهذه التخصصات ويُربط بحسابه، ثم تُسند إليه العملاء من صفحته.</p>
            </fieldset>
          ) : (
            <div>
              <label htmlFor="mi-spec" className={label}>التخصص (اختياري)</label>
              <input id="mi-spec" name="specialty" defaultValue={v("specialty")} className={input} maxLength={120} />
            </div>
          )}
          <div>
            <label htmlFor="mi-hours" className={label}>صلاحية الدعوة (ساعة)</label>
            <input id="mi-hours" name="expires_hours" type="number" min={1} max={720} defaultValue={v("expires_hours") || "72"} className={input} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            {isManager ? "تحديد صلاحيات هذا المدير الآن (وإلا يملك كل الصلاحيات)" : "تخصيص الصلاحيات الآن (وإلا تُطبق الصلاحيات الافتراضية للفني)"}
          </label>
          {custom && (
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <input type="hidden" name="custom_permissions" value="1" />
              {[...perms].filter(shown).map((p) => <input key={p} type="hidden" name="permissions" value={p} />)}
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
          )}
        </div>
        <button aria-busy={pending} type="submit" disabled={pending} className={btnPrimary}>{pending ? "جارٍ الإنشاء..." : "إنشاء رابط الدعوة"}</button>
      </form>
    </div>
  );
}
