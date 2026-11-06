import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * أعضاء الشركة النشطون كخيارات لربط حساب الفني.
 * قائمة الأعضاء يقرؤها مدير الشركة (سياسة company_memberships)؛ غيره يرى عضويته فقط.
 */
export async function memberOptions(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase.from("company_memberships")
    .select("user_id, full_name, email, role").eq("company_id", orgId).eq("status", "active").order("full_name");
  return (data ?? []).map((m) => ({ value: m.user_id as string, label: `${m.full_name ?? "—"} (${m.email ?? ""})` }));
}
