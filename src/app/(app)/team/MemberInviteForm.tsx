"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, input, label } from "@/components/ui/styles";
import InviteLinkCard from "@/components/InviteLinkCard";
import { permissionsByModule } from "@/lib/permissions";
import { TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { inviteMember } from "./actions";

const ROLES = [["technician", "فني"], ["supervisor", "مشرف"], ["accountant", "محاسب"], ["storekeeper", "أمين مستودع"]] as const;

/**
 * دعوة عضو (والفني خاصةً): البيانات والتخصصات والصلاحيات تُحفظ مع الدعوة، وعند القبول بالبريد نفسه
 * يصبح عضوًا في الشركة ويُنشأ/يُربط سجله الفني التشغيلي تلقائيًا في قاعدة البيانات.
 */
export default function MemberInviteForm({ roleDefaults, available }: { roleDefaults: Record<string, string[]>; available?: string[] }) {
  const [state, action, pending] = useActionState(inviteMember, initialActionState);
  const [role, setRole] = useState("technician");
  const [custom, setCustom] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set(roleDefaults.technician ?? []));
  const v = (k: string) => (!state.ok ? String((state.values?.[k] as string | undefined) ?? "") : "");
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
            تخصيص الصلاحيات الآن (وإلا تُطبق الصلاحيات الافتراضية للدور)
          </label>
          {custom && (
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <input type="hidden" name="custom_permissions" value="1" />
              {[...perms].map((p) => <input key={p} type="hidden" name="permissions" value={p} />)}
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
          )}
        </div>
        <button aria-busy={pending} type="submit" disabled={pending} className={btnPrimary}>{pending ? "جارٍ الإنشاء..." : "إنشاء رابط الدعوة"}</button>
      </form>
    </div>
  );
}
