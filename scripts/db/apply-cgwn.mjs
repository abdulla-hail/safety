// تطبيق آمن لترحيل على مشروع cgwn فقط: معاملة واحدة + تحققات إلزامية قبل الالتزام.
// الاستخدام:
//   node scripts/db/apply-cgwn.mjs <migration.sql> <rollback.sql> --dry-run   (تطبيق + تحقق + تجربة التراجع + ROLLBACK)
//   node scripts/db/apply-cgwn.mjs <migration.sql> <rollback.sql> --apply     (COMMIT فقط إذا نجحت كل التحققات)
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const [migrationPath, rollbackPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : null;
if (!mode || !migrationPath || !rollbackPath) { console.error("الاستخدام: apply-cgwn.mjs <migration> <rollback> --dry-run|--apply"); process.exit(1); }
const MIGRATION = fs.readFileSync(migrationPath, "utf8");
const ROLLBACK = fs.readFileSync(rollbackPath, "utf8");

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });

/**
 * بصمة الصفوف التي كانت موجودة قبل الترحيل، على أعمدتها الأصلية فقط.
 * الصفوف الجديدة (مثل قيود سجل التدقيق) والأعمدة المضافة لا تُحسب؛ تُعد الصفوف الجديدة منفصلة.
 */
// مفتاح الصف: المفتاح الأساسي الفعلي للجدول (id أو غيره، مركبًا أو مفردًا)، فتُميَّز الصفوف القائمة عن الجديدة
const pkCache = {};
async function pkExpr(t) {
  if (!(t in pkCache)) {
    const cols = (await q(`select a.attname c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      where i.indrelid = ('public."' || $1 || '"')::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`, [t])).map((r) => r.c);
    pkCache[t] = cols.length ? `jsonb_build_array(${cols.map((c) => `"${c}"`).join(", ")})::text` : null;
  }
  return pkCache[t];
}
async function dataPrint(tables, columnsBefore, idsBefore) {
  const out = {};
  for (const t of tables) {
    const cols = columnsBefore[t];
    const pk = await pkExpr(t);
    const filter = pk && idsBefore?.[t] ? `where ${pk} = any($1)` : "";
    const r = (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h
      from (select jsonb_build_object(${cols.map((col) => `'${col}', "${col}"`).join(", ")}) x from public."${t}" ${filter}) s`,
      filter ? [idsBefore[t]] : undefined))[0];
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
}
async function ids(tables) {
  const out = {};
  for (const t of tables) {
    const pk = await pkExpr(t);
    if (pk) out[t] = (await q(`select ${pk} i from public."${t}"`)).map((r) => r.i);
  }
  return out;
}
async function structure() {
  return {
    policies: await q(`select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3`),
    grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3`),
    constraints: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1,2`),
    functions: await q(`select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by 1,2`),
    columns: await q(`select table_name, column_name, udt_name from information_schema.columns where table_schema='public' order by 1,2`),
  };
}

let committed = false;
try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  await c.query("set local statement_timeout = '120s'");
  const existing = (await q(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).map((r) => r.relname);
  const columnsBefore = {};
  for (const t of existing) columnsBefore[t] = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map((r) => r.column_name);
  const idsBefore = await ids(existing);
  const before = await dataPrint(existing, columnsBefore, idsBefore);
  const beforeStructure = await structure();

  await c.query(MIGRATION);

  const after = await dataPrint(existing, columnsBefore, idsBefore);
  for (const t of existing) {
    const added = idsBefore[t] ? (await q(`select count(*)::int n from public."${t}"`))[0].n - idsBefore[t].length : 0;
    check(`الصفوف القائمة في ${t} لم تتغير`, after[t] === before[t], `${before[t].split(":")[0]} صف قائم${added ? ` · ${added} صف جديد` : ""}`);
  }
  const created = (await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`)).filter((r) => !existing.includes(r.relname));
  check("RLS مفعّل على كل جدول جديد", created.every((r) => r.relrowsecurity), created.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(","));
  const anon = await q(`select distinct table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name = any($1)`, [created.map((r) => r.relname)]);
  check("لا صلاحيات لـ anon على الجداول الجديدة", anon.length === 0, anon.map((r) => r.table_name).join(","));
  const writes = await q(`select table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')`);
  check("لا TRUNCATE/REFERENCES/TRIGGER للواجهة", writes.length === 0, JSON.stringify(writes.slice(0, 5)));
  const noPath = await q(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app_private') and p.prosecdef and not coalesce(p.proconfig::text, '') like '%search_path%'`);
  check("كل دوال SECURITY DEFINER بمسار بحث محدد", noPath.length === 0, noPath.map((r) => r.f).join(","));
  const anonFns = await q(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname = 'app_private' and has_function_privilege('anon', p.oid, 'execute')`);
  check("لا دوال app_private قابلة للاستدعاء من anon", anonFns.length === 0, anonFns.map((r) => r.f).join(","));
  const internal = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
    and p.proname in ('next_ref','run_maintenance_alerts_for','run_all_maintenance_alerts','notify','seed_default_catalog')
    and has_function_privilege('authenticated', p.oid, 'execute')`);
  check("الدوال الداخلية الحساسة غير قابلة للاستدعاء من المسجلين", internal.length === 0, internal.map((r) => r.proname).join(","));
  const safety = await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'safety\\_%'`);
  check("دوال safety_* لم تُحذف", safety[0].n === beforeStructure.functions.filter((f) => f.nspname === "public" && f.proname.startsWith("safety_")).length);

  if (mode === "dry-run") {
    await c.query(ROLLBACK);
    check("ملف التراجع يعيد الصفوف القائمة كما كانت", JSON.stringify(await dataPrint(existing, columnsBefore, idsBefore)) === JSON.stringify(before));
    const restored = await structure();
    for (const k of Object.keys(beforeStructure)) {
      check(`ملف التراجع يعيد ${k} كما كانت`, JSON.stringify(restored[k]) === JSON.stringify(beforeStructure[k]));
    }
  }

  const failed = checks.filter((x) => !x.ok);
  if (mode === "apply" && failed.length === 0) { await c.query("commit"); committed = true; } else { await c.query("rollback"); }
  console.log(JSON.stringify({ mode, committed, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log(JSON.stringify({ mode, committed: false, error: e.code ?? "", message: e.message, where: e.where ?? "" }, null, 2));
  process.exitCode = 2;
} finally {
  await c.end();
}
