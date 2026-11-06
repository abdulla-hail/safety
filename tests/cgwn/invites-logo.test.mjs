// اختبار ترحيل 20261031000100: صفحة الدعوة بهوية الشركة، شعار المنصة بصلاحية مستقلة، دعوات مساعد المالك، والتراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261031000100_invite_branding_platform_logo_assistant_invites.sql"];
const ROLLBACK = ["supabase", "proposed", "20261031000100_rollback.sql"];
let db;
const u = {};
let company;

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  await d.exec("grant select on storage.objects to anon");
  for (const f of ["20261027000100_companies_memberships_invitations.sql", "20261028000100_operations_permissions_branding.sql",
    "20261029000100_device_images_technician_members.sql", "20261030000100_platform_assistants.sql"]) await d.exec(read("supabase", "migrations", f));
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
  await db.query("update public.companies set logo_path = $1, primary_color = '#aa0000' where id = $2", [`${company}/logo-1-a.png`, company]);
  await db.query("insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${company}/logo-1-a.png`]);
  await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل سري')", [company]);
  u.stranger = await user("stranger@x.invalid");
});

test("صفحة الدعوة: بلا رمز صالح لا شيء، وبرمز صالح هوية الشركة وتفاصيل الدعوة فقط", async () => {
  assert.deepEqual(await rpc(null, "invitation_landing", ["bad"]), { status: "invalid" });
  assert.deepEqual(await rpc(null, "invitation_landing", ["A".repeat(40)]), { status: "invalid" });
  // الشعار غير متاح لزائر قبل وجود دعوة سارية
  assert.equal((await as(null, "select name from storage.objects where bucket_id = 'org-branding'")).length, 0);
  const inv = await rpc(u.mgr, "company_invite_member", [company, "tech@a.invalid", "technician", "فني", "فني إنذار", "alarm", 24]);
  await rpc(u.mgr, "company_set_invitation_permissions", [inv.invitation_id, ["field.assigned", "maintenance.create"]]);
  const p = await rpc(null, "invitation_landing", [inv.token]);
  assert.equal(p.status, "pending");
  assert.equal(p.company_name, "شركة أ");
  assert.equal(p.primary_color, "#aa0000");
  assert.deepEqual(p.permissions, ["field.assigned", "maintenance.create"]);
  assert.equal(p.signed_in, false);
  assert.equal(p.email_matches, null);
  assert.ok(!JSON.stringify(p).includes("tech@a.invalid"));
  assert.ok(!JSON.stringify(p).includes("عميل"));
  // الزائر يرى الشعار الحالي فقط لشركة لديها دعوة سارية، ولا يرى ملفات أخرى
  assert.equal((await as(null, "select name from storage.objects where bucket_id = 'org-branding'")).length, 1);
  await db.query("insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${company}/stamp-1.png`]);
  assert.equal((await as(null, "select name from storage.objects where name = $1", [`${company}/stamp-1.png`])).length, 0);
  // مستخدم مسجل ببريد آخر
  assert.equal((await rpc(u.stranger, "invitation_landing", [inv.token])).email_matches, false);
  // بعد الإلغاء: الهوية فقط دون تفاصيل
  await rpc(u.mgr, "company_revoke_invitation", [inv.invitation_id]);
  const r = await rpc(null, "invitation_landing", [inv.token]);
  assert.equal(r.status, "revoked");
  assert.equal(r.company_name, "شركة أ");
  assert.equal(r.permissions, undefined);
  assert.equal((await as(null, "select name from storage.objects where bucket_id = 'org-branding'")).length, 0);
});

test("شعار المنصة: المالك فقط أو مساعد بصلاحية صريحة، لا مدير الشركة", async () => {
  await db.query("insert into storage.objects (bucket_id, name) values ('platform-branding', 'logo/new.png')");
  assert.match(await code(rpc(u.mgr, "platform_set_logo", ["logo/new.png"])), /42501/);
  assert.match(await code(rpc(u.owner, "platform_set_logo", ["../x.png"])), /22023/);
  assert.match(await code(rpc(u.owner, "platform_set_logo", ["logo/missing.png"])), /P0002/);
  await rpc(u.owner, "platform_set_logo", ["logo/new.png"]);
  assert.equal((await rpc(null, "platform_public_settings")).logo_path, "logo/new.png");
  assert.equal((await rpc(u.mgr, "get_my_context")).platform_logo.path, "logo/new.png");
  assert.match(await code(as(u.mgr, "insert into storage.objects (bucket_id, name) values ('platform-branding', 'logo/evil.png')")), /42501/);
  assert.equal((await as(u.owner, "select action from public.platform_audit_log where action = 'platform_logo_updated'")).length, 1);
});

test("دعوة مساعد: من المالك فقط، بالبريد نفسه، مرة واحدة، بالصلاحيات المحددة", async () => {
  assert.match(await code(rpc(u.mgr, "platform_invite_assistant", ["asst@ays.invalid", null, ["platform.companies.view"], 24])), /42501/);
  assert.match(await code(rpc(u.owner, "platform_invite_assistant", ["asst@ays.invalid", null, [], 24])), /22023/);
  assert.match(await code(rpc(u.owner, "platform_invite_assistant", ["owner@ays.invalid", null, ["platform.companies.view"], 24])), /22023/);
  const inv = await rpc(u.owner, "platform_invite_assistant", ["asst@ays.invalid", "مساعد", ["platform.companies.view", "platform.branding"], 24]);
  const land = await rpc(null, "assistant_invitation_landing", [inv.token]);
  assert.equal(land.status, "pending");
  assert.deepEqual(land.permissions, ["platform.branding", "platform.companies.view"]);
  // طلب الانضمام القديم أُغلق
  assert.match(await code(rpc(u.stranger, "platform_request_assistant", [null, null])), /42501/);
  // غير المدعو لا يقبل
  assert.match(await code(rpc(u.stranger, "accept_platform_assistant_invitation", [inv.token])), /42501/);
  u.asst = await user("asst@ays.invalid");
  await rpc(u.asst, "accept_platform_assistant_invitation", [inv.token]);
  assert.match(await code(rpc(u.asst, "accept_platform_assistant_invitation", [inv.token])), /P0001/);
  const ctx = await rpc(u.asst, "get_my_context");
  assert.equal(ctx.platform_role, "assistant");
  assert.deepEqual(ctx.platform_permissions, ["platform.branding", "platform.companies.view"]);
  // المساعد لا يدعو مساعدين ولا يعدّل صلاحياته
  assert.match(await code(rpc(u.asst, "platform_invite_assistant", ["x@y.invalid", null, ["platform.companies.view"], 24])), /42501/);
  assert.match(await code(rpc(u.asst, "platform_update_assistant", [u.asst, ["platform.companies.delete"], "active"])), /42501/);
  // بصلاحية الشعار الصريحة يستطيع تغييره
  await rpc(u.asst, "platform_set_logo", [null]);
  // التعطيل لا يحذف السجل ويُدقق
  await rpc(u.owner, "platform_update_assistant", [u.asst, null, "suspended"]);
  assert.equal((await db.query("select count(*)::int n from public.platform_assistants where user_id = $1", [u.asst])).rows[0].n, 1);
  assert.ok((await as(u.owner, "select action from public.platform_audit_log")).map((r) => r.action).includes("assistant_updated"));
  // دعوة منتهية أو ملغاة
  const inv2 = await rpc(u.owner, "platform_invite_assistant", ["late@ays.invalid", null, ["platform.companies.view"], 24]);
  await rpc(u.owner, "platform_revoke_assistant_invitation", [inv2.invitation_id]);
  assert.equal((await rpc(null, "assistant_invitation_landing", [inv2.token])).status, "revoked");
});

test("التراجع يعيد البنية كما كانت، ويُرفض بوجود بيانات", async () => {
  const fresh = await base();
  const snap = async (d) => ({
    columns: (await d.query(`select table_name, column_name from information_schema.columns where table_schema='public' order by 1,2`)).rows,
    policies: (await d.query(`select tablename, policyname, qual from pg_policies order by 1,2`)).rows,
    functions: (await d.query(`select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1,2`)).rows,
    triggers: (await d.query(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal order by 1,2`)).rows,
    perms: (await d.query(`select key from public.platform_permission_definitions order by 1`)).rows,
  });
  const before = await snap(fresh);
  await fresh.exec(read(...MIGRATION));
  await fresh.exec(read(...ROLLBACK));
  assert.deepEqual(await snap(fresh), before);
  await assert.rejects(db.exec(read(...ROLLBACK)), /التراجع مرفوض/);
});
