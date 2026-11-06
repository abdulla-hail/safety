// يولّد ملف التراجع لترحيل 20261103000100 من التعريفات والسياسات الحالية في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0103.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.technician_customer_sites') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const fn = async (sig) => (await c.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d.trim();
const defs = [await fn("public.resolve_device_token(text)"), await fn("app_private.run_maintenance_alerts_for(uuid)")];
const POLICIES = [["customer_sites", "ays_customer_sites_select"], ["devices", "ays_devices_select"], ["maintenance_records", "ays_mr_select"],
  ["visits", "ays_visits_select"], ["work_orders", "ays_wo_select"], ["device_transfers", "ays_dt_select"], ["attachments", "ays_attachments_select"]];
const policies = [];
for (const [t, name] of POLICIES) {
  const p = (await c.query(`select permissive, roles::text[] roles, cmd, qual, with_check from pg_policies where schemaname='public' and tablename=$1 and policyname=$2`, [t, name])).rows[0];
  if (!p) throw new Error(`السياسة ${name} غير موجودة`);
  const roles = p.roles.map((r) => (r === "public" ? "public" : `"${r}"`)).join(", ");
  policies.push(`drop policy if exists ${name} on public.${t};\ncreate policy ${name} on public.${t} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${roles}`
    + `${p.qual ? ` using (${p.qual})` : ""}${p.with_check ? ` with check (${p.with_check})` : ""};`);
}
await c.query("rollback");
await c.end();

const sql = `-- =====================================================================
-- التراجع عن 20261103000100_assignment_scope_history.sql (مولَّد من تعريفات وسياسات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجد نطاق مواقع أو فني أساسي أو أحداث إسناد بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.technician_customer_sites)
     or exists (select 1 from public.technician_customers where is_primary)
     or exists (select 1 from public.technician_assignment_events where reason is distinct from 'قائم قبل تفعيل سجل الإسناد') then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد إسنادات أو أحداث أُنشئت بعد الترحيل';
  end if;
end $$;

${policies.join("\n")}

${defs.join(";\n\n")};

drop function if exists app_private.device_responsible_users(uuid);
drop function if exists app_private.attachment_entity_visible(text, uuid);
drop function if exists public.assignment_set_primary(uuid, uuid, text);
drop function if exists public.assignment_remove(uuid, uuid, text);
drop function if exists public.assignment_set(uuid, uuid, uuid[], text);
drop trigger if exists trg_technician_customers_events on public.technician_customers;
drop function if exists app_private.log_assignment();
drop table if exists public.technician_assignment_events;
drop index if exists public.technician_customers_one_primary;
drop table if exists public.technician_customer_sites;
drop function if exists app_private.tcs_clear_primary();
drop function if exists app_private.log_assignment_site();
drop function if exists app_private.tcs_before_insert();
drop function if exists public.company_can_view_site(uuid, uuid, uuid, text);
drop function if exists app_private.is_assigned_site(uuid, uuid, uuid);

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261103000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261103000100_rollback.sql" }));
