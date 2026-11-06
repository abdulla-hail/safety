// اختبار ترحيل 20261110000100 على PGlite فوق كل الترحيلات السابقة: موقع الفرع، المعاينة وبنودها، الصور،
// عرض السعر من المعاينة وحالاته، روابط المشاركة للعميل، الصلاحيات، والتراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261110000100_surveys_quotes_maps.sql"];
const ROLLBACK = ["supabase", "proposed", "20261110000100_rollback.sql"];
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

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const c = await rpc(u.owner, "platform_create_company", ["شركة أ", "manager@a.invalid", null, null, null, 24]);
  ids.co = c.company_id;
  u.mgr = await user("manager@a.invalid");
  await rpc(u.mgr, "accept_company_invitation", [c.token]);
  for (const [k, role] of [["t1", "technician"], ["t2", "technician"], ["acc", "accountant"]]) {
    const inv = await rpc(u.mgr, "company_invite_member", [ids.co, `${k}@a.invalid`, role, `عضو ${k}`, null, null, 24]);
    u[k] = await user(`${k}@a.invalid`);
    await rpc(u[k], "accept_company_invitation", [inv.token]);
    ids[k] = (await one("select id from public.technicians where user_id = $1", [u[k]]))?.id;
  }
  ids.cust = (await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]))[0].id;
  ids.S1 = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'فرع الرياض') returning id", [ids.co, ids.cust]))[0].id;
  ids.S2 = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'فرع جدة') returning id", [ids.co, ids.cust]))[0].id;
  ids.D1 = (await as(u.mgr, "insert into public.devices (company_id, customer_id, site_id, name) values ($1, $2, $3, 'لوحة إنذار') returning id", [ids.co, ids.cust, ids.S1]))[0].id;
  ids.D2 = (await as(u.mgr, "insert into public.devices (company_id, customer_id, site_id, name) values ($1, $2, $3, 'طفاية') returning id", [ids.co, ids.cust, ids.S2]))[0].id;
  await rpc(u.mgr, "assignment_set", [ids.t1, ids.cust, [ids.S1], "اختبار"]);
});

test("موقع الفرع على الخريطة: إحداثيات صالحة ومتلازمة", async () => {
  assert.equal(await code(as(u.mgr, "update public.customer_sites set latitude = 24.7136, longitude = 46.6753 where id = $1", [ids.S1])), null);
  assert.equal(await code(as(u.mgr, "update public.customer_sites set latitude = 95, longitude = 46 where id = $1", [ids.S2])), "23514");
  assert.equal(await code(as(u.mgr, "update public.customer_sites set latitude = 21.5 where id = $1", [ids.S2])), "23514", "خط العرض وحده مرفوض");
});

test("إنشاء المعاينة: المسؤول يُسند لأي فني، والفني لنفسه وفي نطاقه فقط، وبلا تكرار", async () => {
  const key = crypto.randomUUID();
  ids.V = await rpc(u.t1, "survey_create", [key, ids.S1, "2026-11-10T07:00:00Z", null, "طلب العميل معاينة"]);
  assert.equal(await rpc(u.t1, "survey_create", [key, ids.S1, null, null, null]), ids.V, "إعادة الإرسال لا تكرر");
  const v = await one("select visit_type, status, site_id, customer_id from public.visits where id = $1", [ids.V]);
  assert.deepEqual(v, { visit_type: "survey", status: "scheduled", site_id: ids.S1, customer_id: ids.cust });
  assert.equal((await one("select technician_id from public.visit_technicians where visit_id = $1", [ids.V])).technician_id, ids.t1);
  assert.equal(await code(rpc(u.t1, "survey_create", [crypto.randomUUID(), ids.S2, null, null, null])), "42501", "فرع خارج النطاق");
  assert.equal(await code(rpc(u.t1, "survey_create", [crypto.randomUUID(), ids.S1, null, ids.t2, null])), "42501", "الفني لا يُسند لغيره");
  assert.equal(await code(rpc(u.t2, "survey_create", [crypto.randomUUID(), ids.S1, null, null, null])), "42501");
  ids.V2 = await rpc(u.mgr, "survey_create", [crypto.randomUUID(), ids.S2, null, ids.t2, null]);
  assert.equal((await as(u.t2, "select id from public.visits where id = $1", [ids.V2])).length, 1, "الفني المسند يرى معاينته");
});

test("بنود المعاينة: الجهاز من موقعها، ولمن يعمل عليها فقط، والتسعير صالح", async () => {
  await as(u.t1, "update public.visits set status = 'in_progress', actual_start = now() where id = $1", [ids.V]);
  ids.I1 = (await as(u.t1, `insert into public.survey_items (company_id, visit_id, device_id, title, issue_type, description, quantity, unit_price)
    values ($1, $2, $3, 'استبدال بطارية اللوحة', 'faulty', 'البطارية منتفخة', 2, 150) returning id`, [ids.co, ids.V, ids.D1]))[0].id;
  await as(u.t1, "insert into public.survey_items (company_id, visit_id, title, issue_type, quantity, unit_price, sort_order) values ($1, $2, 'تركيب كاشف دخان', 'installation', 3, 100, 2)", [ids.co, ids.V]);
  assert.equal(await code(as(u.t1, "insert into public.survey_items (company_id, visit_id, device_id, title) values ($1, $2, $3, 'جهاز فرع آخر')", [ids.co, ids.V, ids.D2])), "23514");
  assert.equal(await code(as(u.t1, "insert into public.survey_items (company_id, visit_id, title, unit_price) values ($1, $2, 'سعر سالب', -5)", [ids.co, ids.V])), "23514");
  assert.equal(await code(as(u.t2, "insert into public.survey_items (company_id, visit_id, title) values ($1, $2, 'فني آخر')", [ids.co, ids.V])), "42501");
  assert.equal((await as(u.t2, "select id from public.survey_items where visit_id = $1", [ids.V])).length, 0, "الفني الآخر لا يرى البنود");
  // البنود المسعّرة للمعاينة فقط
  const periodic = (await as(u.mgr, "insert into public.visits (company_id, customer_id, site_id, scheduled_start, visit_type) values ($1, $2, $3, now(), 'periodic') returning id", [ids.co, ids.cust, ids.S1]))[0].id;
  assert.equal(await code(as(u.mgr, "insert into public.survey_items (company_id, visit_id, title) values ($1, $2, 'بند')", [ids.co, periodic])), "23514");
  // صورة مرتبطة ببند
  assert.equal(await code(as(u.t1, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, mime_type, photo_stage, survey_item_id, device_id)
    values ($1, 'visit', $2, $3, 'battery.jpg', 'image/jpeg', 'fault', $4, $5)`, [ids.co, ids.V, `${ids.co}/visit/${ids.V}/battery.jpg`, ids.I1, ids.D1])), null);
  assert.equal(await code(as(u.mgr, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, survey_item_id)
    values ($1, 'visit', $2, $3, 'x.jpg', $4)`, [ids.co, ids.V2, `${ids.co}/visit/${ids.V2}/x.jpg`, ids.I1])), "23514", "بند معاينة أخرى");
});

test("إنهاء المعاينة يجمّد بنودها، وعرض السعر يُنشأ منها مرة واحدة لمن يملك الصلاحية", async () => {
  assert.equal(await code(rpc(u.mgr, "quotation_from_visit", [ids.V])), "P0001", "قبل الإنهاء");
  await rpc(u.t1, "survey_complete", [ids.V]);
  assert.ok((await one("select closed_at from public.visits where id = $1", [ids.V])).closed_at);
  assert.equal(await code(as(u.t1, "update public.survey_items set unit_price = 1 where id = $1", [ids.I1])), "P0001");
  assert.equal(await code(rpc(u.t1, "quotation_from_visit", [ids.V])), "42501", "الفني لا يصدر عروض الأسعار");
  ids.Q = await rpc(u.mgr, "quotation_from_visit", [ids.V]);
  assert.equal(await rpc(u.mgr, "quotation_from_visit", [ids.V]), ids.Q, "عرض واحد للمعاينة");
  const q = await one("select status, customer_id, site_id, vat_rate::float r, ref_no from public.quotations where id = $1", [ids.Q]);
  assert.deepEqual({ ...q, ref_no: /^QT-\d{6}$/.test(q.ref_no) }, { status: "draft", customer_id: ids.cust, site_id: ids.S1, r: 15, ref_no: true });
  const items = (await db.query("select quantity::float q, unit_price::float p from public.quotation_items where quotation_id = $1 order by sort_order", [ids.Q])).rows;
  assert.deepEqual(items, [{ q: 2, p: 150 }, { q: 3, p: 100 }]);
  assert.equal((await as(u.acc, "select id from public.quotations where id = $1", [ids.Q])).length, 1, "المحاسب يرى العروض");
  assert.equal((await as(u.t1, "select id from public.quotations where id = $1", [ids.Q])).length, 0, "الفني لا يرى العروض");
});

test("حالات العرض: التعديل في الإعداد فقط، والحالة بالإجراء، ولا إدخال بحالة غير «قيد الإعداد»", async () => {
  assert.equal(await code(as(u.mgr, "insert into public.quotation_items (company_id, quotation_id, description, quantity, unit_price) values ($1, $2, 'أجور تركيب', 1, 200)", [ids.co, ids.Q])), null);
  assert.equal(await code(as(u.mgr, "update public.quotations set status = 'accepted' where id = $1", [ids.Q])), "P0001");
  assert.equal(await code(as(u.mgr, "insert into public.quotations (company_id, customer_id, status) values ($1, $2, 'sent')", [ids.co, ids.cust])), "P0001");
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "sent", null]);
  assert.equal(await code(as(u.mgr, "update public.quotation_items set unit_price = 1 where quotation_id = $1", [ids.Q])), "P0001");
  assert.equal(await code(as(u.mgr, "update public.quotations set notes = 'تعديل' where id = $1", [ids.Q])), "P0001");
  assert.equal(await code(rpc(u.acc, "quotation_set_status", [ids.Q, "accepted", null])), "42501");
  assert.equal(await code(rpc(u.mgr, "quotation_set_status", [ids.Q, "draft", null])), null, "إعادة للمراجعة");
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "sent", null]);
  // عرض يدوي بلا بنود لا يُرسل
  const manual = (await as(u.mgr, "insert into public.quotations (company_id, customer_id, site_id) values ($1, $2, $3) returning id", [ids.co, ids.cust, ids.S2]))[0].id;
  assert.equal(await code(rpc(u.mgr, "quotation_set_status", [manual, "sent", null])), "P0001");
  assert.equal(await code(as(u.mgr, "insert into public.quotations (company_id, customer_id, site_id) values ($1, $2, $3)", [ids.co, ids.cust, crypto.randomUUID()])), "23514", "فرع لا يتبع العميل");
});

test("المشاركة: رابط للعميل دون حساب بالإجماليات والضريبة، والصور والشعار عبر الرابط الساري فقط، والإلغاء", async () => {
  const tq = await rpc(u.mgr, "share_create", ["quote", ids.Q, 30]);
  const doc = await as(null, "select public.shared_document($1) d", [tq]);
  const d = doc[0].d;
  assert.equal(d.status, "ok");
  assert.equal(d.kind, "quote");
  assert.deepEqual(d.totals, { subtotal: 800, vat_rate: 15, vat: 120, total: 920 }, "2×150 + 3×100 + 200 = 800، والضريبة 15٪");
  assert.equal(d.doc.items.length, 3);
  const ts = await rpc(u.t1, "share_create", ["survey", ids.V, 7]);
  const s = (await as(null, "select public.shared_document($1) d", [ts]))[0].d;
  assert.equal(s.doc.items.length, 2);
  assert.equal(s.doc.photos.length, 1);
  assert.deepEqual(s.totals, { subtotal: 600, vat_rate: 15, vat: 90, total: 690 });
  const photo = `${ids.co}/visit/${ids.V}/battery.jpg`;
  assert.equal((await as(null, "select public.storage_shared_allowed('org-files', $1) r", [photo]))[0].r, true);
  assert.equal((await as(null, "select public.storage_shared_allowed('org-files', $1) r", [`${ids.co}/visit/${ids.V2}/x.jpg`]))[0].r, false);
  assert.equal((await as(null, "select public.shared_document('not-a-real-token-xxxxxxxx') d"))[0].d.status, "invalid");
  assert.equal(await code(rpc(u.t1, "share_create", ["survey", ids.V2, 7])), "P0002", "معاينة غير منتهية لا تُشارك");
  assert.equal(await code(rpc(u.t1, "share_create", ["quote", ids.Q, 7])), "42501");
  const link = (await one("select id from public.share_links where kind = 'survey'")).id;
  await rpc(u.mgr, "share_revoke", [link]);
  assert.equal((await as(null, "select public.shared_document($1) d", [ts]))[0].d.status, "revoked");
  assert.equal((await as(null, "select public.storage_shared_allowed('org-files', $1) r", [photo]))[0].r, false);
  assert.equal(await code(as(u.mgr, "select token_hash from public.share_links")), "42501", "التجزئة لا تُقرأ");
});

test("إعادة فتح المعاينة: للمسؤول فقط، ولا تُعاد بعد قبول عرضها", async () => {
  assert.equal(await code(rpc(u.t1, "survey_reopen", [ids.V, "تصحيح"])), "42501");
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "accepted", "موافقة العميل"]);
  assert.equal(await code(rpc(u.mgr, "survey_reopen", [ids.V, "تصحيح بند"])), "P0001");
  await rpc(u.mgr, "quotation_set_status", [ids.Q, "draft", null]);
  await rpc(u.mgr, "survey_reopen", [ids.V, "تصحيح بند"]);
  assert.equal(await code(as(u.t1, "update public.survey_items set unit_price = 160 where id = $1", [ids.I1])), null);
});

test("التراجع يرفض مع بيانات الترحيل، وينجح على قاعدة بلا بيانات", async () => {
  assert.match(String(await code(db.exec(read(...ROLLBACK)))), /P0001|التراجع مرفوض/);
  const clean = await base();
  await clean.exec(read(...MIGRATION));
  await clean.exec(read(...ROLLBACK));
  const r = await clean.query("select to_regclass('public.quotations') q, to_regclass('public.survey_items') s, (select count(*)::int from information_schema.columns where table_name = 'customer_sites' and column_name = 'latitude') c");
  assert.deepEqual(r.rows[0], { q: null, s: null, c: 0 });
  await clean.close();
});
