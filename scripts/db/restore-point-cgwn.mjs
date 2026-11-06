// نقطة استعادة قراءة فقط لمشروع cgwn قبل أي ترحيل: نسخة JSON من كل جداول public وتعريفات الدوال والسياسات والمشغلات.
// تُحفظ محليًا في .backups/restore-point-<الوقت>/ (مستثناة من git) ولا يُطبع منها شيء.
// الاستخدام: node scripts/db/restore-point-cgwn.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
const q = async (sql) => (await c.query(sql)).rows;
const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') order by 1`)).map((r) => r.relname);
const data = {};
for (const t of tables) data[t] = await q(`select * from public."${t}"`);
data["storage.objects"] = await q(`select bucket_id, name, owner, created_at from storage.objects order by 1, 2`);
data["app_private.device_tokens"] = await q(`select * from app_private.device_tokens`);
data["app_private.ref_counters"] = await q(`select * from app_private.ref_counters`);
const schema = {
  taken_at: new Date().toISOString(),
  functions: await q(`select n.nspname, p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','app_private') and p.prokind = 'f' order by 1, 2`),
  policies: await q(`select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1, 2, 3`),
  triggers: await q(`select tgrelid::regclass::text t, tgname, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal order by 1, 2`),
  columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`),
  buckets: await q(`select * from storage.buckets order by id`),
};
await c.query("rollback");
await c.end();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const dir = path.join(".backups", `restore-point-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(data));
fs.writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
console.log(JSON.stringify({ target: "cgwn…zfr ✓", read_only: true, dir, tables: tables.length,
  rows: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) }, null, 2));
