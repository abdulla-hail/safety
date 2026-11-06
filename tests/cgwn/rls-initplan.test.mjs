// اختبار ترحيل 20261109000300 (تسريع سياسات القراءة) على PGlite: الصفوف المرئية لكل مستخدم في كل جدول متطابقة تمامًا
// قبل الترحيل وبعده، عبر سيناريوهات: مدير، محاسب، فني بإسناد عميل كامل، فني بمواقع محددة + أمر عمل وزيارة معيَّنين،
// فني بأمر عمل مؤرشف فقط، فني موقوف العضوية وإسناده باقٍ، عضو في شركتين، شركة موقوفة، ومالك المنصة.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MIGRATION = ["supabase", "migrations", "20261109000300_rls_initplan.sql"];
const ROLLBACK = ["supabase", "proposed", "20261109000300_rollback.sql"];
const TABLES = ["customers", "customer_sites", "devices", "device_maintenance_cycles", "visits", "work_orders", "maintenance_records", "device_faults",
  "visit_devices", "attachments"];
let db;
const u = {};
let before0;

async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ role: "authenticated", sub: uid })]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
}
const rpc = async (uid, fn, args) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args))[0].r;
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), $1, now()) returning id", [email])).rows[0].id;
}
async function visibility() {
  const out = {};
  for (const [name, uid] of Object.entries(u)) {
    out[name] = {};
    for (const t of TABLES) out[name][t] = (await as(uid, `select id::text from public.${t} order by id`)).map((r) => r.id);
  }
  return out;
}

async function company(name, prefix, techs) {
  const c = await rpc(u.owner, "platform_create_company", [name, `m@${prefix}.invalid`, null, null, null, 24]);
  u[`mgr_${prefix}`] ??= await user(`m@${prefix}.invalid`);
  await rpc(u[`mgr_${prefix}`], "accept_company_invitation", [c.token]);
  const tech = {};
  for (const [k, role] of techs) {
    u[k] ??= await user(`${k}@x.invalid`);
    const inv = await rpc(u[`mgr_${prefix}`], "company_invite_member", [c.company_id, `${k}@x.invalid`, role, k, null, null, 24]);
    await rpc(u[k], "accept_company_invitation", [inv.token]);
    tech[k] = (await db.query("select id from public.technicians where user_id = $1 and company_id = $2", [u[k], c.company_id])).rows[0]?.id;
  }
  // بيانات تشغيلية متسقة بلا مشغلات: 4 عملاء × موقعان × جهازان + جهاز بلا موقع، زيارة وأمر عمل لكل موقع (+ مؤرشف)، سجلات وبلاغات ودورات
  await db.exec(`set session_replication_role = replica;
    insert into public.customers (company_id, name, ref_no) select '${c.company_id}', 'عميل ' || g, '${prefix}C' || g from generate_series(1, 4) g;
    insert into public.customer_sites (company_id, customer_id, name, ref_no) select company_id, id, 'موقع ' || s, ref_no || 'S' || s from public.customers, generate_series(1, 2) s where company_id = '${c.company_id}';
    insert into public.devices (company_id, customer_id, site_id, name, ref_no, qr_token)
      select company_id, customer_id, id, 'جهاز', ref_no || 'D' || d, md5(random()::text) from public.customer_sites, generate_series(1, 2) d where company_id = '${c.company_id}';
    insert into public.devices (company_id, customer_id, site_id, name, ref_no, qr_token) select company_id, id, null, 'بلا موقع', ref_no || 'DX', md5(random()::text) from public.customers where company_id = '${c.company_id}';
    insert into public.visits (company_id, customer_id, site_id, scheduled_start, ref_no, archived_at)
      select company_id, customer_id, id, now(), ref_no || 'V' || a, case when a = 2 then now() end from public.customer_sites, generate_series(1, 2) a where company_id = '${c.company_id}';
    insert into public.work_orders (company_id, customer_id, site_id, title, ref_no, archived_at)
      select company_id, customer_id, id, 'أمر عمل', ref_no || 'W' || a, case when a = 2 then now() end from public.customer_sites, generate_series(1, 2) a where company_id = '${c.company_id}';
    insert into public.visit_devices (company_id, visit_id, device_id, customer_id, site_id)
      select v.company_id, v.id, d.id, v.customer_id, v.site_id from public.visits v join public.devices d on d.site_id = v.site_id where v.company_id = '${c.company_id}';
    insert into public.maintenance_records (id, company_id, device_id, customer_id, site_id, visit_id, action, result, status_after)
      select id, company_id, device_id, customer_id, site_id, visit_id, 'inspection', 'pass', 'operational' from public.visit_devices where company_id = '${c.company_id}';
    insert into public.maintenance_records (company_id, device_id, customer_id, site_id, action, result, status_after)
      select company_id, id, customer_id, site_id, 'inspection', 'pass', 'operational' from public.devices where company_id = '${c.company_id}';
    insert into public.work_order_devices (company_id, work_order_id, device_id)
      select w.company_id, w.id, d.id from public.work_orders w join public.devices d on d.site_id = w.site_id where w.company_id = '${c.company_id}';
    insert into public.device_faults (company_id, device_id, customer_id, site_id, work_order_id, description, ref_no)
      select w.company_id, d.device_id, w.customer_id, w.site_id, w.id, 'عطل اختبار', w.ref_no || 'F' || row_number() over () from public.work_orders w
      join public.work_order_devices d on d.work_order_id = w.id where w.company_id = '${c.company_id}';
    insert into public.device_faults (company_id, device_id, customer_id, site_id, description, ref_no)
      select company_id, id, customer_id, site_id, 'بلاغ بلا أمر', ref_no || 'F' from public.devices where company_id = '${c.company_id}';
    insert into public.device_maintenance_cycles (company_id, device_id, customer_id, site_id, due_date)
      select company_id, id, customer_id, site_id, current_date from public.devices where company_id = '${c.company_id}';
    insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, device_id)
      select company_id, 'device', id, company_id || '/device/' || id || '/a.jpg', 'a.jpg', id from public.devices where company_id = '${c.company_id}';
    set session_replication_role = origin;`);
  return { id: c.company_id, tech };
}
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];

before(async () => {
  db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.exec(read("tests", "cgwn", "storage-stub.sql"));
  for (const f of fs.readdirSync(path.join(root, "supabase", "migrations")).sort().filter((x) => x < MIGRATION.at(-1))) {
    await db.exec(read("supabase", "migrations", f).replace(/create extension if not exists pg_cron;[\s\S]*?end \$\$;/, ""));
  }
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  const A = await company("شركة أ", "a", [["t_full", "technician"], ["t_sites", "technician"], ["t_wo", "technician"], ["t_susp", "technician"],
    ["shared", "technician"], ["acc", "accountant"]]);
  const B = await company("شركة ب", "b", [["t_b", "technician"]]);
  u.mgr_shared_b = u.shared; // shared مدير؟ لا: عضو فني في الشركتين
  await rpc(u.mgr_b, "accept_company_invitation", [(await rpc(u.mgr_b, "company_invite_member", [B.id, "shared@x.invalid", "supervisor", "shared", null, null, 24])).token]).catch(() => {});
  const inv = await rpc(u.mgr_b, "company_invite_member", [B.id, "shared@x.invalid", "supervisor", "shared", null, null, 24]).catch(() => null);
  if (inv) await rpc(u.shared, "accept_company_invitation", [inv.token]);
  delete u.mgr_shared_b;
  const C = await company("شركة ج", "c", [["t_c", "technician"]]);

  const cust = async (co, n) => (await q1(`select id from public.customers where company_id = $1 and ref_no like '%C' || $2`, [co, String(n)])).id;
  const site = async (co, n, s) => (await q1(`select id from public.customer_sites where company_id = $1 and ref_no like '%C' || $2 || 'S' || $3`, [co, String(n), String(s)])).id;
  const tcs = async (co, tech, customer, sites = []) => {
    const id = (await q1("insert into public.technician_customers (company_id, technician_id, customer_id) values ($1, $2, $3) returning id", [co, tech, customer])).id;
    for (const s of sites) await db.query("insert into public.technician_customer_sites (company_id, assignment_id, site_id) values ($1, $2, $3)", [co, id, s]);
  };
  await db.exec("set session_replication_role = replica");
  await tcs(A.id, A.tech.t_full, await cust(A.id, 1));
  await tcs(A.id, A.tech.t_sites, await cust(A.id, 2), [await site(A.id, 2, 1)]);
  await tcs(A.id, A.tech.t_susp, await cust(A.id, 3));
  await tcs(A.id, A.tech.shared, await cust(A.id, 4), [await site(A.id, 4, 2)]);
  await tcs(B.id, B.tech.t_b, await cust(B.id, 1));
  await tcs(C.id, C.tech.t_c, await cust(C.id, 1));
  // أوامر عمل وزيارات معيَّنة: t_sites في عميل 3 (خارج نطاقه)، t_wo بأمر عمل مؤرشف وزيارة غير مؤرشفة في عميل 4
  const wo = async (co, n, s, archived) => (await q1(`select id from public.work_orders where company_id = $1 and ref_no like '%C' || $2 || 'S' || $3 || 'W' || $4`, [co, String(n), String(s), archived ? "2" : "1"])).id;
  const visit = async (co, n, s, archived) => (await q1(`select id from public.visits where company_id = $1 and ref_no like '%C' || $2 || 'S' || $3 || 'V' || $4`, [co, String(n), String(s), archived ? "2" : "1"])).id;
  await db.query("insert into public.work_order_technicians (company_id, work_order_id, technician_id) values ($1, $2, $3)", [A.id, await wo(A.id, 3, 1, false), A.tech.t_sites]);
  await db.query("insert into public.visit_technicians (company_id, visit_id, technician_id) values ($1, $2, $3)", [A.id, await visit(A.id, 3, 2, false), A.tech.t_sites]);
  await db.query("insert into public.work_order_technicians (company_id, work_order_id, technician_id) values ($1, $2, $3)", [A.id, await wo(A.id, 4, 1, true), A.tech.t_wo]);
  await db.query("insert into public.visit_technicians (company_id, visit_id, technician_id) values ($1, $2, $3)", [A.id, await visit(A.id, 4, 1, true), A.tech.t_wo]);
  await db.query("insert into public.visit_technicians (company_id, visit_id, technician_id) values ($1, $2, $3)", [A.id, await visit(A.id, 1, 1, false), A.tech.t_susp]);
  await db.query("update public.company_memberships set status = 'suspended' where user_id = $1", [u.t_susp]);
  await db.query("update public.companies set status = 'suspended' where id = $1", [C.id]);
  await db.exec("set session_replication_role = origin");
  before0 = await visibility();
});

test("السيناريوهات ليست شكلية: كل فئة ترى ما يخصها فقط", () => {
  const n = (k, t) => before0[k][t].length;
  assert.ok(n("mgr_a", "devices") > n("t_full", "devices") && n("t_full", "devices") > 0);
  assert.ok(n("t_sites", "devices") > 0 && n("t_sites", "devices") < n("t_full", "devices") + 4);
  assert.ok(n("t_sites", "work_orders") > 0 && n("t_wo", "visits") > 0 && n("t_wo", "work_orders") > 0);
  assert.equal(n("t_susp", "devices"), 0);
  assert.equal(n("mgr_c", "devices"), 0, "الشركة الموقوفة");
  assert.equal(n("owner", "devices"), 0);
  assert.ok(n("shared", "devices") > n("t_sites", "devices"), "عضو في شركتين يرى من الاثنتين");
});

test("بعد الترحيل: نفس الصفوف المرئية تمامًا لكل مستخدم وجدول", async () => {
  await db.exec(read(...MIGRATION));
  const after = await visibility();
  for (const k of Object.keys(before0)) for (const t of TABLES) assert.deepEqual(after[k][t], before0[k][t], `${k} / ${t}`);
});

test("السياسات الجديدة تُحسب مرة لكل استعلام (initplan) لا لكل صف", async () => {
  const plan = (await as(u.mgr_a, "explain select id from public.devices")).map((r) => r["QUERY PLAN"]).join("\n");
  assert.match(plan, /InitPlan/);
  assert.doesNotMatch(plan, /company_can_view_site/);
});

test("التراجع يعيد السياسات السابقة بالنتيجة نفسها", async () => {
  await db.exec(read(...ROLLBACK));
  const back = await visibility();
  for (const k of Object.keys(before0)) for (const t of TABLES) assert.deepEqual(back[k][t], before0[k][t], `${k} / ${t}`);
  assert.equal((await q1("select to_regprocedure('app_private.my_perm_companies(text)') f")).f, null);
});
