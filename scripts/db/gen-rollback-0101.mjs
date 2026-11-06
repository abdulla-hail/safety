// يولّد ملف التراجع لترحيل 20261101000100 من تعريف platform_delete_company الحالي في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0101.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regprocedure('public.platform_company_dependencies(uuid)') f")).rows[0].f) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const def = (await c.query(`select pg_get_functiondef('public.platform_delete_company(uuid, text)'::regprocedure) def`)).rows[0].def;
await c.query("rollback");
await c.end();

const sql = `-- =====================================================================
-- التراجع عن 20261101000100_company_edit_delete.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- لا يعيد شركات حُذفت بعد الترحيل (لقطتها في سجل التدقيق)؛ يرفض التنفيذ إن وُجد حذف بالآلية الجديدة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_audit_log where action = 'company_deleted') then
    raise exception 'التراجع مرفوض: حُذفت شركات بالآلية الجديدة؛ راجع سجل التدقيق أولًا';
  end if;
end $$;

${def.trim()};

drop function if exists public.platform_company_dependencies(uuid);
drop function if exists public.platform_update_company_details(uuid, jsonb);

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261101000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261101000100_rollback.sql" }));
