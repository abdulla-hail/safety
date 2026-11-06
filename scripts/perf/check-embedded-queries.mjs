// يتحقق من صياغة الاستعلامات المضمّنة الجديدة على PostgREST الحي بالمفتاح العام (لا بيانات تُقرأ: RLS/الصلاحيات تمنع anon).
// خطأ صياغة أو علاقة يظهر برمز PGRST1xx/PGRST2xx؛ أما 42501/مصفوفة فارغة فتعني أن الاستعلام سليم البناء.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const id = "00000000-0000-0000-0000-000000000000";

const checks = {
  device: sb.from("devices").select("*, customer:customers(id, name, visits(id, ref_no, scheduled_start, status, archived_at)), site:customer_sites(id, name), system:safety_systems(id, name), item:catalog_items(id, name, ref_no, specs)")
    .eq("id", id).eq("company_id", id).in("customer.visits.status", ["scheduled", "in_progress"]).is("customer.visits.archived_at", null)
    .order("scheduled_start", { referencedTable: "customer.visits", ascending: false }).limit(10, { referencedTable: "customer.visits" }).maybeSingle(),
  work_order: sb.from("work_orders").select("*, customer:customers(id, name, sites:customer_sites(id, name, archived_at), devices(id, ref_no, name, archived_at)), site:customer_sites(id, name)")
    .eq("id", id).eq("company_id", id).is("customer.sites.archived_at", null).is("customer.devices.archived_at", null)
    .order("ref_no", { referencedTable: "customer.devices" }).limit(300, { referencedTable: "customer.devices" }).maybeSingle(),
  visit: sb.from("visits").select("*, customer:customers(id, name, devices(id, ref_no, name, status, next_maintenance_at, site_id, archived_at), sites:customer_sites(id, name, archived_at)), site:customer_sites(id, name), work_order:work_orders(id, ref_no, title)")
    .eq("id", id).eq("company_id", id).is("customer.devices.archived_at", null)
    .order("next_maintenance_at", { referencedTable: "customer.devices", nullsFirst: false }).limit(300, { referencedTable: "customer.devices" }).maybeSingle(),
  platform_list: sb.from("companies").select("*, members:company_memberships(count), managers:company_memberships(count)", { count: "exact" })
    .eq("members.status", "active").eq("managers.role", "company_manager").eq("managers.status", "active").limit(1),
  assistants: sb.from("platform_assistant_requests").select("id, status").limit(1),
};
for (const [name, q] of Object.entries(checks)) {
  const { error, data } = await q;
  const code = error?.code ?? "ok";
  const structural = /^PGRST(1|2)/.test(code) || code === "42703" || code === "42P01";
  console.log(`${structural ? "✖" : "✔"} ${name}: ${code}${structural ? ` — ${error.message}` : ""}${!error ? ` (rows: ${Array.isArray(data) ? data.length : data ? 1 : 0})` : ""}`);
}
