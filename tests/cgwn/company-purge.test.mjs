// اختبار ترحيل 20261109000100 (الحذف الكامل للشركة) على PGlite فوق كل الترحيلات المطبقة: شركة بدورة عمل كاملة
// (أمر عمل ← زيارة ← بلاغ ← صور ← إغلاق ← سجلات صيانة ← نقل جهاز ← تعديل موعد) وشركة أخرى يجب ألا تتغير.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "proposed", "20261109000100_company_purge.sql"];
const ROLLBACK = ["supabase", "proposed", "20261109000100_rollback.sql"];
let db;
const u = {};
const ids = {};

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort()) {
    await d.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  await d.query("insert into storage.buckets (id, name) values ('org-files', 'org-files'), ('org-branding', 'org-branding') on conflict do nothing");
  return d;
}
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: uid })]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
}
const rpc = async (uid, fn, args = []) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
async function code(p) { try { await p; return null; } catch (e) { return e.code ?? e.message; } }
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const TABLES = async () => (await db.query("select table_name t from information_schema.columns where table_schema = 'public' and column_name = 'company_id' and table_name in (select tablename from pg_tables where schemaname = 'public') order by 1")).rows.map((r) => r.t);
/** بصمة كل صفوف شركة في كل الجداول (للتأكد أن الشركة الأخرى لم تتغير) */
async function print(company) {
  const out = {};
  for (const t of await TABLES()) {
    out[t] = (await one(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h from public."${t}" x where company_id = $1`, [company]));
  }
  return out;
}

async function company(name, prefix) {
  const c = await rpc(u.owner, "platform_create_company", [name, `manager@${prefix}.invalid`, null, null, null, 24]);
  const mgr = await user(`manager@${prefix}.invalid`);
  await rpc(mgr, "accept_company_invitation", [c.token]);
  return { id: c.company_id, mgr };
}
async function invite(co, mgr, email, uid) {
  const inv = await rpc(mgr, "company_invite_member", [co, email, "technician", email, null, null, 24]);
  await rpc(uid, "accept_company_invitation", [inv.token]);
  return (await one("select id from public.technicians where user_id = $1 and company_id = $2", [uid, co])).id;
}

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);

  // الشركة أ: دورة عمل كاملة
  const A = await company("شركة الحذف", "a");
  ids.A = A.id; u.mgrA = A.mgr;
  u.t1 = await user("t1@a.invalid");
  ids.t1 = await invite(ids.A, u.mgrA, "t1@a.invalid", u.t1);
  u.shared = await user("shared@x.invalid"); // عضو في الشركتين: حسابه يبقى
  await invite(ids.A, u.mgrA, "shared@x.invalid", u.shared);
  ids.cust = (await as(u.mgrA, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.A]))[0].id;
  ids.cust2 = (await as(u.mgrA, "insert into public.customers (company_id, name) values ($1, 'عميل 2') returning id", [ids.A]))[0].id;
  ids.S1 = (await as(u.mgrA, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'S1') returning id", [ids.A, ids.cust]))[0].id;
  ids.S2 = (await as(u.mgrA, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'S2') returning id", [ids.A, ids.cust2]))[0].id;
  const dev = async (name, site, cust) => (await as(u.mgrA, "insert into public.devices (company_id, customer_id, site_id, name, maintenance_interval_months) values ($1, $2, $3, $4, 3) returning id",
    [ids.A, cust, site, name]))[0].id;
  ids.D1 = await dev("لوحة إنذار", ids.S1, ids.cust);
  ids.D2 = await dev("طفاية", ids.S1, ids.cust);
  ids.D3 = await dev("مضخة", ids.S1, ids.cust);
  // ربط ذاتي (جهاز استُبدل بآخر) بقيد restrict: يجب ألا يمنع الحذف
  await db.query("update public.devices set replaced_by_device_id = $1 where id = $2", [ids.D2, ids.D3]);
  await rpc(u.mgrA, "device_move", [ids.D3, ids.S2, "نقل للاختبار", null]);
  await rpc(u.mgrA, "device_set_next_due", [ids.D2, "2030-01-01", "تعديل للاختبار"]);
  await rpc(u.mgrA, "assignment_set", [ids.t1, ids.cust, null, "اختبار"]);
  ids.WO = (await as(u.mgrA, "insert into public.work_orders (company_id, customer_id, site_id, title, order_type, priority, status) values ($1, $2, $3, 'عطل', 'emergency', 'high', 'new') returning id",
    [ids.A, ids.cust, ids.S1]))[0].id;
  await as(u.mgrA, "insert into public.work_order_devices (work_order_id, device_id, company_id) values ($1, $2, $3)", [ids.WO, ids.D1, ids.A]);
  await as(u.mgrA, "insert into public.work_order_technicians (work_order_id, technician_id, company_id) values ($1, $2, $3)", [ids.WO, ids.t1, ids.A]);
  ids.V = await rpc(u.t1, "work_order_start_visit", [ids.WO, crypto.randomUUID()]);
  await rpc(u.t1, "visit_report_fault", [ids.V, ids.D1, crypto.randomUUID(), "تسرب", "high", "open", null, null]);
  await as(u.t1, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, photo_stage, device_id)
    values ($1, 'visit', $2, $3, 'a.jpg', 'general', null)`, [ids.A, ids.V, `${ids.A}/visit/${ids.V}/a.jpg`]);
  for (const it of await as(u.t1, "select id, version from public.visit_devices where visit_id = $1", [ids.V])) {
    await rpc(u.t1, "visit_save_item", [it.id, { inspection_status: "inspected", action: "repair", result: "pass_with_notes", status_after: "operational" }, it.version]);
  }
  await rpc(u.t1, "visit_close", [ids.V, null, null]);
  for (const p of [`${ids.A}/visit/${ids.V}/a.jpg`, `${ids.A}/device-image/${ids.D1}/x.jpg`]) {
    await db.query("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [p]);
  }
  await db.query("insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${ids.A}/logo.png`]);

  // الشركة ب: يجب ألا يتغير فيها شيء
  const B = await company("شركة باقية", "b");
  ids.B = B.id; u.mgrB = B.mgr;
  await invite(ids.B, u.mgrB, "shared@x.invalid", u.shared);
  const cb = (await as(u.mgrB, "insert into public.customers (company_id, name) values ($1, 'عميل ب') returning id", [ids.B]))[0].id;
  const sb = (await as(u.mgrB, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'SB') returning id", [ids.B, cb]))[0].id;
  await as(u.mgrB, "insert into public.devices (company_id, customer_id, site_id, name, maintenance_interval_months) values ($1, $2, $3, 'جهاز ب', 6)", [ids.B, cb, sb]);
  await db.query("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [`${ids.B}/visit/x/b.jpg`]);
});

test("البيانات المجهزة تغطي الجداول التاريخية المحمية", async () => {
  for (const t of ["maintenance_records", "device_faults", "device_fault_events", "visit_devices", "device_transfers", "device_due_changes",
    "technician_assignment_events", "maintenance_record_technicians", "attachments", "device_maintenance_cycles"]) {
    assert.ok((await one(`select count(*)::int n from public.${t} where company_id = $1`, [ids.A])).n > 0, t);
  }
  assert.equal((await one("select replaced_by_device_id r from public.devices where id = $1", [ids.D3])).r, ids.D2);
});

test("المعاينة والحذف لمالك المنصة فقط", async () => {
  assert.equal(await code(rpc(u.mgrA, "platform_company_purge_preview", [ids.A])), "42501");
  assert.equal(await code(rpc(u.mgrA, "platform_purge_company", [ids.A, "شركة الحذف", false])), "42501");
  const p = await rpc(u.owner, "platform_company_purge_preview", [ids.A]);
  assert.equal(p.company.name, "شركة الحذف");
  assert.equal(p.counts.devices, 3);
  assert.equal(p.files.count, 3, "ملفات الشركة في الحاويتين فقط");
  const m = Object.fromEntries(p.members.map((x) => [x.email, x]));
  assert.equal(m["shared@x.invalid"].keep_reason, "other_company");
  assert.equal(m["t1@a.invalid"].removable, true);
  assert.equal(m["manager@a.invalid"].removable, true);
});

test("اسم تأكيد خاطئ يرفض ولا يحذف شيئًا", async () => {
  const before = await print(ids.A);
  assert.equal(await code(rpc(u.owner, "platform_purge_company", [ids.A, "شركة أخرى", true])), "22023");
  assert.equal(await code(rpc(u.owner, "platform_purge_company", [ids.A, "", true])), "22023");
  assert.deepEqual(await print(ids.A), before);
});

test("الحذف العادي للسجل التاريخي ما زال ممنوعًا خارج الحذف الكامل", async () => {
  assert.equal(await code(db.query("delete from public.maintenance_records where company_id = $1", [ids.A])), "42501");
  assert.equal(await code(db.query("delete from public.device_transfers where company_id = $1", [ids.A])), "42501");
});

test("الحذف الكامل: كل صفوف الشركة والحسابات الخاصة بها فقط، والشركة الأخرى كما هي", async () => {
  const keepB = await print(ids.B);
  const auditA = (await one("select count(*)::int n from public.company_audit_log where company_id = $1", [ids.A])).n;
  const r = await rpc(u.owner, "platform_purge_company", [ids.A, "  شركة الحذف ", true]);
  assert.equal(r.deleted_accounts, 2, "المدير والفني الخاصان بالشركة");
  assert.deepEqual(r.files.map((f) => f.name).sort(), [`${ids.A}/device-image/${ids.D1}/x.jpg`, `${ids.A}/logo.png`, `${ids.A}/visit/${ids.V}/a.jpg`].sort());
  for (const [t, v] of Object.entries(await print(ids.A))) {
    if (t === "company_audit_log") continue;
    assert.equal(v.n, 0, `${t} فارغ للشركة`);
  }
  assert.equal((await one("select count(*)::int n from public.companies where id = $1", [ids.A])).n, 0);
  assert.deepEqual(await print(ids.B), keepB, "الشركة الأخرى لم تتغير");
  const users = (await db.query("select email from auth.users order by email")).rows.map((x) => x.email);
  assert.deepEqual(users, ["manager@b.invalid", "owner@ays.invalid", "shared@x.invalid"]);
  // سجل التدقيق باقٍ مع قيد واحد للحذف (لا قيد لكل صف محذوف)
  const after = await db.query("select action from public.company_audit_log where company_id = $1 and created_at >= now() - interval '1 hour'", [ids.A]);
  assert.equal(after.rows.length, auditA + 1);
  assert.equal(after.rows.filter((x) => x.action === "company_purged").length, 1);
  const pa = await one("select details from public.platform_audit_log where action = 'company_purged'");
  assert.equal(pa.details.company.name, "شركة الحذف");
  assert.equal(pa.details.deleted.devices, 3);
  assert.equal(pa.details.deleted_account_emails.length, 2);
  assert.equal((await one("select count(*)::int n from app_private.device_tokens where company_id = $1", [ids.A])).n, 3, "رموز QR تبقى فلا تتكرر");
  assert.equal(await one("select current_setting('app.company_purge', true) s").then((x) => x.s ?? ""), "");
});

test("ملفات الشركة المحذوفة: المالك وحده يسردها ويحذفها، ولا يمس ملفات شركة قائمة", async () => {
  const list = await as(u.owner, "select * from public.platform_orphan_company_files(100)");
  assert.equal(list.length, 3);
  assert.ok(list.every((f) => f.name.startsWith(ids.A)));
  assert.equal(await code(as(u.mgrB, "select * from public.platform_orphan_company_files(100)")), "42501");
  assert.equal((await as(u.mgrB, "delete from storage.objects where name like $1 returning name", [`${ids.A}/%`])).length, 0);
  assert.equal((await as(u.owner, "delete from storage.objects where name like $1 returning name", [`${ids.B}/%`])).length, 0, "ملفات الشركة القائمة لا تُحذف");
  assert.equal((await as(u.owner, "delete from storage.objects where name like $1 returning name", [`${ids.A}/%`])).length, 3);
  assert.equal((await as(u.owner, "select * from public.platform_orphan_company_files(100)")).length, 0);
});

test("التراجع يعيد المنع ويزيل الدوال", async () => {
  await db.exec(read(...ROLLBACK));
  const r = await one("select to_regprocedure('public.platform_purge_company(uuid, text, boolean)') f, to_regprocedure('app_private.storage_company_gone(text)') g");
  assert.deepEqual(r, { f: null, g: null });
  assert.equal((await one("select count(*)::int n from pg_policies where policyname like 'ays_purged_company_files_%'")).n, 0);
  const src = await one("select string_agg(p.prosrc, ' ') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname in ('block_change', 'audit_row', 'audit_link')");
  assert.ok(!src.s.includes("company_purge"), "المشغلات بلا استثناء الحذف");
});
