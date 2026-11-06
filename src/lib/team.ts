import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { companyMemberStatus, companyRole, TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { cleanSearch, isUuid, param, params, type SearchParams } from "@/lib/list";

export interface TeamMember {
  id: string; user_id: string; role: string; status: string; is_primary: boolean;
  full_name: string | null; email: string | null; job_title: string | null; specialty: string | null;
  permissions: string[] | null; created_at: string; removed_at: string | null;
  technician: { id: string; ref_no: string; phone: string | null; specialties: string[]; is_active: boolean } | null;
}

/** تخصصات العضو: من سجله الفني إن وُجد، وإلا من نص التخصص في العضوية */
export function memberSpecialties(m: TeamMember): string[] {
  const keys = m.technician?.specialties?.length ? m.technician.specialties : (m.specialty ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return keys.map((k) => TECHNICIAN_SPECIALTIES[k] ?? k);
}

export const TEAM_FILTER_KEYS = ["role", "status", "specialty", "q"] as const;

/**
 * أعضاء فريق الشركة بفلاتر الدور والحالة والتخصص والبحث (الاسم/البريد/المسمى/التخصص)، ومعرّفات محددة اختياريًا.
 * القراءة بصلاحيات المستخدم (RLS): مدير الشركة يرى أعضاء شركته فقط. تستخدمها الصفحة والطباعة والتصدير نفسها.
 */
export async function loadTeam(supabase: SupabaseClient, companyId: string, sp: SearchParams) {
  let q = supabase.from("company_memberships")
    .select("id, user_id, role, status, is_primary, full_name, email, job_title, specialty, permissions, created_at, removed_at")
    .eq("company_id", companyId).order("is_primary", { ascending: false }).order("role").order("full_name");
  const role = param(sp, "role");
  if (role && role in companyRole) q = q.eq("role", role);
  const status = param(sp, "status");
  if (status && status in companyMemberStatus) q = q.eq("status", status);
  const ids = params(sp, "ids").filter(isUuid);
  if (ids.length) q = q.in("id", ids.slice(0, 500));
  const [{ data, error }, techs] = await Promise.all([
    q,
    supabase.from("technicians").select("id, ref_no, phone, specialties, is_active, user_id").eq("company_id", companyId).not("user_id", "is", null),
  ]);
  const techByUser = new Map((techs.data ?? []).map((t) => [t.user_id as string, t]));
  let rows = ((data ?? []) as Omit<TeamMember, "technician">[]).map((m) => ({ ...m, technician: (techByUser.get(m.user_id) as TeamMember["technician"]) ?? null }));

  const specialty = param(sp, "specialty");
  if (specialty && specialty in TECHNICIAN_SPECIALTIES) {
    rows = rows.filter((m) => (m.technician?.specialties ?? []).includes(specialty) || (m.specialty ?? "").split(",").map((x) => x.trim()).includes(specialty));
  }
  const term = cleanSearch(param(sp, "q")).toLowerCase();
  if (term) {
    rows = rows.filter((m) => [m.full_name, m.email, m.job_title, companyRole[m.role], companyMemberStatus[m.status]?.label, ...memberSpecialties(m)]
      .some((v) => (v ?? "").toLowerCase().includes(term)));
  }
  return { rows, error };
}

/** معايير الفلترة الحالية لإعادة استخدامها في روابط الطباعة والتصدير */
export function teamFilterQuery(sp: SearchParams) {
  const u = new URLSearchParams();
  for (const k of TEAM_FILTER_KEYS) if (param(sp, k)) u.set(k, param(sp, k));
  return u.toString();
}
