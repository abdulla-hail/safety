// اختبار الترحيل التشغيلي (20261028000100) على نسخة محلية مطابقة لبنية cgwn بعد ترحيل الدعوات.
// يشمل: الصلاحيات حسب الدور والتخصيص، عزل الشركات، الأرقام المرجعية، الكتالوج والأجهزة وQR، الإسناد،
// الصيانة، الإشعارات، الهوية البصرية، التخزين، سجل التدقيق.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
export const OPERATIONS = ["supabase", "migrations", "20261028000100_operations_permissions_branding.sql"];
let db;
const u = {};
const co = {};

async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.exec(uid ? "set local role authenticated" : "set local role anon");
    return (await tx.query(sql, params)).rows;
  });
}
const q = (uid, sql, params) => as(uid, sql, params);
const rpc = async (uid, fn, args = []) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
async function code(p) { try { await p; return null; } catch (e) { return e.code ?? e.message; } }
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
}
async function invite(manager, company, email, role) {
  const i = await rpc(manager, "company_invite_member", [company, email, role, null, null, null, 24]);
  const id = await user(email);
  await rpc(id, "accept_company_invitation", [i.token]);
  return id;
}

before(async () => {
  db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.exec(read("tests", "cgwn", "storage-stub.sql"));
  await db.query("insert into public.companies (name, status) values ('شركة قائمة', 'active')");
  await db.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
  await db.exec(read(...OPERATIONS));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  for (const k of ["A", "B"]) {
    const c = await rpc(u.owner, "platform_create_company", [`شركة ${k}`, `manager@${k}.invalid`, null, null, null, 24]);
    u[`mgr${k}`] = await user(`manager@${k}.invalid`);
    await rpc(u[`mgr${k}`], "accept_company_invitation", [c.token]);
    co[k] = c.company_id;
  }
  u.sup = await invite(u.mgrA, co.A, "sup@a.invalid", "supervisor");
  u.tech = await invite(u.mgrA, co.A, "tech@a.invalid", "technician");
  u.acc = await invite(u.mgrA, co.A, "acc@a.invalid", "accountant");
  u.store = await invite(u.mgrA, co.A, "store@a.invalid", "storekeeper");
  u.stranger = await user("stranger@x.invalid");
});

test("السياق في طلب واحد: صلاحيات فعلية لكل دور، وكتالوج افتراضي للشركات النشطة", async () => {
  const ctx = await rpc(u.mgrA, "get_my_context");
  assert.equal(ctx.is_platform_admin, false);
  assert.equal(ctx.memberships[0].role, "company_manager");
  assert.ok(ctx.memberships[0].permissions.includes("settings.branding"));
  const tech = (await rpc(u.tech, "get_my_context")).memberships[0].permissions;
  assert.deepEqual(tech, ["catalog.view", "devices.print", "field.assigned", "maintenance.create", "visits.update"]);
  assert.equal((await rpc(u.owner, "get_my_context")).is_platform_admin, true);
  assert.equal((await q(u.mgrA, "select id from public.safety_systems where company_id = $1", [co.A])).length, 7);
  // الشركة القائمة النشطة حصلت على الكتالوج الافتراضي أيضًا
  assert.equal((await db.query("select count(*)::int n from public.safety_systems s join public.companies c on c.id = s.company_id where c.name = 'شركة قائمة'")).rows[0].n, 7);
});

test("كتالوج الأنظمة: المدير وأمين المستودع يضيفان، الفني يعرض فقط، ولا عبور بين الشركات", async () => {
  const [s] = await q(u.mgrA, "insert into public.safety_systems (company_id, name, default_interval_days) values ($1, 'أنظمة كشف الغاز', 180) returning ref_no", [co.A]);
  assert.match(s.ref_no, /^SYS-\d{6}$/);
  assert.equal((await q(u.store, "insert into public.safety_systems (company_id, name) values ($1, 'نظام المستودع') returning id", [co.A])).length, 1);
  assert.equal(await code(q(u.tech, "insert into public.safety_systems (company_id, name) values ($1, 'x y')", [co.A])), "42501");
  assert.ok((await q(u.tech, "select id from public.safety_systems")).length >= 8);
  assert.equal(await code(q(u.mgrA, "insert into public.safety_systems (company_id, name) values ($1, 'تسلل')", [co.B])), "42501");
  assert.equal((await q(u.mgrA, "select id from public.safety_systems where company_id = $1", [co.B])).length, 0);
  assert.equal(await code(q(u.mgrA, "insert into public.safety_systems (company_id, name) values ($1, 'أنظمة كشف الغاز')", [co.A])), "23505");
});

test("العملاء والمواقع: الأرقام المرجعية لكل شركة، والمحاسب يقرأ فقط، والمشرف يضيف", async () => {
  const [c1] = await q(u.mgrA, "insert into public.customers (company_id, name, ref_no) values ($1, 'عميل أ1', 'CUS-999999') returning id, ref_no", [co.A]);
  assert.equal(c1.ref_no, "CUS-000001");
  const [c2] = await q(u.sup, "insert into public.customers (company_id, name) values ($1, 'عميل أ2') returning ref_no", [co.A]);
  assert.equal(c2.ref_no, "CUS-000002");
  const [b1] = await q(u.mgrB, "insert into public.customers (company_id, name) values ($1, 'عميل ب1') returning ref_no", [co.B]);
  assert.equal(b1.ref_no, "CUS-000001");
  assert.equal(await code(q(u.acc, "insert into public.customers (company_id, name) values ($1, 'محاسب')", [co.A])), "42501");
  assert.ok((await q(u.acc, "select id from public.customers")).length >= 2);
  assert.equal((await q(u.mgrB, "select id from public.customers where company_id = $1", [co.A])).length, 0);
  assert.equal(await code(q(u.mgrA, "update public.customers set ref_no = 'CUS-000050' where id = $1", [c1.id])), "P0001");
  assert.equal(await code(q(u.mgrA, "update public.customers set company_id = $1 where id = $2", [co.B, c1.id])), "42501");
  const [site] = await q(u.mgrA, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'الفرع الرئيسي') returning ref_no", [co.A, c1.id]);
  assert.match(site.ref_no, /^SIT-\d{6}$/);
  assert.equal((await q(u.stranger, "select id from public.customers")).length, 0);
  assert.equal(await code(q(null, "select id from public.customers")), "42501");
});

test("الأرشفة والحذف: صلاحيات مستقلة، والحذف يُمنع مع العلاقات، وسجل التدقيق يسجل", async () => {
  const [c] = await q(u.mgrA, "insert into public.customers (company_id, name) values ($1, 'عميل أرشفة') returning id", [co.A]);
  // المشرف يملك التعديل لا الأرشفة: الحارس يرفض صراحة
  assert.equal(await code(q(u.sup, "update public.customers set archived_at = now() where id = $1", [c.id])), "42501");
  assert.equal((await q(u.acc, "update public.customers set archived_at = now() where id = $1 returning id", [c.id])).length, 0);
  await q(u.mgrA, "update public.customers set archived_at = now() where id = $1", [c.id]);
  assert.ok((await q(u.mgrA, "select archived_by from public.customers where id = $1", [c.id]))[0].archived_by);
  await q(u.mgrA, "update public.customers set archived_at = null where id = $1", [c.id]);
  await q(u.mgrA, "insert into public.devices (company_id, customer_id, name) values ($1, $2, 'طفاية')", [co.A, c.id]);
  assert.ok(["23503", "23001"].includes(await code(q(u.mgrA, "delete from public.customers where id = $1", [c.id]))));
  const actions = (await q(u.mgrA, "select action from public.company_audit_log where target_id = $1 order by id", [c.id])).map((r) => r.action);
  assert.deepEqual(actions, ["create", "archive", "restore"]);
});

test("الكتالوج يعبّئ بيانات الجهاز، والرمز فريد ثابت لا يُعاد استخدامه، وتحويل QR يحترم الصلاحية", async () => {
  const [sys] = await q(u.mgrA, "select id from public.safety_systems where company_id = $1 and name = 'طفايات الحريق'", [co.A]);
  const [item] = await q(u.mgrA, "insert into public.catalog_items (company_id, system_id, name, manufacturer, model, default_interval_days) values ($1,$2,'طفاية بودرة 6 كجم','NAFFCO','DP-6',365) returning id, ref_no", [co.A, sys.id]);
  assert.match(item.ref_no, /^CAT-\d{6}$/);
  const [cust] = await q(u.mgrA, "select id from public.customers where name = 'عميل أ1'");
  const [dev] = await q(u.mgrA, "insert into public.devices (company_id, customer_id, catalog_item_id, name, serial_number, installed_at) values ($1,$2,$3,'','SN-1','2026-01-01') returning *", [co.A, cust.id, item.id]);
  assert.equal(dev.name, "طفاية بودرة 6 كجم");
  assert.equal(dev.manufacturer, "NAFFCO");
  assert.equal(dev.maintenance_interval_days, 365);
  assert.match(dev.qr_token, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.equal(await code(q(u.mgrA, "update public.devices set qr_token = 'AAAAAAAAAAAA' where id = $1", [dev.id])), "P0001");
  assert.equal((await rpc(u.mgrA, "resolve_device_token", [dev.qr_token])).status, "ok");
  assert.equal((await rpc(u.mgrB, "resolve_device_token", [dev.qr_token])).status, "forbidden");
  const [tmp] = await q(u.mgrA, "insert into public.devices (company_id, customer_id, name) values ($1,$2,'مؤقت') returning id, qr_token", [co.A, cust.id]);
  await q(u.mgrA, "delete from public.devices where id = $1", [tmp.id]);
  assert.equal((await rpc(u.mgrA, "resolve_device_token", [tmp.qr_token])).status, "removed");
  co.device = dev.id; co.customer = cust.id;
});

test("الفني (المسندين فقط): يرى أجهزة عملائه المسندين ويسجل صيانة، ويُشعر بالإسناد", async () => {
  assert.equal((await q(u.tech, "select id from public.devices")).length, 0);
  const [t] = await q(u.mgrA, "insert into public.technicians (company_id, full_name, user_id) values ($1, 'الفني', $2) returning id", [co.A, u.tech]);
  assert.equal(await code(q(u.mgrA, "insert into public.technicians (company_id, full_name, user_id) values ($1, 'غريب', $2)", [co.A, u.stranger])), "23514");
  await q(u.sup, "insert into public.technician_customers (company_id, technician_id, customer_id) values ($1,$2,$3)", [co.A, t.id, co.customer]);
  assert.equal(await code(q(u.sup, "insert into public.technician_customers (company_id, technician_id, customer_id) values ($1,$2,$3)", [co.A, t.id, co.customer])), "23505");
  assert.ok((await q(u.tech, "select id from public.devices")).length > 0);
  const notes = await q(u.tech, "select kind from public.notifications");
  assert.ok(notes.some((n) => n.kind === "assignment"));
  const [rec] = await q(u.tech, "insert into public.maintenance_records (company_id, device_id, action, result, status_after, performed_at) values ($1,$2,'inspection','pass','operational','2026-10-01T09:00:00+03:00') returning ref_no, device_name_snapshot", [co.A, co.device]);
  assert.match(rec.ref_no, /^MNT-\d{6}$/);
  const [d] = await q(u.mgrA, "select next_maintenance_at from public.devices where id = $1", [co.device]);
  assert.equal(d.next_maintenance_at.toISOString().slice(0, 10), "2027-10-01");
  assert.ok(await code(q(u.mgrA, "delete from public.maintenance_records")));
  assert.equal((await q(u.mgrA, "select id from public.notifications where recipient_user_id = $1", [u.tech])).length, 0);
  assert.equal((await rpc(u.tech, "get_my_context")).unread_notifications >= 1, true);
});

test("تخصيص صلاحيات عضو: المدير فقط، لا لنفسه ولا للمدير، ويُطبَّق فورًا", async () => {
  const [m] = await q(u.mgrA, "select id from public.company_memberships where user_id = $1", [u.acc]);
  await rpc(u.mgrA, "company_set_member_permissions", [m.id, ["customers.view", "customers.create", "reports.view"]]);
  assert.equal((await q(u.acc, "insert into public.customers (company_id, name) values ($1, 'من المحاسب') returning id", [co.A])).length, 1);
  assert.equal((await q(u.acc, "select id from public.devices")).length, 0);
  assert.equal(await code(rpc(u.sup, "company_set_member_permissions", [m.id, ["customers.delete"]])), "42501");
  const [own] = await q(u.mgrA, "select id from public.company_memberships where user_id = $1", [u.mgrA]);
  assert.equal(await code(rpc(u.mgrA, "company_set_member_permissions", [own.id, null])), "P0001");
  assert.equal(await code(rpc(u.mgrA, "company_set_member_permissions", [m.id, ["unknown.perm"]])), "22023");
  await rpc(u.mgrA, "company_set_member_permissions", [m.id, null]); // العودة للافتراضي
  assert.equal(await code(q(u.acc, "insert into public.customers (company_id, name) values ($1, 'x y')", [co.A])), "42501");
});

test("الهوية البصرية: المدير يعدّل ويستعيد، وغير المخول والشركات الأخرى ممنوعون، والتخزين معزول", async () => {
  await rpc(u.mgrA, "company_update_branding", [co.A, JSON.stringify({ primary_color: "#112233", header_text: "ترويسة" })]);
  await rpc(u.mgrA, "company_update_branding", [co.A, JSON.stringify({ primary_color: "#445566" })]);
  assert.equal(await code(rpc(u.tech, "company_update_branding", [co.A, JSON.stringify({ primary_color: "#000000" })])), "42501");
  assert.equal(await code(rpc(u.mgrB, "company_update_branding", [co.A, JSON.stringify({ primary_color: "#000000" })])), "42501");
  assert.equal(await code(rpc(u.mgrA, "company_update_branding", [co.A, JSON.stringify({ name: "تغيير الاسم" })])), "22023");
  assert.equal(await code(rpc(u.mgrA, "company_update_branding", [co.A, JSON.stringify({ logo_path: `${co.B}/x.png` })])), "42501");
  const [h] = await q(u.mgrA, "select id from public.company_branding_history where company_id = $1 order by created_at desc limit 1", [co.A]);
  await rpc(u.mgrA, "company_restore_branding", [h.id]);
  assert.equal((await q(u.mgrA, "select primary_color from public.companies where id = $1", [co.A]))[0].primary_color, "#112233");
  assert.equal(await code(q(u.mgrA, "insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${co.B}/logo.png`])), "42501");
  await q(u.mgrA, "insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${co.A}/logo.png`]);
  assert.equal((await q(u.mgrB, "select id from storage.objects where bucket_id = 'org-branding'")).length, 0);
  assert.equal((await q(u.tech, "select id from storage.objects where bucket_id = 'org-branding'")).length, 1);
});

test("الشركة الموقوفة: لا صلاحيات تشغيلية لأعضائها", async () => {
  await rpc(u.owner, "platform_set_company_status", [co.B, "suspended"]);
  assert.equal(await code(q(u.mgrB, "insert into public.customers (company_id, name) values ($1, 'بعد الإيقاف')", [co.B])), "42501");
  assert.equal((await q(u.mgrB, "select id from public.customers")).length, 0);
  await rpc(u.owner, "platform_set_company_status", [co.B, "active"]);
  assert.equal((await q(u.mgrB, "select id from public.customers")).length, 1);
});

test("تنبيهات الصيانة لا تتكرر، والإشعار يعدّله المستلم فقط بتحديده مقروءًا", async () => {
  await q(u.mgrA, "insert into public.devices (company_id, customer_id, name, next_maintenance_at) values ($1,$2,'متأخر', current_date - 3)", [co.A, co.customer]);
  await db.query("select app_private.run_maintenance_alerts_for($1)", [co.A]);
  const n1 = (await db.query("select count(*)::int n from public.notifications where kind like 'maintenance_%'")).rows[0].n;
  await db.query("select app_private.run_maintenance_alerts_for($1)", [co.A]);
  const n2 = (await db.query("select count(*)::int n from public.notifications where kind like 'maintenance_%'")).rows[0].n;
  assert.ok(n1 > 0);
  assert.equal(n1, n2);
  const [n] = await q(u.tech, "select id from public.notifications limit 1");
  await q(u.tech, "update public.notifications set read_at = now() where id = $1", [n.id]);
  assert.equal(await code(q(u.tech, "update public.notifications set title = 'x' where id = $1", [n.id])), "42501");
  assert.equal(await code(q(u.tech, "insert into public.notifications (recipient_user_id, kind, title) values ($1, 'x', 'x')", [u.tech])), "42501");
});

test("الدوال الداخلية غير قابلة للاستدعاء، والجداول الجديدة غير متاحة لـ anon", async () => {
  assert.equal(await code(as(u.mgrA, "select app_private.next_ref('customers', $1, 'X')", [co.A])), "42501");
  assert.equal(await code(as(u.mgrA, "select app_private.run_maintenance_alerts_for($1)", [co.A])), "42501");
  assert.equal(await code(as(u.mgrA, "select public.company_branding_snapshot($1)", [co.A])), "42501");
  for (const t of ["customers", "devices", "notifications", "safety_systems"]) {
    assert.equal(await code(q(null, `select 1 from public.${t}`)), "42501", t);
  }
});
