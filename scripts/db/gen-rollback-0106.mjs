// يولّد ملف التراجع للترحيل المقترح 20261106000100 من التعريفات والسياسات الحالية في cgwn (قراءة فقط، قبل التطبيق).
// الدالة devices_set_schedule والسياسات الثلاث لا يغيّرها 20261105000100، فتعريفها الحالي هو تعريف ما قبل 20261106000100.
// الاستخدام: node scripts/db/gen-rollback-0106.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.visit_devices') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const fn = (await c.query("select pg_get_functiondef('public.devices_set_schedule(uuid[], integer, date, boolean)'::regprocedure) d")).rows[0].d.trim();
const pols = (await c.query(`select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'
  and (tablename, policyname) in (('visits', 'ays_visits_update'), ('visit_technicians', 'ays_vt_insert'), ('attachments', 'ays_attachments_insert'))
  order by tablename`)).rows;
await c.query("rollback");
await c.end();
if (pols.length !== 3) throw new Error("لم تُعثر على السياسات الثلاث المتوقعة — توقف.");

const policy = (p) => `drop policy if exists ${p.policyname} on public.${p.tablename};
create policy ${p.policyname} on public.${p.tablename} for ${p.cmd.toLowerCase()} to ${String(p.roles).replace(/[{}]/g, "")}${p.qual ? `\n  using (${p.qual})` : ""}${p.with_check ? `\n  with check (${p.with_check})` : ""};`;

const sql = `-- =====================================================================
-- التراجع عن 20261106000100_visit_inspections.sql (مولَّد من تعريفات وسياسات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بنود زيارات أو سجل تغيير مواعيد أو زيارات مغلقة/طارئة بالإجراء الجديد أو متابعات مسندة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.visit_devices) or exists (select 1 from public.device_due_changes)
     or exists (select 1 from public.visits where client_key is not null or closed_at is not null or urgent_reason is not null or close_exception_reason is not null)
     or exists (select 1 from public.maintenance_records where findings is not null or parts <> '[]'::jsonb)
     or exists (select 1 from public.device_faults where kind <> 'fault' or assigned_technician_id is not null or follow_up_due is not null or visit_id is not null)
     or exists (select 1 from public.company_memberships where permissions && array['visits.close_exception', 'maintenance.reschedule'])
     or exists (select 1 from public.company_invitations where permissions && array['visits.close_exception', 'maintenance.reschedule']) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

drop function if exists public.visit_close(uuid, text, text);
drop function if exists public.visit_save_item(uuid, jsonb, integer);
drop function if exists public.visit_remove_device(uuid);
drop function if exists public.visit_add_devices(uuid, uuid[]);
drop function if exists public.visit_start(uuid, uuid, text, text, uuid[], text);
drop function if exists app_private.visit_add_items(uuid, uuid[], text);
drop function if exists app_private.visit_fill_periodic(uuid);
drop function if exists public.device_set_next_due(uuid, date, text);

${fn};

${pols.map(policy).join("\n")}

drop trigger if exists trg_maintenance_via_visit on public.maintenance_records;
drop function if exists app_private.maintenance_via_visit();
drop trigger if exists trg_attachments_visit_open on public.attachments;
drop function if exists app_private.attachments_visit_open();
drop trigger if exists trg_visits_closed_guard on public.visits;
drop function if exists app_private.visits_closed_guard();
drop trigger if exists trg_devices_due_log on public.devices;
drop function if exists app_private.devices_due_log();
drop trigger if exists trg_devices_due_guard on public.devices;
drop function if exists app_private.devices_due_guard();
drop table if exists public.device_due_changes;
drop table if exists public.visit_devices;
drop function if exists app_private.visit_devices_guard();
drop function if exists app_private.visit_can_work(uuid);
drop function if exists app_private.my_technician(uuid);
revoke insert (kind, assigned_technician_id, follow_up_due) on public.device_faults from authenticated;
revoke update (assigned_technician_id, follow_up_due) on public.device_faults from authenticated;
alter table public.device_faults drop constraint if exists df_visit_fk;
alter table public.device_faults drop constraint if exists df_assignee_fk;
alter table public.device_faults drop column if exists visit_id;
alter table public.device_faults drop column if exists follow_up_due;
alter table public.device_faults drop column if exists assigned_technician_id;
alter table public.device_faults drop column if exists kind;
alter table public.maintenance_records drop constraint if exists maintenance_records_parts_array;
alter table public.maintenance_records drop column if exists parts;
alter table public.maintenance_records drop column if exists findings;
drop index if exists public.visits_one_open_periodic;
drop index if exists public.visits_client_key;
alter table public.visits drop column if exists close_exception_reason;
alter table public.visits drop column if exists closed_by;
alter table public.visits drop column if exists closed_at;
alter table public.visits drop column if exists urgent_reason;
alter table public.visits drop column if exists client_key;
delete from public.company_role_permissions where permission_key in ('visits.close_exception', 'maintenance.reschedule');
delete from public.permission_definitions where key in ('visits.close_exception', 'maintenance.reschedule');

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261106000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261106000100_rollback.sql", policies: pols.map((p) => p.policyname) }));
