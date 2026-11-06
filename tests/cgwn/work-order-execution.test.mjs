// اختبار ترحيل 20261108000100 على PGlite فوق كل الترحيلات السابقة: أمر عمل مسند ← بدء الزيارة ← تقرير وملاحظات ←
// بلاغ أثناء الزيارة ← صور مصنفة وحذفها بالصلاحية ← الإغلاق يُكمل الأمر ← تجميد بعد الإغلاق ← التراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261108000100_work_order_execution.sql"];
const ROLLBACK = ["supabase", "proposed", "20261108000100_rollback.sql"];
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

before(async () => {
  db = await base();
  await db.exec(read(...MIGRATION));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const c = await rpc(u.owner, "platform_create_company", ["شركة أ", "manager@a.invalid", null, null, null, 24]);
  ids.co = c.company_id;
  u.mgr = await user("manager@a.invalid");
  await rpc(u.mgr, "accept_company_invitation", [c.token]);
  for (const k of ["t1", "t2"]) {
    const inv = await rpc(u.mgr, "company_invite_member", [ids.co, `${k}@a.invalid`, "technician", `فني ${k}`, null, null, 24]);
    u[k] = await user(`${k}@a.invalid`);
    await rpc(u[k], "accept_company_invitation", [inv.token]);
    ids[k] = (await one("select id from public.technicians where user_id = $1", [u[k]])).id;
  }
  ids.cust = (await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]))[0].id;
  ids.S1 = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'S1') returning id", [ids.co, ids.cust]))[0].id;
  const dev = async (name) => (await as(u.mgr, "insert into public.devices (company_id, customer_id, site_id, name, maintenance_interval_months) values ($1, $2, $3, $4, 3) returning id",
    [ids.co, ids.cust, ids.S1, name]))[0].id;
  ids.D1 = await dev("لوحة إنذار");
  ids.D2 = await dev("طفاية");
  // t1 مسند للعميل؛ t2 غير مسند للعميل لكنه سيُعيَّن لأمر العمل
  await rpc(u.mgr, "assignment_set", [ids.t1, ids.cust, null, "اختبار"]);
  ids.WO = (await as(u.mgr, "insert into public.work_orders (company_id, customer_id, site_id, title, order_type, priority, status) values ($1, $2, $3, 'عطل لوحة الإنذار', 'emergency', 'high', 'new') returning id",
    [ids.co, ids.cust, ids.S1]))[0].id;
  await as(u.mgr, "insert into public.work_order_devices (work_order_id, device_id, company_id) values ($1, $2, $3)", [ids.WO, ids.D1, ids.co]);
  await as(u.mgr, "insert into public.work_order_technicians (work_order_id, technician_id, company_id) values ($1, $2, $3)", [ids.WO, ids.t2, ids.co]);
});

test("الفني المعيَّن يرى أمر العمل وعميله وموقعه وأجهزته حتى خارج نطاق إسناده", async () => {
  assert.equal((await as(u.t2, "select id from public.work_orders where id = $1", [ids.WO])).length, 1);
  assert.equal((await as(u.t2, "select name from public.customers where id = $1", [ids.cust])).length, 1);
  assert.equal((await as(u.t2, "select name from public.customer_sites where id = $1", [ids.S1])).length, 1);
  const devs = await as(u.t2, "select id from public.devices where site_id = $1", [ids.S1]);
  assert.deepEqual(devs.map((d) => d.id), [ids.D1], "أجهزة الأمر فقط، لا كل أجهزة الموقع");
});

test("بدء الزيارة من أمر العمل: للمعيَّن فقط، وبلا تكرار، وبأجهزة الأمر ونوعه", async () => {
  assert.equal(await code(rpc(u.t1, "work_order_start_visit", [ids.WO, crypto.randomUUID()])), "42501", "فني العميل غير المعيَّن للأمر لا يبدأه");
  const key = crypto.randomUUID();
  ids.V = await rpc(u.t2, "work_order_start_visit", [ids.WO, key]);
  assert.equal(await rpc(u.t2, "work_order_start_visit", [ids.WO, key]), ids.V);
  assert.equal(await rpc(u.t2, "work_order_start_visit", [ids.WO, crypto.randomUUID()]), ids.V, "زيارة مفتوحة واحدة للأمر");
  const v = await one("select visit_type, urgent_reason, work_order_id, status from public.visits where id = $1", [ids.V]);
  assert.deepEqual(v, { visit_type: "emergency", urgent_reason: "fault", work_order_id: ids.WO, status: "in_progress" });
  assert.equal((await one("select status from public.work_orders where id = $1", [ids.WO])).status, "in_progress");
  const items = await as(u.t2, "select device_id from public.visit_devices where visit_id = $1", [ids.V]);
  assert.deepEqual(items.map((i) => i.device_id), [ids.D1]);
  assert.equal((await as(u.t2, "select id from public.visits where id = $1", [ids.V])).length, 1, "الفني يرى زيارته");
});

test("تقرير الزيارة وملاحظات الفني: حفظ تدريجي واستئناف", async () => {
  await rpc(u.t2, "visit_save_report", [ids.V, "مسودة أولى", "ملاحظة", null]);
  await rpc(u.t2, "visit_save_report", [ids.V, "تقرير محدث", "ملاحظات الفني", "استبدال البطارية"]);
  const v = await one("select summary, technician_notes, recommendations from public.visits where id = $1", [ids.V]);
  assert.deepEqual(v, { summary: "تقرير محدث", technician_notes: "ملاحظات الفني", recommendations: "استبدال البطارية" });
  assert.equal(await code(rpc(u.t1, "visit_save_report", [ids.V, "x", null, null])), "42501");
});

test("بلاغ عطل أثناء الزيارة: مرتبط بالأمر والزيارة والجهاز، وبلا تكرار", async () => {
  const key = crypto.randomUUID();
  assert.equal(await code(rpc(u.t2, "visit_report_fault", [ids.V, ids.D1, key, "تسرب", "high", "awaiting_verification", "", null])), "22023", "الإصلاح يحتاج إجراء");
  ids.F = await rpc(u.t2, "visit_report_fault", [ids.V, ids.D1, key, "بطارية اللوحة تالفة", "high", "awaiting_verification", "استبدال البطارية", "فحص بعد أسبوع"]);
  assert.equal(await rpc(u.t2, "visit_report_fault", [ids.V, ids.D1, key, "تكرار", "low", "open", null, null]), ids.F);
  const f = await one("select work_order_id, visit_id, customer_id, site_id, device_id, severity, status, action_taken, recommendation, resolution from public.device_faults where id = $1", [ids.F]);
  assert.deepEqual(f, { work_order_id: ids.WO, visit_id: ids.V, customer_id: ids.cust, site_id: ids.S1, device_id: ids.D1, severity: "high",
    status: "awaiting_verification", action_taken: "استبدال البطارية", recommendation: "فحص بعد أسبوع", resolution: "استبدال البطارية" });
  assert.equal((await one("select count(*)::int n from public.device_fault_events where fault_id = $1", [ids.F])).n, 2);
  assert.equal((await as(u.t2, "select id from public.device_faults where id = $1", [ids.F])).length, 1, "الفني يرى بلاغه");
  // جهاز آخر في الموقع يُضاف لبنود الزيارة عند الإبلاغ عنه
  await rpc(u.t2, "visit_report_fault", [ids.V, ids.D2, crypto.randomUUID(), "خرطوم متشقق", "medium", "open", null, null]);
  assert.equal((await one("select count(*)::int n from public.visit_devices where visit_id = $1", [ids.V])).n, 2);
});

test("الصور: تصنيف مقيد، وحذف المحفوظ لرافعه قبل الإغلاق فقط، والملف يُزال بعد حذف سجله", async () => {
  const att = async (uid, stage, dev, name) => (await as(uid, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, photo_stage, device_id)
    values ($1, 'visit', $2, $3, $4, $5, $6) returning id`, [ids.co, ids.V, `${ids.co}/visit/${ids.V}/${name}`, name, stage, dev]))[0].id;
  assert.equal(await code(att(u.t2, "bogus", null, "x.jpg")), "23514");
  ids.A1 = await att(u.t2, "fault", ids.D1, "fault.jpg");
  ids.A2 = await att(u.t2, "general", null, "general.jpg");
  ids.A3 = await att(u.t2, "after", ids.D1, "after.jpg");
  await db.query("insert into storage.buckets (id, name) values ('org-files', 'org-files') on conflict do nothing");
  await db.query("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [`${ids.co}/visit/${ids.V}/general.jpg`]);
  const p = `${ids.co}/visit/${ids.V}/general.jpg`;
  assert.equal(await code(rpc(u.t1, "attachment_delete", [ids.A2])), "42501", "فني آخر لا يحذف");
  assert.equal((await as(u.t1, "delete from storage.objects where name = $1 returning name", [p])).length, 0, "ولا يزيل ملفه من التخزين");
  assert.equal((await as(u.t2, "delete from storage.objects where name = $1 returning name", [p])).length, 1, "الرافع يزيل الملف أولًا");
  assert.equal(await rpc(u.t2, "attachment_delete", [ids.A2]), p, "ثم يُحذف السجل");
  assert.equal((await one("select count(*)::int n from public.company_audit_log where action = 'attachment_deleted' and target_id = $1", [ids.A2])).n, 1);
});

test("الإغلاق يُكمل أمر العمل، ثم تُجمَّد الزيارة: لا تقرير ولا بلاغ ولا حذف صورة إلا بصلاحية الحذف", async () => {
  for (const it of await as(u.t2, "select id, version from public.visit_devices where visit_id = $1", [ids.V])) {
    await rpc(u.t2, "visit_save_item", [it.id, { inspection_status: "inspected", action: "repair", result: "pass_with_notes", status_after: "operational" }, it.version]);
  }
  const res = await rpc(u.t2, "visit_close", [ids.V, null, null]);
  assert.equal(res.inspected, 2);
  const w = await one("select status, completed_at is not null done from public.work_orders where id = $1", [ids.WO]);
  assert.deepEqual(w, { status: "completed", done: true });
  assert.equal((await as(u.t2, "select id from public.maintenance_records where visit_id = $1", [ids.V])).length, 2, "الفني يرى سجلات زيارته");
  assert.equal(await code(rpc(u.t2, "visit_save_report", [ids.V, "تعديل", null, null])), "P0001");
  assert.equal(await code(rpc(u.t2, "visit_report_fault", [ids.V, ids.D1, crypto.randomUUID(), "بعد الإغلاق", "low", "open", null, null])), "P0001");
  assert.equal(await code(rpc(u.t2, "attachment_delete", [ids.A1])), "42501", "صورة زيارة مغلقة لا يحذفها الفني");
  assert.ok(await rpc(u.mgr, "attachment_delete", [ids.A3]), "المدير (visits.delete) يحذف بتدقيق");
  assert.equal(await code(rpc(u.t2, "work_order_start_visit", [ids.WO, crypto.randomUUID()])), "P0001", "أمر مكتمل لا تُبدأ له زيارة");
});

test("التراجع يرفض مع بيانات الترحيل، وينجح على قاعدة بلا بيانات", async () => {
  if (!fs.existsSync(path.join(root, ...ROLLBACK))) return;
  assert.match(String(await code(db.exec(read(...ROLLBACK)))), /P0001|التراجع مرفوض/);
  const clean = await base();
  await clean.exec(read(...MIGRATION));
  await clean.exec(read(...ROLLBACK));
  const r = await clean.query("select to_regprocedure('public.work_order_start_visit(uuid, uuid)') f, (select count(*)::int from information_schema.columns where table_name = 'visits' and column_name = 'technician_notes') c");
  assert.deepEqual(r.rows[0], { f: null, c: 0 });
  await clean.close();
});
