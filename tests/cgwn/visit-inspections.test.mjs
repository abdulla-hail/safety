// اختبار الترحيل المقترح 20261106000100 (تنفيذ الزيارة جهازًا جهازًا) على PGlite فوق كل الترحيلات السابقة:
// الزيارة الدورية والطارئة، منع التكرار، فصل النتيجة عن الحالة، الموعد القادم، الإغلاق والاستثناء، نطاق الفني، ثم التراجع.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261106000100_visit_inspections.sql"];
const ROLLBACK = ["supabase", "proposed", "20261106000100_rollback.sql"];
let db;
const u = {};
const ids = {};

async function base() {
  const d = new PGlite();
  await d.exec(read("tests", "cgwn", "current-schema.sql"));
  await d.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => x < MIGRATION.at(-1))) {
    // pg_cron غير متاح في PGlite: تُحذف خطوة جدولة المهمة فقط
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
const today = async () => (await one("select (now() at time zone 'Asia/Riyadh')::date::text d")).d;

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
  const [cust] = await as(u.mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [ids.co]);
  ids.cust = cust.id;
  for (const s of ["S1", "S2"]) {
    ids[s] = (await as(u.mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, $3) returning id", [ids.co, ids.cust, s]))[0].id;
  }
  const dev = async (name, site, next) => (await as(u.mgr,
    "insert into public.devices (company_id, customer_id, site_id, name, maintenance_interval_months, next_maintenance_at) values ($1, $2, $3, $4, 3, $5) returning id",
    [ids.co, ids.cust, site, name, next]))[0].id;
  const t = await today();
  ids.D1 = await dev("طفاية 1", ids.S1, (await one("select ($1::date - 5)::text d", [t])).d); // متأخر
  ids.D2 = await dev("طفاية 2", ids.S1, t);                                                  // مستحق اليوم
  ids.D3 = await dev("طفاية 3", ids.S2, null);
  // الفني 1: الموقع S1 فقط؛ الفني 2 بلا إسناد
  await rpc(u.mgr, "assignment_set", [ids.t1, ids.cust, [ids.S1], "اختبار"]);
});

test("بدء الزيارة الدورية: كل أجهزة الموقع، والاستئناف بدل التكرار، ومفتاح العميل", async () => {
  const k1 = crypto.randomUUID();
  ids.V1 = await rpc(u.t1, "visit_start", [k1, ids.S1, "periodic", null, null, null]);
  assert.equal(await rpc(u.t1, "visit_start", [k1, ids.S1, "periodic", null, null, null]), ids.V1, "إعادة الإرسال بالمفتاح نفسه");
  assert.equal(await rpc(u.t1, "visit_start", [crypto.randomUUID(), ids.S1, "periodic", null, null, null]), ids.V1, "زيارة دورية مفتوحة واحدة للموقع");
  const items = await as(u.t1, "select device_id, inspection_status, due_date::text, cycle_id from public.visit_devices where visit_id = $1 order by due_date", [ids.V1]);
  assert.deepEqual(items.map((i) => i.device_id).sort(), [ids.D1, ids.D2].sort());
  assert.ok(items.every((i) => i.inspection_status === "pending" && i.cycle_id));
  // إدخال زيارة دورية ثانية مباشرة للموقع نفسه مرفوض بالفهرس
  assert.equal(await code(as(u.mgr, "insert into public.visits (company_id, customer_id, site_id, scheduled_start, visit_type) values ($1, $2, $3, now(), 'periodic')", [ids.co, ids.cust, ids.S1])), "23505");
  const [{ n }] = await as(u.t1, "select count(*)::int n from public.visit_technicians where visit_id = $1", [ids.V1]);
  assert.equal(n, 1);
});

test("نطاق الفني: لا بدء ولا رؤية ولا تعديل خارج مواقع إسناده", async () => {
  assert.equal(await code(rpc(u.t1, "visit_start", [crypto.randomUUID(), ids.S2, "periodic", null, null, null])), "42501");
  assert.equal(await code(rpc(u.t2, "visit_start", [crypto.randomUUID(), ids.S1, "periodic", null, null, null])), "42501");
  assert.equal((await as(u.t2, "select id from public.visit_devices where visit_id = $1", [ids.V1])).length, 0);
  const [item] = await as(u.t1, "select id from public.visit_devices where visit_id = $1 limit 1", [ids.V1]);
  assert.equal(await code(rpc(u.t2, "visit_save_item", [item.id, { inspection_status: "pending" }, null])), "42501");
  // لا كتابة مباشرة على البنود
  assert.equal(await code(as(u.t1, "update public.visit_devices set notes = 'x' where visit_id = $1", [ids.V1])), "42501");
  // زيارة موقع آخر أنشأها المدير: الفني لا يعدّلها (RLS)
  ids.VS2 = await rpc(u.mgr, "visit_start", [crypto.randomUUID(), ids.S2, "periodic", null, null, null]);
  assert.equal((await as(u.t1, "update public.visits set notes = 'x' where id = $1 returning id", [ids.VS2])).length, 0);
});

test("حفظ البند: التحقق، والمسودة، والإصدار يمنع الكتابة المتزامنة", async () => {
  const items = await as(u.t1, "select id, device_id, version from public.visit_devices where visit_id = $1", [ids.V1]);
  ids.I1 = items.find((i) => i.device_id === ids.D1).id;
  ids.I2 = items.find((i) => i.device_id === ids.D2).id;
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I1, { inspection_status: "inspected" }, 1])), "22023", "مفحوص بلا نتيجة");
  const v2 = await rpc(u.t1, "visit_save_item", [ids.I1, {
    inspection_status: "inspected", result: "pass_with_notes", status_after: "operational", readings: { "الضغط": "12 بار" },
    parts: [{ name: "حلقة إحكام", qty: 1 }], recommendations: "تغيير الخرطوم قريبًا" }, 1]);
  assert.equal(v2, 2);
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I1, { inspection_status: "inspected", result: "pass", status_after: "operational" }, 1])), "40001");
  assert.equal(await rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "pending", notes: "مسودة" }, 1]), 2);
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "unable" }, 2])), "22023", "تعذر الفحص بلا سبب");
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "pending", next_due_override: "2030-01-01", next_due_reason: "طلب العميل" }, 2])), "42501", "الفني لا يعدّل الموعد");
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "pending", parts: [{ qty: 1 }] }, 2])), "22023");
  const [r] = await as(u.t1, "select notes, result from public.visit_devices where id = $1", [ids.I2]);
  assert.equal(r.notes, "مسودة");
  // الحالة التشغيلية للجهاز لم تتغير بمجرد الحفظ
  assert.equal((await one("select status from public.devices where id = $1", [ids.D1])).status, "operational");
});

test("الإغلاق: يُمنع مع جهاز بلا نتيجة إلا باستثناء مصرَّح، ولا يُحتسب غير المفحوص", async () => {
  assert.equal(await code(rpc(u.t1, "visit_close", [ids.V1, null, null])), "P0001");
  assert.equal(await code(rpc(u.t1, "visit_close", [ids.V1, "انتهى وقت الزيارة", null])), "42501", "الفني لا يملك الاستثناء");
  await rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "unable", skip_reason: "الغرفة مغلقة" }, 2]);
  const t = await today();
  const res = await rpc(u.t1, "visit_close", [ids.V1, null, "تمت الزيارة"]);
  assert.equal(res.outcome, "completed_with_issues");
  assert.equal(res.inspected, 1);
  const recs = await one("select count(*)::int n, min(kind) kind, min(id::text) id from public.maintenance_records where visit_id = $1", [ids.V1]);
  assert.equal(recs.n, 1, "سجل صيانة للجهاز المفحوص فقط");
  assert.equal(recs.kind, "periodic");
  assert.equal(recs.id, ids.I1);
  const d1 = await one("select next_maintenance_at::text n, last_maintenance_at::text l from public.devices where id = $1", [ids.D1]);
  assert.equal(d1.n, (await one("select app_private.add_months($1::date, 3)::text d", [t])).d, "الموعد القادم من تاريخ التنفيذ الفعلي + الفترة");
  assert.equal(d1.l, t);
  const d2 = await one("select next_maintenance_at::text n from public.devices where id = $1", [ids.D2]);
  assert.equal(d2.n, t, "الجهاز غير المفحوص يبقى مستحقًا");
  assert.equal((await one("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [ids.D2])).n, 1);
  const log = await one("select source, old_date::text o, new_date::text n from public.device_due_changes where device_id = $1", [ids.D1]);
  assert.equal(log.source, "maintenance");
  assert.equal(log.n, d1.n);
  // تكرار الإغلاق آمن
  assert.equal((await rpc(u.t1, "visit_close", [ids.V1, null, null])).already_closed, true);
  assert.equal((await one("select count(*)::int n from public.maintenance_records where visit_id = $1", [ids.V1])).n, 1);
});

test("بعد الإغلاق: لا تعديل للبنود أو الزيارة ولا صور جديدة", async () => {
  assert.equal(await code(rpc(u.t1, "visit_save_item", [ids.I2, { inspection_status: "pending" }, null])), "P0001");
  assert.equal(await code(as(u.mgr, "update public.visits set summary = 'تغيير صامت' where id = $1", [ids.V1])), "P0001");
  assert.equal(await code(as(u.mgr, "insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name) values ($1, 'visit', $2, $3, 'a.jpg')",
    [ids.co, ids.V1, `${ids.co}/visit/${ids.V1}/a.jpg`])), "P0001");
  // لا سجل صيانة مباشر بلا زيارة
  assert.equal(await code(as(u.t1, "insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'inspection', 'pass', 'operational')",
    [ids.co, ids.D2])), "P0001");
  // الأرشفة ما زالت ممكنة
  assert.equal(await code(as(u.mgr, "update public.visits set follow_up_status = 'done' where id = $1", [ids.V1])), null);
});

test("الزيارة الطارئة: سجل تصحيحي لا يمس الموعد الدوري، ومتابعة بمسؤول وتاريخ", async () => {
  const before = await one("select next_maintenance_at::text n from public.devices where id = $1", [ids.D1]);
  assert.equal(await code(rpc(u.t1, "visit_start", [crypto.randomUUID(), ids.S1, "emergency", null, [ids.D1], null])), "22023", "السبب مطلوب");
  assert.equal(await code(rpc(u.t1, "visit_start", [crypto.randomUUID(), ids.S1, "emergency", "fault", [ids.D3], null])), "23514", "جهاز من موقع آخر");
  const V = await rpc(u.t1, "visit_start", [crypto.randomUUID(), ids.S1, "emergency", "fault", [ids.D1], "بلاغ العميل"]);
  await rpc(u.t1, "visit_add_devices", [V, [ids.D2]]);
  const items = await as(u.t1, "select id, device_id from public.visit_devices where visit_id = $1", [V]);
  const i1 = items.find((i) => i.device_id === ids.D1).id;
  const i2 = items.find((i) => i.device_id === ids.D2).id;
  await rpc(u.t1, "visit_remove_device", [i2]);
  const tomorrow = (await one("select ($1::date + 1)::text d", [await today()])).d;
  assert.equal(await code(rpc(u.t1, "visit_save_item", [i1, { inspection_status: "inspected", result: "fail", status_after: "faulty",
    next_due_override: "2030-01-01", next_due_reason: "تأجيل" }, 1])), "P0001", "الطارئة لا تغيّر الموعد");
  assert.equal(await code(rpc(u.t1, "visit_save_item", [i1, { inspection_status: "inspected", result: "fail", status_after: "faulty", follow_up_needed: true }, 1])), "22023");
  await rpc(u.t1, "visit_save_item", [i1, { inspection_status: "inspected", action: "repair", result: "fail", status_after: "faulty",
    findings: "تسرب في الصمام", resolved: false, follow_up_needed: true, follow_up_technician_id: ids.t1, follow_up_due: tomorrow }, 1]);
  const res = await rpc(u.t1, "visit_close", [V, null, null]);
  assert.equal(res.outcome, "follow_up_required");
  const rec = await one("select kind, result, status_after, findings from public.maintenance_records where visit_id = $1", [V]);
  assert.deepEqual(rec, { kind: "corrective", result: "fail", status_after: "faulty", findings: "تسرب في الصمام" });
  const d = await one("select next_maintenance_at::text n, status from public.devices where id = $1", [ids.D1]);
  assert.equal(d.n, before.n, "الموعد الدوري لم يتغير");
  assert.equal(d.status, "faulty", "الحالة التشغيلية تتبع آخر فحص");
  const f = await one("select kind, status, assigned_technician_id, follow_up_due::text due, visit_id from public.device_faults where device_id = $1", [ids.D1]);
  assert.deepEqual(f, { kind: "repair_request", status: "open", assigned_technician_id: ids.t1, due: tomorrow, visit_id: V });
  // سجل الزيارة الدورية السابقة لم يتغير بتغير الحالة
  assert.equal((await one("select status_after from public.maintenance_records where id = $1", [ids.I1])).status_after, "operational");
});

test("تعديل الموعد: مباشرةً مرفوض، وبالإجراء بصلاحية وسبب مع سجل القديم والجديد", async () => {
  assert.equal(await code(as(u.mgr, "update public.devices set next_maintenance_at = '2031-01-01' where id = $1", [ids.D3])), "P0001");
  assert.equal(await code(rpc(u.t1, "device_set_next_due", [ids.D1, "2031-01-01", "طلب العميل"])), "42501");
  assert.equal(await code(rpc(u.mgr, "device_set_next_due", [ids.D1, "2031-01-01", "قصير"])), "22023");
  const old = (await one("select next_maintenance_at::text n from public.devices where id = $1", [ids.D1])).n;
  await rpc(u.mgr, "device_set_next_due", [ids.D1, "2031-01-01", "طلب العميل تأجيل الموعد"]);
  const log = await one("select source, old_date::text o, new_date::text n, reason, changed_by from public.device_due_changes where device_id = $1 and source = 'manual'", [ids.D1]);
  assert.deepEqual(log, { source: "manual", o: old, n: "2031-01-01", reason: "طلب العميل تأجيل الموعد", changed_by: u.mgr });
  assert.equal(await code(as(u.mgr, "delete from public.device_due_changes")), "42501");
  // تطبيق جدول جديد بإعادة الحساب يمر ويُسجَّل
  await rpc(u.mgr, "devices_set_schedule", [[ids.D3], 6, null, true]);
  assert.equal((await one("select source from public.device_due_changes where device_id = $1", [ids.D3])).source, "schedule");
});

test("الاستثناء: المدير يغلق زيارة ناقصة بسبب، وتُحسب «غير مكتملة» دون سجل للجهاز غير المفحوص", async () => {
  const res = await rpc(u.mgr, "visit_close", [ids.VS2, "تعذر دخول الموقع اليوم", null]);
  assert.equal(res.outcome, "incomplete");
  assert.equal((await one("select count(*)::int n from public.maintenance_records where visit_id = $1", [ids.VS2])).n, 0);
  const v = await one("select close_exception_reason r, closed_by from public.visits where id = $1", [ids.VS2]);
  assert.deepEqual(v, { r: "تعذر دخول الموقع اليوم", closed_by: u.mgr });
  const a = await one("select action, details->>'outcome' o from public.company_audit_log where target_id = $1 and action = 'visit_closed'", [ids.VS2]);
  assert.deepEqual(a, { action: "visit_closed", o: "incomplete" });
});

test("حساب الموعد في الواجهة مطابق لـ compute_next_due في القاعدة", async () => {
  const { computeNextDue } = await import("../../src/lib/visits.ts");
  const cases = [];
  for (const start of ["2026-01-31", "2026-03-15", "2027-11-30"]) for (const months of [1, 3, 12, null]) for (const policy of ["from_completion", "fixed"])
    for (const done of [null, "2026-02-28", "2026-05-31", "2028-02-29"]) cases.push({ start, months, days: months ? null : 90, policy, done, currentDue: "2026-04-30" });
  for (const c of cases) {
    const sql = (await one("select app_private.compute_next_due($1::date, $2, $3, $4, $5::date, $6::date)::text d", [c.start, c.months, c.days, c.policy, c.done, c.currentDue])).d;
    assert.equal(computeNextDue(c), sql, JSON.stringify(c));
  }
});

test("التراجع يرفض عند وجود بيانات الزيارات الجديدة، وينجح على قاعدة بلا بيانات", async () => {
  if (!fs.existsSync(path.join(root, ...ROLLBACK))) return;
  assert.match(String(await code(db.exec(read(...ROLLBACK)))), /التراجع مرفوض|P0001/);
  const clean = await base();
  await clean.exec(read(...MIGRATION));
  await clean.exec(read(...ROLLBACK));
  const t = await clean.query("select to_regclass('public.visit_devices') v, to_regclass('public.device_due_changes') d");
  assert.deepEqual(t.rows[0], { v: null, d: null });
  const col = await clean.query("select count(*)::int n from information_schema.columns where table_name = 'visits' and column_name in ('client_key', 'closed_at')");
  assert.equal(col.rows[0].n, 0);
  await clean.close();
});
