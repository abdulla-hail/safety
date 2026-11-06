// اختبار وظيفي لموقع الأجهزة ونقلها (ترحيل 20261102000100) على cgwn داخل معاملة يُتراجع عنها دائمًا.
// قبل التطبيق: node scripts/db/verify-cgwn-devices.mjs --with-migration supabase/migrations/20261102000100_device_location_transfers.sql
// بعد التطبيق: node scripts/db/verify-cgwn-devices.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

const mi = process.argv.indexOf("--with-migration");
const MIGRATION = mi > 0 ? fs.readFileSync(process.argv[mi + 1], "utf8") : null;

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, ok: !!cond, ...(cond ? {} : { detail: String(detail ?? "") }) });
let n = 0;
async function as(uid, sql, params = []) {
  const sp = `s${++n}`;
  await c.query(`savepoint ${sp}`);
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid ?? "", JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })]);
    await c.query(uid ? "set local role authenticated" : "set local role anon");
    const r = (await c.query(sql, params)).rows;
    await c.query("reset role");
    await c.query(`release savepoint ${sp}`);
    return { rows: r };
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return { error: e.message, code: e.code };
  }
}
const one = async (uid, sql, params) => { const r = await as(uid, sql, params); return { row: r.rows?.[0], error: r.error, code: r.code }; };
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
  return r.error ? { error: r.error, code: r.code } : { data: r.rows[0].r };
};
const count = async (uid, sql, params) => (await as(uid, sql, params)).rows?.length ?? -1;
const sys1 = async (sql, params) => (await c.query(sql, params)).rows[0];

const before = await fingerprint(c);
await c.query("begin");
try {
  if (MIGRATION) await c.query(MIGRATION);
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), sup = await mk("supervisor"), tech = await mk("tech"), stranger = await mk("stranger");
  const created = await rpc(owner, "platform_create_company", [`شركة نقل ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const co = created.data?.company_id;
  await rpc(mgr, "accept_company_invitation", [created.data?.token]);
  for (const [uid, email, role] of [[sup, "supervisor", "supervisor"], [tech, "tech", "technician"]]) {
    const inv = await rpc(mgr, "company_invite_member", [co, `${email}.${tag}@ays-test.invalid`, role, email, null, null, 24]);
    await rpc(uid, "accept_company_invitation", [inv.data?.token]);
  }
  const A = (await one(mgr, "insert into public.customers (company_id, name) values ($1, 'مستشفى أ') returning id", [co])).row?.id;
  const B = (await one(mgr, "insert into public.customers (company_id, name) values ($1, 'مصنع ب') returning id", [co])).row?.id;
  const site = async (cust, name) => (await one(mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, $3) returning id", [co, cust, name])).row?.id;
  const A1 = await site(A, "المبنى الرئيسي"), A2 = await site(A, "الفرع الشمالي"), B1 = await site(B, "المصنع");
  const t1 = (await one(mgr, "select id from public.technicians where company_id = $1 and user_id = $2", [co, tech])).row?.id;
  await as(mgr, "insert into public.technician_customers (company_id, technician_id, customer_id) values ($1, $2, $3)", [co, t1, A]);
  const sys = (await one(mgr, "select id from public.safety_systems where company_id = $1 order by sort_order limit 1", [co])).row?.id;
  ok("تجهيز: عميلان بثلاثة مواقع وفني مسند للعميل أ", !!(A1 && A2 && B1 && t1 && sys));

  // التسجيل
  ok("التسجيل: جهاز بلا موقع يُرفض", (await as(mgr, "insert into public.devices (company_id, customer_id, system_id, name) values ($1, $2, $3, 'بلا موقع')", [co, A, sys])).code === "23514");
  ok("التسجيل: موقع لعميل آخر يُرفض", (await as(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name) values ($1, $2, $3, $4, 'خطأ')", [co, A, sys, B1])).code === "23514");
  const dev = await one(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name, maintenance_interval_days) values ($1, $2, $3, $4, 'لوحة إنذار', 90) returning id, qr_token", [co, A, sys, A1]);
  ok("التسجيل: جهاز في موقع محدد", !!dev.row?.id, dev.error);
  const D = dev.row?.id;
  ok("التعديل المباشر لموقع الجهاز مرفوض (النقل فقط)", (await as(mgr, "update public.devices set site_id = $2 where id = $1", [D, A2])).code === "P0001");
  ok("التعديل المباشر لعميل الجهاز مرفوض", (await as(mgr, "update public.devices set customer_id = $2, site_id = $3 where id = $1", [D, B, B1])).code === "P0001");
  ok("تعديل بقية بيانات الجهاز ما زال متاحًا", (await as(mgr, "update public.devices set notes = 'ملاحظة' where id = $1 returning id", [D])).rows?.length === 1);

  // تاريخ في الموقع الأول
  const visit = await one(mgr, "insert into public.visits (company_id, customer_id, site_id, scheduled_start) values ($1, $2, $3, now()) returning id", [co, A, A1]);
  const mr = await one(mgr, `insert into public.maintenance_records (company_id, device_id, action, result, status_after, visit_id)
    values ($1, $2, 'inspection', 'pass', 'operational', $3) returning id, site_id`, [co, D, visit.row?.id]);
  ok("تجهيز: زيارة وسجل صيانة في الموقع الأول", mr.row?.site_id === A1, mr.error);

  // النقل داخل العميل
  ok("النقل: سبب قصير يُرفض", (await rpc(sup, "device_move", [D, A2, "x", null])).code === "22023");
  ok("النقل: إلى الموقع نفسه يُرفض", (await rpc(sup, "device_move", [D, A1, "نقل تجريبي", null])).code === "P0001");
  ok("النقل: تاريخ مستقبلي يُرفض", (await rpc(sup, "device_move", [D, A2, "نقل تجريبي", new Date(Date.now() + 864e5).toISOString()])).code === "22023");
  ok("النقل: الفني بلا صلاحية التعديل يُرفض", (await rpc(tech, "device_move", [D, A2, "نقل تجريبي", null])).code === "42501");
  ok("النقل: غريب يُرفض", (await rpc(stranger, "device_move", [D, A2, "نقل تجريبي", null])).code === "42501");
  const m1 = await rpc(sup, "device_move", [D, A2, "إعادة توزيع الأجهزة", null]);
  ok("النقل: المشرف ينقل الجهاز إلى فرع آخر للعميل نفسه", !m1.error, m1.error);
  const d1 = await sys1("select site_id, customer_id, qr_token from public.devices where id = $1", [D]);
  ok("النقل: الجهاز في الموقع الجديد بهويته ورمزه نفسيهما", d1.site_id === A2 && d1.customer_id === A && d1.qr_token === dev.row?.qr_token);
  const tr = await sys1("select from_site_id, to_site_id, reason, moved_by from public.device_transfers where id = $1", [m1.data]);
  ok("النقل: السجل يحفظ الموقع السابق والجديد والسبب والمنفّذ", tr?.from_site_id === A1 && tr?.to_site_id === A2 && tr?.moved_by === sup);
  ok("النقل: الزيارة السابقة باقية في موقعها الأصلي", (await sys1("select site_id from public.visits where id = $1", [visit.row?.id])).site_id === A1);
  ok("النقل: سجل الصيانة السابق باقٍ بموقعه الأصلي", (await sys1("select site_id from public.maintenance_records where id = $1", [mr.row?.id])).site_id === A1);
  ok("النقل: الفني المسند يرى سجل النقل داخل عميله", (await count(tech, "select id from public.device_transfers where device_id = $1", [D])) === 1);
  ok("النقل: الموقع القديم لا يتغير ولا تُنقل أجهزته تلقائيًا", (await sys1("select count(*)::int n from public.devices where site_id = $1", [A1])).n === 0
    && (await sys1("select archived_at from public.customer_sites where id = $1", [A1])).archived_at === null);

  // النقل إلى عميل آخر
  ok("النقل بين عميلين: المشرف دون صلاحية devices.transfer يُرفض", (await rpc(sup, "device_move", [D, B1, "بيع الجهاز للعميل ب", null])).code === "42501");
  const m2 = await rpc(mgr, "device_move", [D, B1, "نقل ملكية الجهاز إلى العميل ب", null]);
  ok("النقل بين عميلين: المدير ينقل", !m2.error, m2.error);
  ok("النقل بين عميلين: الجهاز صار للعميل ب", (await sys1("select customer_id from public.devices where id = $1", [D])).customer_id === B);
  ok("النقل بين عميلين: فني العميل السابق لم يعد يرى الجهاز", (await count(tech, "select id from public.devices where id = $1", [D])) === 0);
  ok("النقل بين عميلين: فني العميل السابق لا يرى نقل العميل الآخر", (await count(tech, "select id from public.device_transfers where id = $1", [m2.data])) === 0);
  ok("النقل بين عميلين: سجل صيانة العميل السابق يبقى بعميله", (await sys1("select customer_id from public.maintenance_records where id = $1", [mr.row?.id])).customer_id === A);
  ok("النقل بين عميلين: المدير يرى سجل النقل كاملًا", (await count(mgr, "select id from public.device_transfers where device_id = $1", [D])) === 2);

  // حماية السجل والمواقع
  ok("سجل النقل لا يُعدَّل", !!(await as(mgr, "update public.device_transfers set reason = 'تعديل' where device_id = $1", [D])).error);
  ok("سجل النقل لا يُحذف", !!(await as(mgr, "delete from public.device_transfers where device_id = $1", [D])).error);
  ok("سجل النقل لا يُكتب مباشرة من الواجهة", !!(await as(mgr, `insert into public.device_transfers (company_id, device_id, from_customer_id, to_customer_id, to_site_id, reason)
    values ($1, $2, $3, $3, $4, 'مزور')`, [co, D, B, B1])).error);
  ok("أرشفة موقع فيه جهاز نشط مرفوضة", (await as(mgr, "update public.customer_sites set archived_at = now() where id = $1", [B1])).code === "P0001");
  ok("أرشفة موقع فارغ مسموحة", (await as(mgr, "update public.customer_sites set archived_at = now() where id = $1 returning id", [A1])).rows?.length === 1);
  ok("النقل إلى موقع مؤرشف مرفوض", (await rpc(mgr, "device_move", [D, A1, "إعادة للموقع", null])).code === "P0001");
  ok("حذف موقع له تاريخ زيارات مرفوض", !!(await as(mgr, "delete from public.customer_sites where id = $1", [A1])).error);
} catch (e) {
  ok("تنفيذ الاختبار دون استثناء", false, e.message);
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
ok("البيانات القائمة لم تتغير بعد التراجع", JSON.stringify(after) === JSON.stringify(before));
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ withMigration: !!MIGRATION, passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : results.map((r) => r.name) }, null, 2));
if (failed.length) process.exitCode = 1;
