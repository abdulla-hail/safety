// فحص قراءة فقط: كل ما يرتبط بالشركة (أعمدة company_id، المفاتيح الأجنبية وسلوك الحذف، المشغلات، مراجع auth.users،
// الحاويات وسياساتها، الفهارس، ودوال السياسات وتقلبها). لا يطبع بيانات صفوف، فقط البنية والأعداد.
// الاستخدام: node scripts/db/inspect-company-graph.mjs > out.json
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
await c.query("set local statement_timeout = '20s'");
const q = async (s, p) => (await c.query(s, p)).rows;
const out = {};
out.company_tables = await q(`select table_name t, is_nullable from information_schema.columns
  where table_schema='public' and column_name='company_id' order by 1`);
out.fks = await q(`select conrelid::regclass::text src, confrelid::regclass::text dst, conname,
  pg_get_constraintdef(oid) def from pg_constraint where contype='f'
  and (connamespace='public'::regnamespace or confrelid::regclass::text like 'public.%' or confrelid = 'auth.users'::regclass)
  order by 2,1`);
out.triggers = await q(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) def from pg_trigger
  where not tgisinternal and tgrelid::regclass::text not like 'auth.%' order by 1,2`);
out.trigger_fns = await q(`select distinct p.proname, pg_get_functiondef(p.oid) def from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace where not t.tgisinternal and n.nspname in ('public','app_private')
  and t.tgrelid::regclass::text not like 'safety_%' and t.tgrelid::regclass::text not like 'public.safety_%'`);
out.buckets = await q(`select id, public, file_size_limit from storage.buckets order by 1`);
out.storage_policies = await q(`select policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='storage' order by 1`);
out.storage_counts = await q(`select bucket_id, count(*)::int n from storage.objects group by 1 order by 1`);
out.indexes = await q(`select tablename t, indexname, indexdef from pg_indexes where schemaname='public' order by 1,2`);
out.policies = await q(`select tablename t, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='public' order by 1,2`);
out.helper_fns = await q(`select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args, p.provolatile, p.prosecdef,
  p.proconfig::text cfg, p.prolang::regproc::text lang from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind='f' and p.proname not like 'safety\\_%' order by 1,2`);
out.counts = {};
for (const r of out.company_tables) out.counts[r.t] = (await q(`select count(*)::int n from public."${r.t}"`))[0].n;
out.companies = (await q("select count(*)::int n from public.companies"))[0].n;
out.users = (await q("select count(*)::int n from auth.users"))[0].n;
out.migrations_seen = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('platform_delete_company','platform_purge_company','work_order_start_visit','visit_close')`);
await c.query("rollback");
await c.end();
console.log(JSON.stringify(out, null, 1));
