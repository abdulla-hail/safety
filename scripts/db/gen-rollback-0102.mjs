// يولّد ملف التراجع لترحيل 20261102000100 من تعريف devices_before_write الحالي في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0102.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.device_transfers') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const def = (await c.query(`select pg_get_functiondef('app_private.devices_before_write()'::regprocedure) def`)).rows[0].def;
await c.query("rollback");
await c.end();

const sql = `-- =====================================================================
-- التراجع عن 20261102000100_device_location_transfers.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجد سجل نقل أو منح صلاحية النقل لعضو بتخصيص.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_transfers)
     or exists (select 1 from public.company_memberships where 'devices.transfer' = any (permissions))
     or exists (select 1 from public.company_invitations where 'devices.transfer' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد سجلات نقل أو صلاحيات نقل ممنوحة';
  end if;
end $$;

${def.trim()};

drop function if exists app_private.is_client_request();
drop trigger if exists trg_customer_sites_archive_devices on public.customer_sites;
drop function if exists app_private.sites_block_archive_with_devices();
drop function if exists public.device_move(uuid, uuid, text, timestamptz);
drop table if exists public.device_transfers;
delete from public.permission_definitions where key = 'devices.transfer';

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261102000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261102000100_rollback.sql" }));
