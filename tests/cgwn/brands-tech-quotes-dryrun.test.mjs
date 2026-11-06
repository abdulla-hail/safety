// تجربة «dry-run» محلية لترحيل 20261111000100 بنفس تحققات apply-cgwn.mjs (scripts/db/migration-checks.mjs) على PGlite،
// فوق بيانات تشبه القاعدة الحية: شركة ومدير وفني بصلاحيات مخصصة وعميل وفرع وجهاز وعرض سعر وإشعار وقناة Realtime.
// يتحقق: لا يتغير أي صف قائم إلا التغيير المعلن (صلاحيات الفني المخصصة)، والتراجع يعيد كل الصفوف والبنية بالضبط.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { runMigrationChecks, expectedChanges } from "../../scripts/db/migration-checks.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION_FILE = "20261111000100_brands_tech_quotes_activity.sql";
const MIGRATION = read("supabase", "migrations", MIGRATION_FILE);
const ROLLBACK = read("supabase", "proposed", "20261111000100_rollback.sql");

async function seeded() {
  const db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => x < MIGRATION_FILE)) {
    await db.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  await db.exec("create publication supabase_realtime");
  const as = (uid, sql, params = []) => db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: uid })]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
  const rpc = async (uid, fn, args) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
  const user = async (email) => (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;

  const owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [owner]);
  const c = await rpc(owner, "platform_create_company", ["شركة قائمة", "manager@a.invalid", null, null, null, 24]);
  const mgr = await user("manager@a.invalid");
  await rpc(mgr, "accept_company_invitation", [c.token]);
  const ids = { co: c.company_id };
  for (const k of ["t1", "t2"]) {
    const inv = await rpc(mgr, "company_invite_member", [ids.co, `${k}@a.invalid`, "technician", `الفني ${k}`, null, null, 24]);
    const uid = await user(`${k}@a.invalid`);
    await rpc(uid, "accept_company_invitation", [inv.token]);
    ids[k] = (await db.query("select id from public.company_memberships where user_id = $1", [uid])).rows[0].id;
  }
  // فني بصلاحيات مخصصة (كما في القاعدة الحية) بوقت تحديث قديم معروف
  await rpc(mgr, "company_set_member_permissions", [ids.t1, ["field.assigned", "visits.view", "devices.view"]]);
  await db.query("update public.company_memberships set updated_at = '2026-10-01 10:00:00+00' where id = $1", [ids.t1]);
  const cust = (await as(mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]))[0].id;
  const site = (await as(mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'فرع') returning id", [ids.co, cust]))[0].id;
  await as(mgr, "insert into public.devices (company_id, customer_id, site_id, name) values ($1, $2, $3, 'لوحة') returning id", [ids.co, cust, site]);
  await as(mgr, "insert into public.quotations (company_id, customer_id, site_id, title) values ($1, $2, $3, 'عرض قائم') returning id", [ids.co, cust, site]);
  return { db, ids };
}

test("التغيير المعلن في الترحيل يُقرأ بدقة", () => {
  assert.deepEqual(expectedChanges(MIGRATION), { company_memberships: ["permissions", "updated_at"] });
});

test("dry-run محلي: كل تحققات apply-cgwn تنجح، والتراجع يعيد الصفوف (بما فيها updated_at) والبنية بالضبط", async () => {
  const { db, ids } = await seeded();
  const before = (await db.query("select id, permissions, updated_at from public.company_memberships order by id")).rows;
  await db.exec("begin");
  const checks = await runMigrationChecks({ q: async (sql, p) => (await db.query(sql, p)).rows, exec: (sql) => db.exec(sql), migration: MIGRATION, rollback: ROLLBACK, dryRun: true });
  await db.exec("rollback");
  const failed = checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  const intended = checks.find((c) => c.name.startsWith("تغيير مقصود في company_memberships"));
  assert.match(intended.detail, /^1 صف تغيّر عمدًا/);
  for (const k of ["policies", "grants", "constraints", "functions", "columns", "triggers", "publication"]) {
    assert.ok(checks.some((c) => c.name === `ملف التراجع يعيد ${k} كما كانت` && c.ok), k);
  }
  assert.deepEqual((await db.query("select id, permissions, updated_at from public.company_memberships order by id")).rows, before);
  assert.ok(ids.t1);
  await db.close();
});

test("التطبيق ثم التراجع خارج dry-run: القيم الأصلية تعود، وتعديل المدير بعد الترحيل لا يُفقد", async () => {
  const { db, ids } = await seeded();
  const orig = (await db.query("select permissions, updated_at from public.company_memberships where id = $1", [ids.t1])).rows[0];
  await db.exec(MIGRATION);
  const mid = (await db.query("select permissions, updated_at from public.company_memberships where id = $1", [ids.t1])).rows[0];
  assert.deepEqual(mid.permissions, [...orig.permissions, "quotes.create"]);
  assert.ok((await db.query("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'")).rows.length);
  // الفني الثاني يأخذ صلاحيات مخصصة بعد الترحيل (تعديل مدير): يبقى تعديله، ويُزال quotes.create فقط
  await db.query("update public.company_memberships set permissions = array['field.assigned', 'quotes.create', 'faults.view'] where id = $1", [ids.t2]);
  await db.exec(ROLLBACK);
  const back = (await db.query("select permissions, updated_at from public.company_memberships where id = $1", [ids.t1])).rows[0];
  assert.deepEqual(back, orig);
  assert.deepEqual((await db.query("select permissions from public.company_memberships where id = $1", [ids.t2])).rows[0].permissions, ["field.assigned", "faults.view"]);
  assert.equal((await db.query("select to_regclass('app_private.migration_0111_memberships') t")).rows[0].t, null);
  assert.equal((await db.query("select tgenabled from pg_trigger where tgname = 'company_memberships_touch'")).rows[0].tgenabled, "O");
  assert.equal((await db.query("select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'")).rows[0].n, 0);
  await db.close();
});
