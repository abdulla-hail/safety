// يولّد ملف التراجع لترحيل 20261108000100 من السياسات والقيود الحالية في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0108.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regprocedure('public.work_order_start_visit(uuid, uuid)') f")).rows[0].f) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const pols = (await c.query(`select tablename, policyname, qual from pg_policies where schemaname = 'public'
  and (tablename, policyname) in (('customers', 'ays_customers_select'), ('customer_sites', 'ays_customer_sites_select'),
    ('devices', 'ays_devices_select'), ('maintenance_records', 'ays_mr_select')) order by 1`)).rows;
const cons = (await c.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.attachments'::regclass
  and contype = 'c' and pg_get_constraintdef(oid) like '%photo_stage%'`)).rows;
const canWork = (await c.query("select pg_get_functiondef('app_private.visit_can_work(uuid)'::regprocedure) d")).rows[0].d.trim();
await c.query("rollback");
await c.end();
if (pols.length !== 4) throw new Error("لم تُعثر على السياسات الأربع المتوقعة — توقف.");

const sql = `-- =====================================================================
-- التراجع عن 20261108000100_work_order_execution.sql (مولَّد من سياسات وقيود cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بيانات تعتمد على الترحيل (ملاحظات فني، بلاغات بإجراء/توصية/مفتاح، صور بتصنيف جديد).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.visits where technician_notes is not null)
     or exists (select 1 from public.device_faults where action_taken is not null or recommendation is not null or client_key is not null)
     or exists (select 1 from public.attachments where photo_stage in ('fault', 'other')) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

drop policy if exists ays_files_delete on storage.objects;
drop function if exists public.attachment_delete(uuid);
drop function if exists app_private.attachment_deletable(uuid);
${canWork};
drop function if exists public.visit_report_fault(uuid, uuid, uuid, text, text, text, text, text);
drop function if exists public.visit_save_report(uuid, text, text, text);
drop trigger if exists trg_visits_close_work_order on public.visits;
drop function if exists app_private.visits_close_work_order();
drop function if exists public.work_order_start_visit(uuid, uuid);
${pols.map((p) => `alter policy ${p.policyname} on public.${p.tablename} using (${p.qual});`).join("\n")}
drop function if exists app_private.assigned_work_customer(uuid);
drop function if exists app_private.assigned_work_site(uuid);
drop function if exists app_private.assigned_work_device(uuid);
alter table public.attachments drop constraint if exists attachments_photo_stage_check;
${cons.map((x) => `alter table public.attachments add constraint ${x.conname} ${x.d};`).join("\n")}
drop index if exists public.visits_one_open_per_work_order;
drop index if exists public.device_faults_client_key;
alter table public.device_faults drop column if exists client_key;
alter table public.device_faults drop column if exists recommendation;
alter table public.device_faults drop column if exists action_taken;
alter table public.visits drop column if exists technician_notes;

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261108000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261108000100_rollback.sql", policies: pols.map((p) => p.policyname), constraints: cons.map((x) => x.conname) }));
