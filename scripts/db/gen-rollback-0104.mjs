// يولّد ملف التراجع لترحيل 20261104000100 من التعريفات الحالية في cgwn (قراءة فقط، قبل التطبيق وبعد تطبيق 20261103000100).
// الاستخدام: node scripts/db/gen-rollback-0104.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.device_maintenance_cycles') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
if (!(await c.query("select to_regprocedure('app_private.device_responsible_users(uuid)') f")).rows[0].f) {
  throw new Error("طبّق 20261103000100 أولًا؛ هذا الترحيل يعتمد عليه.");
}
const fn = async (sig) => (await c.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d.trim();
const defs = [];
for (const sig of ["app_private.devices_before_write()", "app_private.maintenance_before_insert()", "app_private.maintenance_after_insert()",
  "app_private.run_maintenance_alerts_for(uuid)"]) defs.push(await fn(sig));
await c.query("rollback");
await c.end();

const sql = `-- =====================================================================
-- التراجع عن 20261104000100_maintenance_schedule_alerts.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت دورات استحقاق مغلقة أو سجلات صيانة أو فترات بالأشهر أو إعدادات غير افتراضية بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_maintenance_cycles where status <> 'open')
     or exists (select 1 from public.maintenance_records where cycle_id is not null)
     or exists (select 1 from public.devices where maintenance_interval_months is not null)
     or exists (select 1 from public.companies where default_interval_months <> 3 or schedule_policy <> 'from_completion' or escalation_days <> 7)
     or exists (select 1 from public.safety_systems where default_interval_months is not null)
     or exists (select 1 from public.catalog_items where default_interval_months is not null) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات جدولة أُنشئت بعد الترحيل';
  end if;
end $$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'ays-maintenance-alerts') then perform cron.unschedule('ays-maintenance-alerts'); end if;
end $$;

drop function if exists app_private.run_maintenance_alerts_for(uuid, date);
drop function if exists app_private.company_followup_users(uuid);
drop function if exists app_private.riyadh_date(timestamptz);

${defs.join(";\n\n")};
-- صلاحية التنفيذ كما كانت قبل الترحيل (postgres فقط)
revoke all on function app_private.run_maintenance_alerts_for(uuid) from public, anon, authenticated, service_role;

drop function if exists public.platform_maintenance_alert_runs();
drop function if exists app_private.cron_maintenance_alerts();
drop table if exists app_private.maintenance_alert_runs;
drop function if exists public.company_update_maintenance_settings(uuid, integer, text, integer, integer);
drop function if exists public.devices_set_schedule(uuid[], integer, date, boolean);
drop trigger if exists trg_devices_cycle_sync on public.devices;
drop function if exists app_private.devices_cycle_sync();
drop function if exists app_private.cycle_close(uuid, text, uuid, date);
drop function if exists app_private.cycle_open(uuid, date);
drop table if exists public.device_maintenance_cycles;
drop function if exists public.maintenance_due_status(date, integer);
drop function if exists app_private.compute_next_due(date, integer, integer, text, date, date);
drop function if exists app_private.add_months(date, integer);
alter table public.maintenance_records drop column if exists cycle_id;
alter table public.maintenance_records drop column if exists kind;
alter table public.catalog_items drop column if exists default_interval_months;
alter table public.safety_systems drop column if exists default_interval_months;
alter table public.devices drop column if exists schedule_start_date;
alter table public.devices drop column if exists maintenance_interval_months;
alter table public.companies drop column if exists escalation_days;
alter table public.companies drop column if exists schedule_policy;
alter table public.companies drop column if exists default_interval_months;
-- امتداد pg_cron يبقى مثبتًا (لا يضر)؛ أزيلت مهمته فقط

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261104000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261104000100_rollback.sql" }));
