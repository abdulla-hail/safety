// اختبار ترحيل 20261029000100: صورة الجهاز (المسار والعزل وسياسات التخزين)، ربط الفني بعضويته عبر الدعوة،
// الصلاحيات المخصصة في الدعوة، ثم التراجع الآمن.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261029000100_device_images_technician_members.sql"];
const ROLLBACK = ["supabase", "proposed", "20261029000100_rollback.sql"];
let db;
const u = {};
const co = {};

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  await d.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
  await d.exec(read("supabase", "migrations", "20261028000100_operations_permissions_branding.sql"));
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
async function user(email, name) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3) returning id",
    [crypto.randomUUID(), email, JSON.stringify(name ? { full_name: name } : {})])).rows[0].id;
}

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  for (const k of ["A", "B"]) {
    const c = await rpc(u.owner, "platform_create_company", [`شركة ${k}`, `manager@${k}.invalid`, null, null, null, 24]);
    u[`mgr${k}`] = await user(`manager@${k}.invalid`);
    await rpc(u[`mgr${k}`], "accept_company_invitation", [c.token]);
    co[k] = c.company_id;
  }
  u.acc = await user("acc@a.invalid");
  const i = await rpc(u.mgrA, "company_invite_member", [co.A, "acc@a.invalid", "accountant", null, null, null, 24]);
  await rpc(u.acc, "accept_company_invitation", [i.token]);
});

test("دعوة فني: القبول ينشئ سجل فني مرتبطًا بالعضوية مع التخصصات، دون تكرار", async () => {
  const inv = await rpc(u.mgrA, "company_invite_member", [co.A, "tech@a.invalid", "technician", "فني الدعوة", "فني إنذار", "alarm,pumps,unknown", 24]);
  u.tech = await user("tech@a.invalid", "اسم Google");
  // لا تقبل ببريد آخر ولا من شركة أخرى
  assert.match(await code(rpc(u.acc, "accept_company_invitation", [inv.token])), /42501/);
  await rpc(u.tech, "accept_company_invitation", [inv.token]);
  const t = (await db.query("select * from public.technicians where user_id = $1", [u.tech])).rows;
  assert.equal(t.length, 1);
  assert.equal(t[0].company_id, co.A);
  assert.equal(t[0].full_name, "فني الدعوة");
  assert.equal(t[0].email, "tech@a.invalid");
  assert.deepEqual(t[0].specialties, ["alarm", "pumps"]);
  assert.match(t[0].ref_no, /^TEC-\d{6}$/);
  // قبول ثانٍ مرفوض
  assert.match(await code(rpc(u.tech, "accept_company_invitation", [inv.token])), /P0001/);
  // الفني يرى سجله ويظهر في الفريق بدور فني
  assert.equal((await as(u.tech, "select id from public.technicians where user_id = $1", [u.tech])).length, 1);
  assert.equal((await db.query("select role from public.company_memberships where user_id = $1", [u.tech])).rows[0].role, "technician");
});

test("سجل فني يدوي بالبريد نفسه يُربط بدل إنشاء سجل مكرر", async () => {
  await as(u.mgrA, "insert into public.technicians (company_id, full_name, email) values ($1, 'فني يدوي', 'tech2@a.invalid')", [co.A]);
  const inv = await rpc(u.mgrA, "company_invite_member", [co.A, "tech2@a.invalid", "technician", null, null, null, 24]);
  u.tech2 = await user("tech2@a.invalid");
  await rpc(u.tech2, "accept_company_invitation", [inv.token]);
  const rows = (await db.query("select full_name, user_id from public.technicians where lower(email) = 'tech2@a.invalid'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, u.tech2);
  assert.equal(rows[0].full_name, "فني يدوي");
});

test("تعطيل العضوية يوقف سجل الفني دون حذفه، وإعادة التفعيل تعيده", async () => {
  const m = (await db.query("select id from public.company_memberships where user_id = $1", [u.tech])).rows[0].id;
  await rpc(u.mgrA, "company_set_member_status", [m, "suspended"]);
  assert.equal((await db.query("select is_active from public.technicians where user_id = $1", [u.tech])).rows[0].is_active, false);
  await rpc(u.mgrA, "company_set_member_status", [m, "active"]);
  assert.equal((await db.query("select is_active from public.technicians where user_id = $1", [u.tech])).rows[0].is_active, true);
  assert.equal((await db.query("select count(*)::int n from public.technicians where user_id = $1", [u.tech])).rows[0].n, 1);
});

test("ربط عضو فني قائم: للمدير فقط، ولشركته فقط", async () => {
  // عضو فني أُنشئ قبل الترحيل (محاكاة: نحذف سجله بصلاحية النظام)
  const m = (await db.query("select id from public.company_memberships where user_id = $1", [u.tech])).rows[0].id;
  await db.query("delete from public.technicians where user_id = $1", [u.tech]);
  assert.match(await code(rpc(u.mgrB, "company_link_technician_member", [m])), /42501/);
  assert.match(await code(rpc(u.acc, "company_link_technician_member", [m])), /42501/);
  const id = await rpc(u.mgrA, "company_link_technician_member", [m]);
  assert.ok(id);
  assert.equal(await rpc(u.mgrA, "company_link_technician_member", [m]), id);
});

test("صلاحيات مخصصة في الدعوة: تُطبق عند القبول وتنتقل للدعوة البديلة", async () => {
  const inv = await rpc(u.mgrA, "company_invite_member", [co.A, "tech3@a.invalid", "technician", null, null, null, 24]);
  assert.match(await code(rpc(u.mgrB, "company_set_invitation_permissions", [inv.invitation_id, ["devices.view"]])), /42501/);
  assert.match(await code(rpc(u.mgrA, "company_set_invitation_permissions", [inv.invitation_id, ["not.real"]])), /22023/);
  await rpc(u.mgrA, "company_set_invitation_permissions", [inv.invitation_id, ["maintenance.create", "field.assigned", "devices.print"]]);
  const again = await rpc(u.mgrA, "company_resend_invitation", [inv.invitation_id, 24]);
  u.tech3 = await user("tech3@a.invalid");
  assert.match(await code(rpc(u.tech3, "accept_company_invitation", [inv.token])), /P0001/); // الرابط القديم ملغى
  await rpc(u.tech3, "accept_company_invitation", [again.token]);
  const ctx = await rpc(u.tech3, "get_my_context");
  assert.deepEqual(ctx.memberships[0].permissions, ["devices.print", "field.assigned", "maintenance.create"]);
});

test("صورة الجهاز: مسار الشركة والجهاز فقط، والتخزين معزول بين الشركات", async () => {
  const [cust] = await as(u.mgrA, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [co.A]);
  const [dev] = await as(u.mgrA, "insert into public.devices (company_id, customer_id, name) values ($1, $2, 'جهاز') returning id", [co.A, cust.id]);
  const good = `${co.A}/device-image/${dev.id}/x.png`;
  assert.equal(await code(as(u.mgrA, "update public.devices set image_path = $1 where id = $2", [`${co.B}/device-image/${dev.id}/x.png`, dev.id])), "23514");
  assert.equal(await code(as(u.mgrA, "update public.devices set image_path = $1 where id = $2", [`${co.A}/device-image/${dev.id}/../x.png`, dev.id])), "23514");
  await db.query("insert into storage.buckets (id, name) values ('org-files', 'org-files') on conflict do nothing");
  await as(u.mgrA, "insert into storage.objects (bucket_id, name) values ('org-files', $1)", [good]);
  assert.equal(await code(as(u.mgrB, "insert into storage.objects (bucket_id, name) values ('org-files', $1)", [`${co.A}/device-image/${dev.id}/y.png`])), "42501");
  await as(u.mgrA, "update public.devices set image_path = $1 where id = $2", [good, dev.id]);
  assert.equal((await as(u.mgrA, "select name from storage.objects where name = $1", [good])).length, 1);
  assert.equal((await as(u.acc, "select name from storage.objects where name = $1", [good])).length, 1, "المحاسب يرى الجهاز فيرى صورته");
  assert.equal((await as(u.mgrB, "select name from storage.objects where name = $1", [good])).length, 0, "شركة أخرى لا ترى الصورة");
  assert.equal((await as(u.mgrB, "delete from storage.objects where name = $1 returning id", [good])).length, 0);
  assert.equal((await as(u.acc, "delete from storage.objects where name = $1 returning id", [good])).length, 0, "المحاسب لا يحذف");
  assert.equal((await as(u.mgrA, "delete from storage.objects where name = $1 returning id", [good])).length, 1);
});

test("التراجع يعيد البنية كما كانت، ويُرفض عند وجود بيانات بعد الترحيل", async () => {
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
  // في القاعدة المستخدمة أعلاه توجد سجلات فنيين مرتبطة تلقائيًا
  await assert.rejects(db.exec(read(...ROLLBACK)), /التراجع مرفوض/);
});
