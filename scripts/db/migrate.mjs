// تطبيق ترحيلات supabase/migrations بالترتيب، كل ملف داخل معاملة مستقلة.
// يسجّل ما طُبّق في app_private.applied_migrations ولا يعيد تطبيقه.
// الاستخدام: node scripts/db/migrate.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pgConfig } from "./env.mjs";

const dryRun = process.argv.includes("--dry-run");
const dir = path.resolve(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

// مشروع cgwn تُطبَّق ترحيلاته بسكربت مخصص يتحقق قبل الالتزام؛ هذا السكربت العام لا يعرف ما طُبّق عليه
if (decodeURIComponent(new URL(pgConfig().connectionString).username).endsWith(".cgwnusudjhhxkwnqjzfr")) {
  console.error("مرفوض: ترحيلات مشروع cgwn تُطبَّق عبر scripts/db/apply-cgwn-invitations.mjs (طُبّق 20261027000100 في 2026-10-27).");
  process.exit(1);
}

const client = new pg.Client(pgConfig());
await client.connect();
await client.query(`
  create schema if not exists app_private;
  create table if not exists app_private.applied_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
const applied = new Set((await client.query("select name from app_private.applied_migrations")).rows.map((r) => r.name));

for (const f of files) {
  if (applied.has(f)) {
    console.log(`= ${f} (مطبّق مسبقًا)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    if (dryRun) {
      await client.query("rollback");
      console.log(`~ ${f} (تجربة ناجحة، تم التراجع)`);
    } else {
      await client.query("insert into app_private.applied_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`+ ${f}`);
    }
  } catch (e) {
    await client.query("rollback");
    console.error(`! ${f}: ${e.message}`);
    process.exitCode = 1;
    break;
  }
}
// تحديث ذاكرة PostgREST لتظهر الجداول والدوال الجديدة
if (!dryRun && process.exitCode !== 1) await client.query("notify pgrst, 'reload schema'");
await client.end();
