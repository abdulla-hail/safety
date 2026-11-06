// يولّد ملف التراجع لترحيل 20261105000100 من التعريفات والقيود الحالية في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0105.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.device_faults') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const fn = async (sig) => (await c.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d.trim();
const defs = [await fn("app_private.attachment_module(text)"), await fn("app_private.attachment_entity_visible(text, uuid)")];
const cons = (await c.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
  where contype = 'c' and ((conrelid in ('public.devices'::regclass, 'public.maintenance_records'::regclass) and pg_get_constraintdef(oid) like '%decommissioned%')
    or (conrelid = 'public.attachments'::regclass and pg_get_constraintdef(oid) like '%entity_type%'))`)).rows;
await c.query("rollback");
await c.end();

const restore = cons.map((x) => `alter table ${x.t} add constraint ${x.conname} ${x.d};`).join("\n");
const sql = `-- =====================================================================
-- التراجع عن 20261105000100_visits_faults_history.sql (مولَّد من تعريفات وقيود cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بلاغات أو تصحيحات أو صور مصنفة أو بيانات زيارة/فحص جديدة أو حالات جهاز جديدة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_faults) or exists (select 1 from public.maintenance_corrections)
     or exists (select 1 from public.attachments where photo_stage is not null or device_id is not null or entity_type = 'fault')
     or exists (select 1 from public.visits where visit_type <> 'periodic' or outcome is not null or recommendations is not null or follow_up_status <> 'none')
     or exists (select 1 from public.maintenance_records where readings <> '{}'::jsonb or actions_taken is not null or recommendations is not null)
     or exists (select 1 from public.devices where status in ('faulty', 'replaced') or replaced_by_device_id is not null)
     or exists (select 1 from public.maintenance_records where status_after in ('faulty', 'replaced'))
     or exists (select 1 from public.company_memberships where permissions && array['faults.view', 'faults.create', 'faults.update', 'maintenance.correct'])
     or exists (select 1 from public.company_invitations where permissions && array['faults.view', 'faults.create', 'faults.update', 'maintenance.correct']) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل';
  end if;
end $$;

${defs.join(";\n\n")};

drop function if exists public.fault_transition(uuid, text, text, uuid, text, text);
drop function if exists public.maintenance_correct(uuid, text, jsonb, text);
alter table public.maintenance_records drop constraint if exists mr_fault_fk;
alter table public.maintenance_records drop column if exists fault_id;
drop table if exists public.device_fault_events;
drop table if exists public.device_faults;
drop function if exists app_private.faults_after_insert();
drop function if exists app_private.faults_before_insert();
drop trigger if exists trg_attachments_device on public.attachments;
drop function if exists app_private.attachments_check_device();
alter table public.attachments drop constraint if exists attachments_device_fk;
drop index if exists public.attachments_device_idx;
alter table public.attachments drop column if exists device_id;
alter table public.attachments drop column if exists photo_stage;
alter table public.attachments drop constraint if exists attachments_entity_type_check;
drop table if exists public.maintenance_corrections;
drop trigger if exists trg_maintenance_condition on public.maintenance_records;
drop function if exists app_private.maintenance_capture_condition();
alter table public.maintenance_records drop column if exists recommendations;
alter table public.maintenance_records drop column if exists actions_taken;
alter table public.maintenance_records drop column if exists readings;
alter table public.maintenance_records drop column if exists condition_before;
alter table public.visits drop column if exists follow_up_status;
alter table public.visits drop column if exists recommendations;
alter table public.visits drop column if exists outcome;
alter table public.visits drop column if exists visit_type;
alter table public.devices drop constraint if exists devices_replaced_by_fk;
alter table public.devices drop column if exists replaced_by_device_id;
alter table public.devices drop constraint if exists devices_status_check;
alter table public.maintenance_records drop constraint if exists maintenance_records_status_after_check;
${restore}
delete from public.company_role_permissions where permission_key in ('faults.view', 'faults.create', 'faults.update', 'maintenance.correct');
delete from public.permission_definitions where key in ('faults.view', 'faults.create', 'faults.update', 'maintenance.correct');

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261105000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261105000100_rollback.sql", constraints: cons.map((x) => x.conname) }));
