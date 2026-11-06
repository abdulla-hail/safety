// اختبار ترحيل 20261111000100 على PGlite فوق كل الترحيلات السابقة: نوع «مؤسسة»، الماركات، عروض أسعار الفنيين والمراجعة،
// سجل تعديل البنود، إشعارات الأنشطة للإدارة وتفضيلاتها، مراحل التنبيه المسبق، الملخص التشغيلي، إعدادات البريد، والتراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261111000100_brands_tech_quotes_activity.sql"];
const ROLLBACK = ["supabase", "proposed", "20261111000100_rollback.sql"];
let db;
const u = {};
const ids = {};

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => x < MIGRATION.at(-1))) {
    await d.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  return d;
}
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: uid ? "authenticated" : "anon", sub: uid ?? "" })]);
    await tx.exec(uid ? "set local role authenticated" : "set local role anon");
    return (await tx.query(sql, params)).rows;
  });
}
const rpc = async (uid, fn, args = []) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
async function code(p) { try { await p; return null; } catch (e) { return e.code ?? e.message; } }
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const notes = async (uid, kind) => (await db.query("select * from public.notifications where recipient_user_id = $1 and kind = $2 order by created_at", [uid, kind])).rows;

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const c = await rpc(u.owner, "platform_create_company", ["شركة أ", "manager@a.invalid", null, null, null, 24]);
  ids.co = c.company_id;
  u.mgr = await user("manager@a.invalid");
  await rpc(u.mgr, "accept_company_invitation", [c.token]);
  for (const [k, role] of [["t1", "technician"], ["t2", "technician"]]) {
    const inv = await rpc(u.mgr, "company_invite_member", [ids.co, `${k}@a.invalid`, role, `الفني ${k}`, null, null, 24]);
    u[k] = await user(`${k}@a.invalid`);
    await rpc(u[k], "accept_company_invitation", [inv.token]);
    ids[k] = (await one("select id from public.technicians where user_id = $1", [u[k]]))?.id;
  }
  ids.cust = (await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]))[0].id;
  ids.S1 = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'فرع الرياض') returning id", [ids.co, ids.cust]))[0].id;
  ids.S2 = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'فرع جدة') returning id", [ids.co, ids.cust]))[0].id;
  await rpc(u.mgr, "assignment_set", [ids.t1, ids.cust, [ids.S1], "اختبار"]);
  ids.D1 = (await as(u.mgr, "insert into public.devices (company_id, customer_id, site_id, name) values ($1, $2, $3, 'لوحة إنذار') returning id", [ids.co, ids.cust, ids.S1]))[0].id;
});

test("نوع العميل «مؤسسة» مقبول، والأنواع غير المعرّفة مرفوضة", async () => {
  assert.equal(await code(as(u.mgr, "insert into public.customers (company_id, name, customer_type) values ($1, 'مؤسسة النور', 'establishment')", [ids.co])), null);
  assert.equal(await code(as(u.mgr, "insert into public.customers (company_id, name, customer_type) values ($1, 'س', 'other')", [ids.co])), "23514");
});

test("الماركات: يديرها المسؤول، بلا تكرار، والفني يختار فقط، والاسم يُحفظ في البند", async () => {
  ids.B1 = (await as(u.mgr, "insert into public.brands (company_id, name) values ($1, 'Siemens') returning id", [ids.co]))[0].id;
  assert.equal(await code(as(u.mgr, "insert into public.brands (company_id, name) values ($1, ' siemens ')", [ids.co])), "23505", "الاسم لا يتكرر");
  assert.equal(await code(as(u.t1, "insert into public.brands (company_id, name) values ($1, 'Bosch')", [ids.co])), "42501", "الفني لا يضيف ماركات");
  assert.equal((await as(u.t1, "select id from public.brands")).length, 1, "الفني يرى القائمة");
  assert.equal(await code(as(u.t1, "update public.brands set name = 'X' where id = $1", [ids.B1])), null);
  assert.equal((await one("select name from public.brands where id = $1", [ids.B1])).name, "Siemens", "التعديل للمسؤول فقط (RLS)");
});

test("الفني ينشئ عرضه من معاينته بالماركات، ويعدّل مسودته، ويرسلها للمراجعة فقط", async () => {
  ids.V = await rpc(u.t1, "survey_create", [crypto.randomUUID(), ids.S1, "2026-11-10T07:00:00Z", null, null]);
  // إشعار الإدارة بإنشاء المعاينة باسم الفني، ولا يُشعَر المنفّذ نفسه
  const vc = await notes(u.mgr, "survey_created");
  assert.equal(vc.length, 1);
  assert.equal(vc[0].actor_user_id, u.t1);
  assert.match(vc[0].body, /بواسطة الفني t1/);
  assert.equal((await notes(u.t1, "survey_created")).length, 0);
  await as(u.t1, "update public.visits set status = 'in_progress', actual_start = now() where id = $1", [ids.V]);
  assert.equal((await notes(u.mgr, "visit_started")).length, 1);
  await as(u.t1, `insert into public.survey_items (company_id, visit_id, device_id, title, issue_type, quantity, unit_price, brand_id)
    values ($1, $2, $3, 'استبدال حساس', 'faulty', 2, 150, $4)`, [ids.co, ids.V, ids.D1, ids.B1]);
  assert.equal((await one("select brand from public.survey_items where visit_id = $1", [ids.V])).brand, "Siemens");
  await rpc(u.t1, "survey_complete", [ids.V]);
  assert.match((await notes(u.mgr, "survey_completed"))[0].body, /البنود: 1/);

  ids.Q = await rpc(u.t1, "quotation_from_visit", [ids.V]);
  const qi = await one("select brand, brand_id from public.quotation_items where quotation_id = $1", [ids.Q]);
  assert.deepEqual(qi, { brand: "Siemens", brand_id: ids.B1 }, "الماركة تنتقل للعرض");
  assert.equal((await as(u.t1, "select created_by from public.quotations where id = $1", [ids.Q]))[0].created_by, u.t1);
  assert.equal((await as(u.t2, "select id from public.quotations where id = $1", [ids.Q])).length, 0, "فني آخر لا يرى العرض");
  assert.equal((await notes(u.mgr, "quote_created")).length, 1);

  assert.equal(await code(as(u.t1, "insert into public.quotation_items (company_id, quotation_id, description, quantity, unit_price) values ($1, $2, 'أجور', 1, 100)", [ids.co, ids.Q])), null);
  assert.equal(await code(as(u.t2, "insert into public.quotation_items (company_id, quotation_id, description) values ($1, $2, 'تلاعب')", [ids.co, ids.Q])), "42501");
  assert.equal(await code(rpc(u.t1, "quotation_set_status", [ids.Q, "sent", null])), "42501", "الإرسال للعميل للمسؤول");
  await rpc(u.t1, "quotation_set_status", [ids.Q, "review", null]);
  assert.ok((await one("select submitted_at from public.quotations where id = $1", [ids.Q])).submitted_at);
  assert.equal((await notes(u.mgr, "quote_review")).length, 1);
  assert.equal((await as(u.t1, "update public.quotation_items set unit_price = 1 where quotation_id = $1 returning id", [ids.Q])).length, 0, "لا تعديل بعد الإرسال للمراجعة");
  // المراجع يصحح السعر ثم يعتمد ويرسل
  assert.equal(await code(as(u.mgr, "update public.quotation_items set unit_price = 120 where quotation_id = $1 and description = 'أجور'", [ids.Q])), null);
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "sent", null]);
  const q = await one("select status, approved_by from public.quotations where id = $1", [ids.Q]);
  assert.deepEqual(q, { status: "sent", approved_by: u.mgr });
  assert.equal(await code(as(u.mgr, "update public.quotation_items set unit_price = 1 where quotation_id = $1", [ids.Q])), "P0001");
  // سجل التعديلات تحت العرض
  const audit = (await db.query("select action from public.company_audit_log where target_type = 'quotation' and target_id = $1 order by id", [ids.Q])).rows.map((r) => r.action);
  assert.ok(audit.includes("item_added") && audit.includes("item_updated"), audit.join(","));
  // قبول العميل يصل للفني؟ لا (الفني ميداني بلا quotes.view)؛ ويصل للمسؤولين الآخرين فقط
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "accepted", "تمت الموافقة"]);
  assert.equal((await notes(u.mgr, "quote_accepted")).length, 0, "منفّذ العملية لا يُشعَر");
});

test("الفني لا ينشئ عرضًا لفرع خارج نطاقه", async () => {
  assert.equal(await code(as(u.t1, "insert into public.quotations (company_id, customer_id, site_id) values ($1, $2, $3)", [ids.co, ids.cust, ids.S2])), "42501");
  assert.equal(await code(as(u.t1, "insert into public.quotations (company_id, customer_id, site_id) values ($1, $2, $3)", [ids.co, ids.cust, ids.S1])), null);
});

test("إشعارات الصور: تُدمج في إشعار واحد للساعة، ويمكن للمسؤول إيقاف نوع بعينه", async () => {
  const V = await rpc(u.t1, "survey_create", [crypto.randomUUID(), ids.S1, null, null, null]);
  for (const n of [1, 2]) {
    await as(u.t1, "insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, mime_type) values ($1, 'visit', $2, $3, 'p.jpg', 'image/jpeg')",
      [ids.co, V, `${ids.co}/visit/${V}/p${n}.jpg`]);
  }
  assert.equal((await notes(u.mgr, "photo_added")).length, 1);
  await as(u.mgr, "insert into public.notification_preferences (company_id, user_id, kind, enabled) values ($1, $2, 'device_created', false)", [ids.co, u.mgr]);
  assert.equal(await code(as(u.t1, "insert into public.notification_preferences (company_id, user_id, kind, enabled) values ($1, $2, 'x_kind', false)", [ids.co, u.mgr])), "42501", "تفضيلات غيره");
  await as(u.mgr, "insert into public.devices (company_id, customer_id, site_id, name) values ($1, $2, $3, 'جهاز جديد')", [ids.co, ids.cust, ids.S1]);
  assert.equal((await notes(u.mgr, "device_created")).length, 0, "النوع الموقوف لا يصل");
});

test("التنبيه المسبق بمراحل: كل مرحلة مرة واحدة، والمرحلة الأقرب فقط", async () => {
  assert.equal(await code(rpc(u.t1, "set_alert_lead_days", [ids.co, [20, 5]])), "42501");
  await rpc(u.mgr, "set_alert_lead_days", [ids.co, [30, 15, 7, 1, 7]]);
  assert.deepEqual((await one("select alert_lead_days from public.companies where id = $1", [ids.co])).alert_lead_days, [30, 15, 7, 1]);
  const cy = await one("select id, due_date from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [ids.D1]);
  assert.ok(cy, "للجهاز استحقاق مفتوح");
  const run = async (daysBefore) => db.query("select app_private.run_maintenance_alerts_for($1, ($2::date - $3::int))", [ids.co, cy.due_date, daysBefore]);
  await run(12);
  await run(10);
  await run(6);
  const keys = (await db.query("select dedupe_key from public.notifications where recipient_user_id = $1 and kind = 'maintenance_due_soon' and entity_id = $2 order by created_at", [u.mgr, ids.D1])).rows.map((r) => r.dedupe_key);
  assert.deepEqual(keys, [`soon15:${cy.id}`, `soon7:${cy.id}`]);
  await run(0);
  assert.equal((await notes(u.mgr, "maintenance_due_today")).filter((n) => n.entity_id === ids.D1).length, 1);
  await run(-3);
  assert.equal((await notes(u.mgr, "maintenance_overdue")).filter((n) => n.entity_id === ids.D1).length, 1);
});

test("الملخص التشغيلي: زيارات لم تُغلق بعد موعدها", async () => {
  await as(u.mgr, "insert into public.visits (company_id, customer_id, site_id, scheduled_start, visit_type) values ($1, $2, $3, now() - interval '5 days', 'periodic')", [ids.co, ids.cust, ids.S1]);
  await db.query("select app_private.run_ops_digest_for($1, (now() at time zone 'Asia/Riyadh')::date)", [ids.co]);
  const today = (await one("select to_char((now() at time zone 'Asia/Riyadh')::date, 'YYYY-MM-DD') d")).d;
  assert.equal((await notes(u.mgr, "visits_unclosed")).filter((n) => n.dedupe_key === `unclosed:${today}`).length, 1);
  await db.query("select app_private.run_ops_digest_for($1, (now() at time zone 'Asia/Riyadh')::date)", [ids.co]);
  assert.equal((await notes(u.mgr, "visits_unclosed")).filter((n) => n.dedupe_key === `unclosed:${today}`).length, 1, "مرة واحدة يوميًا");
});

test("بريد الشركة: للمسؤول، وكلمة المرور المشفرة لا تُقرأ عبر الواجهة", async () => {
  await as(u.mgr, `insert into public.company_mail_settings (company_id, sender_name, sender_email, smtp_host, smtp_port, smtp_user, smtp_password_enc, enabled)
    values ($1, 'شركة أ للسلامة', 'info@a.invalid', 'smtp.a.invalid', 465, 'info@a.invalid', 'v1:enc', true)`, [ids.co]);
  assert.equal(await code(as(u.mgr, "select smtp_password_enc from public.company_mail_settings")), "42501");
  assert.equal((await as(u.mgr, "select sender_email from public.company_mail_settings"))[0].sender_email, "info@a.invalid");
  assert.equal((await as(u.t1, "select company_id from public.company_mail_settings")).length, 0, "الفني لا يرى الإعدادات");
  assert.equal((await rpc(u.t1, "company_mail_config", [ids.co])).smtp_password_enc, "v1:enc", "الخادم يقرأ المشفرة عند المشاركة");
  const tq = await rpc(u.mgr, "share_create", ["quote", ids.Q, 7]);
  const d = (await as(null, "select public.shared_document($1) d", [tq]))[0].d;
  assert.equal(d.company.name, "شركة أ للسلامة");
  assert.equal(d.company.email, "info@a.invalid");
  assert.equal(d.doc.items.find((i) => i.description.startsWith("استبدال")).brand, "Siemens");
});

test("التراجع يرفض مع بيانات الترحيل، وينجح على قاعدة بلا بيانات", async () => {
  assert.match(String(await code(db.exec(read(...ROLLBACK)))), /P0001|التراجع مرفوض/);
  const clean = await base();
  await clean.exec(read(...MIGRATION));
  await clean.exec(read(...ROLLBACK));
  const r = await clean.query(`select to_regclass('public.brands') b, to_regclass('public.company_mail_settings') m,
    (select count(*)::int from information_schema.columns where table_name = 'quotations' and column_name = 'submitted_at') c,
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'quotations_status_check') s`);
  assert.equal(r.rows[0].b, null);
  assert.equal(r.rows[0].m, null);
  assert.equal(r.rows[0].c, 0);
  assert.doesNotMatch(r.rows[0].s, /review/);
  await clean.close();
});
