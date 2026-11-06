// تطبيق آمن لترحيل على مشروع cgwn فقط: معاملة واحدة + تحققات إلزامية قبل الالتزام.
// الاستخدام:
//   node scripts/db/apply-cgwn.mjs <migration.sql> <rollback.sql> --dry-run   (تطبيق + تحقق + تجربة التراجع + ROLLBACK)
//   node scripts/db/apply-cgwn.mjs <migration.sql> <rollback.sql> --apply     (COMMIT فقط إذا نجحت كل التحققات)
// التحققات نفسها في migration-checks.mjs، وتُختبر محليًا على PGlite (tests/cgwn/*-dryrun.test.mjs).
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";
import { runMigrationChecks } from "./migration-checks.mjs";

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

let committed = false;
try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  await c.query("set local statement_timeout = '120s'");
  const checks = await runMigrationChecks({ q, exec: (sql) => c.query(sql), migration: MIGRATION, rollback: ROLLBACK, dryRun: mode === "dry-run" });

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
