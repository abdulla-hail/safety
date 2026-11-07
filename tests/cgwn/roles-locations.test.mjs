// اختبار ترحيل 20261112000100 على PGlite فوق كل الترحيلات السابقة: دوران فقط (مدير/فني)، حماية المدير الأساسي،
// المديرون الإضافيون وصلاحياتهم، صلاحية إدارة الفريق، تحويل الدعوات القديمة، نص الموقع، والتراجع (مع dry-run بنفس تحققات التطبيق الحي).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { runMigrationChecks, expectedChanges } from "../../scripts/db/migration-checks.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION_FILE = "20261112000100_roles_locations.sql";
const MIGRATION = read("supabase", "migrations", MIGRATION_FILE);
const ROLLBACK = read("supabase", "proposed", "20261112000100_rollback.sql");

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => x < MIGRATION_FILE)) {
    await d.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  return d;
}
function helpers(db) {
  const as = (uid, sql, params = []) => db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: uid ? "authenticated" : "anon", sub: uid ?? "" })]);
    await tx.exec(uid ? "set local role authenticated" : "set local role anon");
    return (await tx.query(sql, params)).rows;
  });
  const rpc = async (uid, fn, args = []) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
  const user = async (email) => (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  return { as, rpc, user, one };
}
async function code(p) { try { await p; return null; } catch (e) { return e.code ?? e.message; } }

/** شركة قائمة قبل الترحيل: مدير أساسي، فني بصلاحيات مخصصة، ودعوة معلّقة بدور «مشرف» (دور قديم) */
async function seeded() {
  const db = await base();
  const h = helpers(db);
  const u = {}, ids = {};
  u.owner = await h.user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const c = await h.rpc(u.owner, "platform_create_company", ["شركة أ", "p@a.invalid", null, null, null, 24]);
  ids.co = c.company_id;
  u.P = await h.user("p@a.invalid");
  await h.rpc(u.P, "accept_company_invitation", [c.token]);
  const inv = await h.rpc(u.P, "company_invite_member", [ids.co, "t1@a.invalid", "technician", "الفني 1", null, null, 24]);
  u.T1 = await h.user("t1@a.invalid");
  await h.rpc(u.T1, "accept_company_invitation", [inv.token]);
  ids.mT1 = (await h.one("select id from public.company_memberships where user_id = $1", [u.T1])).id;
  await h.rpc(u.P, "company_set_member_permissions", [ids.mT1, ["field.assigned", "visits.view", "devices.view"]]);
  const sup = await h.rpc(u.P, "company_invite_member", [ids.co, "sup@a.invalid", "supervisor", "مشرف قديم", null, null, 24]);
  ids.supInv = sup.invitation_id; ids.supToken = sup.token;
  ids.mP = (await h.one("select id from public.company_memberships where user_id = $1", [u.P])).id;
  return { db, h, u, ids };
}

let S;
before(async () => {
  S = await seeded();
  await S.db.exec(MIGRATION);
});

test("الترحيل يعلن تغييره المقصود بدقة", () => {
  assert.deepEqual(expectedChanges(MIGRATION), { company_invitations: ["role", "permissions"] });
});

test("الدعوة المعلّقة بدور قديم أصبحت «مدير» بنفس صلاحياتها، والعضويات القائمة لم تتغير", async () => {
  const { h, ids, u } = S;
  const i = await h.one("select role, permissions from public.company_invitations where id = $1", [ids.supInv]);
  assert.equal(i.role, "company_manager");
  const sup = (await S.db.query("select permission_key from public.company_role_permissions where role = 'supervisor' order by 1")).rows.map((r) => r.permission_key);
  assert.deepEqual(i.permissions, sup);
  assert.deepEqual((await h.one("select permissions from public.company_memberships where id = $1", [ids.mT1])).permissions, ["field.assigned", "visits.view", "devices.view"]);
  // قبولها: عضوية «مدير» غير أساسي بالصلاحيات نفسها (دون إدارة الفريق)
  u.SUP = await h.user("sup@a.invalid");
  await h.rpc(u.SUP, "accept_company_invitation", [ids.supToken]);
  const m = await h.one("select role, is_primary, permissions from public.company_memberships where user_id = $1", [u.SUP]);
  assert.equal(m.role, "company_manager");
  assert.equal(m.is_primary, false);
  assert.deepEqual(m.permissions, sup);
  const eff = await h.as(u.SUP, "select public.company_has_perm($1, 'team.manage') t, public.company_has_perm($1, 'visits.create') v", [ids.co]);
  assert.deepEqual(eff[0], { t: false, v: true });
});

test("الأدوار المتاحة مدير أو فني فقط، ودعوة المدير للمدير الأساسي وحده", async () => {
  const { h, ids, u } = S;
  for (const role of ["supervisor", "accountant", "storekeeper"]) {
    assert.equal(await code(h.rpc(u.P, "company_invite_member", [ids.co, `${role}@a.invalid`, role, null, null, null, 24])), "22023");
  }
  const mi = await h.rpc(u.P, "company_invite_member", [ids.co, "m2@a.invalid", "company_manager", "المدير الثاني", null, null, 24]);
  u.M2 = await h.user("m2@a.invalid");
  await h.rpc(u.M2, "accept_company_invitation", [mi.token]);
  const m2 = await h.one("select id, role, is_primary, permissions from public.company_memberships where user_id = $1", [u.M2]);
  ids.mM2 = m2.id;
  assert.equal(m2.role, "company_manager");
  assert.equal(m2.is_primary, false);
  assert.equal(m2.permissions, null);
  // مدير إضافي بكل الصلاحيات افتراضيًا: يدير الفنيين
  assert.equal((await h.as(u.M2, "select public.company_has_perm($1, 'team.manage') t", [ids.co]))[0].t, true);
  const ti = await h.rpc(u.M2, "company_invite_member", [ids.co, "t2@a.invalid", "technician", "الفني 2", null, null, 24]);
  assert.ok(ti.token);
  // لكنه لا يدعو مديرًا
  assert.equal(await code(h.rpc(u.M2, "company_invite_member", [ids.co, "m3@a.invalid", "company_manager", null, null, null, 24])), "42501");
});

test("المدير الأساسي محمي من أي مدير آخر، ولا يُعدَّل من إدارة الفريق", async () => {
  const { h, ids, u } = S;
  assert.equal(await code(h.rpc(u.M2, "company_set_member_status", [ids.mP, "suspended"])), "42501");
  assert.equal(await code(h.rpc(u.M2, "company_set_member_status", [ids.mP, "removed"])), "42501");
  assert.equal(await code(h.rpc(u.M2, "company_set_member_role", [ids.mP, "technician"])), "42501");
  assert.equal(await code(h.rpc(u.M2, "company_set_member_permissions", [ids.mP, ["visits.view"]])), "P0001");
  assert.equal(await code(h.rpc(u.M2, "company_update_member", [ids.mP, "تغيير", null, null])), "42501");
  assert.equal(await code(h.rpc(u.P, "company_set_member_status", [ids.mP, "suspended"])), "42501");
  // مدير غير أساسي لا يدير مديرًا آخر ولا نفسه
  const mSup = (await h.one("select id from public.company_memberships where user_id = $1", [u.SUP])).id;
  assert.equal(await code(h.rpc(u.M2, "company_set_member_status", [mSup, "suspended"])), "42501");
  assert.equal(await code(h.rpc(u.M2, "company_set_member_permissions", [ids.mM2, null])), "42501");
  const p = await h.one("select role, status, is_primary, permissions from public.company_memberships where id = $1", [ids.mP]);
  assert.deepEqual(p, { role: "company_manager", status: "active", is_primary: true, permissions: null });
});

test("المدير الأساسي يحدد صلاحيات مدير آخر، ومن لا يملك team.manage لا يدير الفريق", async () => {
  const { h, ids, u } = S;
  await h.rpc(u.P, "company_set_member_permissions", [ids.mM2, ["customers.view", "visits.view", "visits.create"]]);
  assert.equal((await h.as(u.M2, "select public.company_has_perm($1, 'team.manage') t", [ids.co]))[0].t, false);
  assert.equal(await code(h.rpc(u.M2, "company_invite_member", [ids.co, "t3@a.invalid", "technician", null, null, null, 24])), "42501");
  assert.equal(await code(h.rpc(u.M2, "company_set_member_status", [ids.mT1, "suspended"])), "42501");
  assert.equal((await h.as(u.M2, "select count(*)::int n from public.company_invitations where company_id = $1", [ids.co]))[0].n, 0);
  // يعيده إلى كل الصلاحيات
  await h.rpc(u.P, "company_set_member_permissions", [ids.mM2, null]);
  assert.equal((await h.as(u.M2, "select public.company_has_perm($1, 'team.manage') t", [ids.co]))[0].t, true);
  assert.ok((await h.as(u.M2, "select count(*)::int n from public.company_invitations where company_id = $1", [ids.co]))[0].n > 0);
});

test("الفني بلا صلاحيات إدارة أبدًا، ولا يمنح مدير غير أساسي ما لا يملكه", async () => {
  const { h, ids, u } = S;
  assert.equal(await code(h.rpc(u.P, "company_set_member_permissions", [ids.mT1, ["field.assigned", "team.manage"]])), "22023");
  assert.equal(await code(h.rpc(u.P, "company_set_member_permissions", [ids.mT1, ["field.assigned", "settings.branding"]])), "22023");
  // حتى لو وُجدت في بيانات قديمة لا تُحسب للفني
  await S.db.query("update public.company_memberships set permissions = array['field.assigned', 'audit.view', 'team.manage'] where id = $1", [ids.mT1]);
  const eff = await h.as(u.T1, "select public.company_has_perm($1, 'audit.view') a, public.company_has_perm($1, 'team.manage') t, public.company_has_perm($1, 'field.assigned') f", [ids.co]);
  assert.deepEqual(eff[0], { a: false, t: false, f: true });
  assert.equal((await h.as(u.T1, "select count(*)::int n from public.company_audit_log where company_id = $1", [ids.co]))[0].n, 0);
  assert.ok((await h.as(u.P, "select count(*)::int n from public.company_audit_log where company_id = $1", [ids.co]))[0].n > 0);
  await S.db.query("update public.company_memberships set permissions = array['field.assigned', 'visits.view', 'devices.view'] where id = $1", [ids.mT1]);
  // مدير غير أساسي بصلاحيات محدودة لا يمنح صلاحية لا يملكها
  await h.rpc(u.P, "company_set_member_permissions", [ids.mM2, ["team.manage", "visits.view", "field.assigned"].filter((k) => k !== "field.assigned")]);
  assert.equal(await code(h.rpc(u.M2, "company_set_member_permissions", [ids.mT1, ["field.assigned", "customers.delete"]])), "42501");
  await h.rpc(u.M2, "company_set_member_permissions", [ids.mT1, ["visits.view"]]);
  await h.rpc(u.P, "company_set_member_permissions", [ids.mM2, null]);
});

test("الترقية والتخفيض للمدير الأساسي فقط، وتعيد الصلاحيات لافتراضيات الدور", async () => {
  const { h, ids, u } = S;
  assert.equal(await code(h.rpc(u.M2, "company_set_member_role", [ids.mT1, "company_manager"])), "42501");
  assert.equal(await code(h.rpc(u.P, "company_set_member_role", [ids.mT1, "supervisor"])), "22023");
  await h.rpc(u.P, "company_set_member_role", [ids.mT1, "company_manager"]);
  let t = await h.one("select role, permissions from public.company_memberships where id = $1", [ids.mT1]);
  assert.deepEqual(t, { role: "company_manager", permissions: null });
  await h.rpc(u.P, "company_set_member_role", [ids.mT1, "technician"]);
  t = await h.one("select role, permissions from public.company_memberships where id = $1", [ids.mT1]);
  assert.deepEqual(t, { role: "technician", permissions: null });
  assert.equal((await h.as(u.T1, "select public.company_has_perm($1, 'field.assigned') f", [ids.co]))[0].f, true);
});

test("نقل الإدارة: المدير الأساسي السابق يبقى مديرًا بكل الصلاحيات", async () => {
  const { h, ids, u } = S;
  const tr = await h.rpc(u.P, "company_transfer_management", [ids.co, "newp@a.invalid", 24]);
  u.NP = await h.user("newp@a.invalid");
  await h.rpc(u.NP, "accept_company_invitation", [tr.token]);
  const old = await h.one("select role, is_primary, permissions from public.company_memberships where id = $1", [ids.mP]);
  assert.deepEqual(old, { role: "company_manager", is_primary: false, permissions: null });
  const np = await h.one("select role, is_primary from public.company_memberships where user_id = $1", [u.NP]);
  assert.deepEqual(np, { role: "company_manager", is_primary: true });
  assert.equal((await h.as(u.P, "select public.company_has_perm($1, 'customers.delete') d", [ids.co]))[0].d, true);
  // والأساسي الجديد محمي من السابق
  const mNP = (await h.one("select id from public.company_memberships where user_id = $1", [u.NP])).id;
  assert.equal(await code(h.rpc(u.P, "company_set_member_status", [mNP, "suspended"])), "42501");
});

test("نص الموقع يُحفظ كما هو، والإحداثيات مستقلة عنه", async () => {
  const { h, ids, u } = S;
  const cust = (await h.as(u.NP, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]))[0].id;
  const raw = "8056-7958 الهفوف، النسيم الشرقي، الرياض 14243";
  const s = (await h.as(u.NP, "insert into public.customer_sites (company_id, customer_id, name, location_text) values ($1, $2, 'فرع', $3) returning location_text, latitude", [ids.co, cust, raw]))[0];
  assert.deepEqual(s, { location_text: raw, latitude: null });
  assert.equal(await code(h.as(u.NP, "insert into public.customer_sites (company_id, customer_id, name, location_text) values ($1, $2, 'فرع2', $3)", [ids.co, cust, "x".repeat(2001)])), "23514");
});

test("التراجع يرفض مع بيانات الترحيل، وينجح على قاعدة بلا بيانات", async () => {
  assert.match(String(await code(S.db.exec(ROLLBACK))), /P0001|التراجع مرفوض/);
});

test("dry-run محلي بنفس تحققات apply-cgwn: كل الفحوص تنجح والتراجع يعيد الدعوة والبنية كما كانت", async () => {
  const { db, ids } = await seeded();
  const before = await db.query("select role, permissions from public.company_invitations where id = $1", [ids.supInv]);
  await db.exec("create publication supabase_realtime; alter publication supabase_realtime add table public.notifications;");
  await db.exec("begin");
  const checks = await runMigrationChecks({ q: async (sql, p) => (await db.query(sql, p)).rows, exec: (sql) => db.exec(sql), migration: MIGRATION, rollback: ROLLBACK, dryRun: true });
  await db.exec("rollback");
  const failed = checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  assert.match(checks.find((c) => c.name.startsWith("تغيير مقصود في company_invitations")).detail, /^1 صف تغيّر عمدًا/);
  // خارج dry-run: تطبيق ثم تراجع يعيد الدعوة كما كانت
  await db.exec(MIGRATION);
  await db.exec(ROLLBACK);
  assert.deepEqual((await db.query("select role, permissions from public.company_invitations where id = $1", [ids.supInv])).rows, before.rows);
  assert.equal((await db.query("select to_regprocedure('app_private.can_manage_team(uuid)') p")).rows[0].p, null);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name = 'customer_sites' and column_name = 'location_text'")).rows[0].n, 0);
  await db.close();
});
