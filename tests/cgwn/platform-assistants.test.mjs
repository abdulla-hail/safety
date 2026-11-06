// اختبار ترحيل 20261030000100: طلب مساعد المالك ومراجعته وصلاحياته المحددة، والفصل عن الشركات، والتراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261030000100_platform_assistants.sql"];
const ROLLBACK = ["supabase", "proposed", "20261030000100_rollback.sql"];
let db;
const u = {};
let company;

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of ["20261027000100_companies_memberships_invitations.sql", "20261028000100_operations_permissions_branding.sql",
    "20261029000100_device_images_technician_members.sql"]) await d.exec(read("supabase", "migrations", f));
  return d;
}
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.exec(uid ? "set local role authenticated" : "set local role anon");
    return (await tx.query(sql, params)).rows;
  });
}
const rpc = async (uid, fn, args = []) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
async function code(p) { try { await p; return null; } catch (e) { return e.code ?? e.message; } }
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
}

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const c = await rpc(u.owner, "platform_create_company", ["شركة أ", "manager@a.invalid", null, null, null, 24]);
  u.mgr = await user("manager@a.invalid");
  await rpc(u.mgr, "accept_company_invitation", [c.token]);
  company = c.company_id;
  await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل سري')", [company]);
  u.asst = await user("asst@ays.invalid");
  u.other = await user("other@ays.invalid");
});

test("الطلب لا يمنح أي صلاحية، ولا يكرر، والمدير/العضو لا يطلب", async () => {
  const id = await rpc(u.asst, "platform_request_assistant", ["مساعد", "أرغب بالمساعدة"]);
  assert.ok(id);
  assert.match(await code(rpc(u.asst, "platform_request_assistant", ["مساعد", null])), /23505/);
  assert.equal(await rpc(u.asst, "platform_has_perm", ["platform.companies.view"]), false);
  assert.equal((await as(u.asst, "select id from public.companies")).length, 0);
  assert.match(await code(rpc(u.mgr, "platform_request_assistant", [null, null])), /P0001/);
  // المالك يُشعَر
  assert.equal((await as(u.owner, "select id from public.notifications where kind = 'assistant_request'")).length, 1);
  u.req = id;
});

test("المراجعة للمالك الأساسي فقط، والقبول بصلاحيات محددة", async () => {
  assert.match(await code(rpc(u.other, "platform_review_assistant_request", [u.req, true, ["platform.companies.view"], null])), /42501/);
  assert.match(await code(rpc(u.owner, "platform_review_assistant_request", [u.req, true, ["bad.perm"], null])), /22023/);
  assert.match(await code(rpc(u.owner, "platform_review_assistant_request", [u.req, true, [], null])), /22023/);
  await rpc(u.owner, "platform_review_assistant_request", [u.req, true, ["platform.companies.view", "platform.companies.create"], "مرحبًا"]);
  assert.match(await code(rpc(u.owner, "platform_review_assistant_request", [u.req, false, null, null])), /P0001/);
  const ctx = await rpc(u.asst, "get_my_context");
  assert.equal(ctx.platform_role, "assistant");
  assert.equal(ctx.is_platform_admin, false);
  assert.deepEqual(ctx.platform_permissions, ["platform.companies.create", "platform.companies.view"]);
  assert.equal((await rpc(u.owner, "get_my_context")).platform_role, "owner");
});

test("المساعد يعمل بصلاحياته فقط ولا يرى البيانات التشغيلية", async () => {
  assert.equal((await as(u.asst, "select id from public.companies where id = $1", [company])).length, 1);
  assert.ok((await as(u.asst, "select id from public.company_memberships where company_id = $1", [company])).length >= 1);
  assert.equal((await as(u.asst, "select id from public.customers")).length, 0);
  assert.equal((await as(u.asst, "select id from public.safety_systems")).length, 0);
  const c2 = await rpc(u.asst, "platform_create_company", ["شركة ب", "manager@b.invalid", null, null, null, 24]);
  assert.match(c2.ref_no, /^ORG-/);
  assert.match(await code(rpc(u.asst, "platform_update_company", [company, "اسم جديد", null, null, null])), /42501/);
  assert.match(await code(rpc(u.asst, "platform_set_company_status", [company, "suspended"])), /42501/);
  assert.match(await code(rpc(u.asst, "platform_invite_manager", [company, "x@y.invalid", 24])), /42501/);
  assert.match(await code(rpc(u.asst, "platform_delete_company", [company, "x"])), /42501/);
  // لا يدير المساعدين ولا يرى طلبات غيره
  assert.match(await code(rpc(u.asst, "platform_update_assistant", [u.asst, ["platform.companies.delete"], "active"])), /42501/);
  assert.match(await code(rpc(u.asst, "platform_create_company", ["شركة ج", "owner@ays.invalid", null, null, null, 24])), /22023/);
  assert.match(await code(rpc(u.owner, "platform_create_company", ["شركة د", "asst@ays.invalid", null, null, null, 24])), /22023/);
});

test("المالك يعدّل الصلاحيات ويعطّل ويلغي دون حذف السجل", async () => {
  await rpc(u.owner, "platform_update_assistant", [u.asst, ["platform.companies.view", "platform.companies.status"], "active"]);
  await rpc(u.asst, "platform_set_company_status", [company, "suspended"]);
  await rpc(u.owner, "platform_set_company_status", [company, "active"]);
  await rpc(u.owner, "platform_update_assistant", [u.asst, null, "suspended"]);
  assert.equal(await rpc(u.asst, "platform_has_perm", ["platform.companies.view"]), false);
  assert.equal((await as(u.asst, "select id from public.companies")).length, 0);
  assert.equal((await rpc(u.asst, "get_my_context")).platform_role, null);
  await rpc(u.owner, "platform_update_assistant", [u.asst, null, "revoked"]);
  assert.equal((await db.query("select status from public.platform_assistants where user_id = $1", [u.asst])).rows[0].status, "revoked");
  await rpc(u.owner, "platform_update_assistant", [u.asst, null, "active"]);
  assert.equal(await rpc(u.asst, "platform_has_perm", ["platform.companies.view"]), true);
});

test("الفصل: المساعد النشط لا يقبل دعوة شركة", async () => {
  const inv = await rpc(u.mgr, "company_invite_member", [company, "asst@ays.invalid", "supervisor", null, null, null, 24]);
  assert.match(await code(rpc(u.asst, "accept_company_invitation", [inv.token])), /42501/);
});

test("التراجع يعيد البنية كما كانت، ويُرفض بوجود طلبات", async () => {
  const fresh = await base();
  const snap = async (d) => ({
    columns: (await d.query(`select table_name, column_name from information_schema.columns where table_schema='public' order by 1,2`)).rows,
    policies: (await d.query(`select tablename, policyname, qual from pg_policies order by 1,2`)).rows,
    functions: (await d.query(`select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1,2`)).rows,
    triggers: (await d.query(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal order by 1,2`)).rows,
  });
  const before = await snap(fresh);
  await fresh.exec(read(...MIGRATION));
  await fresh.exec(read(...ROLLBACK));
  assert.deepEqual(await snap(fresh), before);
  await assert.rejects(db.exec(read(...ROLLBACK)), /التراجع مرفوض/);
});
