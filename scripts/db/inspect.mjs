// فحص بنية قاعدة البيانات (قراءة فقط): الجداول، الأعمدة، القيود، السياسات، الدوال، الحاويات.
// لا يطبع أي بيانات شخصية، فقط أعداد الصفوف.
import pg from "pg";
import { pgConfig } from "./env.mjs";

const client = new pg.Client(pgConfig());
await client.connect();
await client.query("set default_transaction_read_only = on");

const q = async (sql, params) => (await client.query(sql, params)).rows;

const tables = await q(`
  select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1`);
for (const t of tables) {
  const [{ count }] = await q(`select count(*)::int as count from public."${t.table}"`);
  console.log(`\n## TABLE ${t.table} rls=${t.rls} rows=${count}`);
  const cols = await q(`
    select column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns where table_schema='public' and table_name=$1
    order by ordinal_position`, [t.table]);
  for (const c of cols) {
    console.log(`  ${c.column_name} ${c.udt_name}${c.is_nullable === "NO" ? " not null" : ""}${c.column_default ? " default " + c.column_default : ""}`);
  }
  const cons = await q(`
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = ('public."' || $1 || '"')::regclass order by conname`, [t.table]);
  for (const c of cons) console.log(`  CONSTRAINT ${c.conname}: ${c.def}`);
  const pols = await q(`
    select policyname, cmd, roles::text, qual, with_check from pg_policies
    where schemaname='public' and tablename=$1`, [t.table]);
  for (const p of pols) console.log(`  POLICY ${p.policyname} [${p.cmd}] ${p.roles} USING(${p.qual ?? ""}) CHECK(${p.with_check ?? ""})`);
  const trg = await q(`
    select tgname, pg_get_triggerdef(oid) as def from pg_trigger
    where tgrelid = ('public."' || $1 || '"')::regclass and not tgisinternal`, [t.table]);
  for (const g of trg) console.log(`  TRIGGER ${g.def}`);
  const grants = await q(`
    select grantee, string_agg(privilege_type, ',') as privs from information_schema.role_table_grants
    where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated') group by grantee`, [t.table]);
  for (const g of grants) console.log(`  GRANT ${g.grantee}: ${g.privs}`);
}

console.log("\n## ENUM TYPES");
for (const e of await q(`
  select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' group by t.typname`)) console.log(`  ${e.typname}: ${e.labels}`);

console.log("\n## FUNCTIONS (public)");
for (const f of await q(`
  select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as secdef,
         pg_get_function_result(p.oid) as result, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' order by 1`)) {
  console.log(`\n### ${f.proname}(${f.args}) -> ${f.result} secdef=${f.secdef}\n${f.def}`);
}

console.log("\n## SCHEMAS");
for (const s of await q(`select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`)) console.log("  " + s.nspname);

console.log("\n## EXTENSIONS");
for (const e of await q(`select extname, extversion from pg_extension order by 1`)) console.log(`  ${e.extname} ${e.extversion}`);

console.log("\n## STORAGE BUCKETS");
try {
  for (const b of await q(`select id, public, file_size_limit from storage.buckets`)) console.log(`  ${b.id} public=${b.public} limit=${b.file_size_limit}`);
  for (const p of await q(`select policyname, cmd, qual, with_check from pg_policies where schemaname='storage'`)) console.log(`  POLICY ${p.policyname} [${p.cmd}] ${p.qual ?? ""} ${p.with_check ?? ""}`);
} catch (e) { console.log("  (storage unavailable) " + e.message); }

console.log("\n## AUTH");
const [{ users }] = await q(`select count(*)::int as users from auth.users`);
console.log(`  auth.users count=${users}`);
for (const r of await q(`select coalesce(raw_app_meta_data->>'provider','?') as provider, count(*)::int as n from auth.users group by 1`)) console.log(`  provider ${r.provider}: ${r.n}`);
for (const r of await q(`select status, role, count(*)::int as n from public.organization_members group by 1,2`).catch(() => [])) console.log(`  members status=${r.status} role=${r.role}: ${r.n}`);
for (const r of await q(`select status, count(*)::int as n from public.organizations group by 1`).catch(() => [])) console.log(`  orgs status=${r.status}: ${r.n}`);

await client.end();
