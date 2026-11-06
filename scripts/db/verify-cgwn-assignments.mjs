// اختبار وظيفي لنطاق الإسناد وتاريخه والفني الأساسي وحماية المرفقات (ترحيل 20261103000100) على cgwn داخل معاملة يُتراجع عنها دائمًا.
// قبل التطبيق: node scripts/db/verify-cgwn-assignments.mjs --with-migration supabase/migrations/20261103000100_assignment_scope_history.sql
// بعد التطبيق: node scripts/db/verify-cgwn-assignments.mjs
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
const ids = async (uid, sql, params) => ((await as(uid, sql, params)).rows ?? []).map((r) => r.id).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const before = await fingerprint(c);
await c.query("begin");
try {
  if (MIGRATION) await c.query(MIGRATION);
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), u1 = await mk("tech1"), u2 = await mk("tech2"), u3 = await mk("tech3");
  const created = await rpc(owner, "platform_create_company", [`شركة إسناد ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const co = created.data?.company_id;
  await rpc(mgr, "accept_company_invitation", [created.data?.token]);
  for (const [uid, email] of [[u1, "tech1"], [u2, "tech2"], [u3, "tech3"]]) {
    const inv = await rpc(mgr, "company_invite_member", [co, `${email}.${tag}@ays-test.invalid`, "technician", email, null, null, 24]);
    await rpc(uid, "accept_company_invitation", [inv.data?.token]);
  }
  const tech = async (uid) => (await one(mgr, "select id from public.technicians where company_id = $1 and user_id = $2", [co, uid])).row?.id;
  const [T1, T2, T3] = [await tech(u1), await tech(u2), await tech(u3)];
  const ins = async (sql, p) => (await one(mgr, sql, p)).row?.id;
  const A = await ins("insert into public.customers (company_id, name) values ($1, 'مستشفى أ') returning id", [co]);
  const B = await ins("insert into public.customers (company_id, name) values ($1, 'مصنع ب') returning id", [co]);
  const site = (cust, name) => ins("insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, $3) returning id", [co, cust, name]);
  const A1 = await site(A, "المبنى أ1"), A2 = await site(A, "المبنى أ2"), B1 = await site(B, "المصنع");
  const sys = (await one(mgr, "select id from public.safety_systems where company_id = $1 order by sort_order limit 1", [co])).row?.id;
  const dev = (cust, s, name) => ins("insert into public.devices (company_id, customer_id, system_id, site_id, name) values ($1, $2, $3, $4, $5) returning id", [co, cust, sys, s, name]);
  const dA1 = await dev(A, A1, "جهاز أ1"), dA2 = await dev(A, A2, "جهاز أ2"), dB = await dev(B, B1, "جهاز ب");
  const visit = (cust, s) => ins("insert into public.visits (company_id, customer_id, site_id, scheduled_start) values ($1, $2, $3, now()) returning id", [co, cust, s]);
  const vA1 = await visit(A, A1), vA2 = await visit(A, A2), vA0 = await visit(A, null);
  const mr = (d) => ins("insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'inspection', 'pass', 'operational') returning id", [co, d]);
  const mA1 = await mr(dA1), mA2 = await mr(dA2);
  const att = (d) => ins(`insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name) values ($1, 'device', $2, $3, 'صورة.jpg') returning id`,
    [co, d, `${co}/device/${d}/${tag}-${Math.random().toString(36).slice(2)}.jpg`]);
  const fA1 = await att(dA1), fA2 = await att(dA2), fB = await att(dB);
  ok("تجهيز: عميلان، ثلاثة مواقع، أجهزة وزيارات وصيانة ومرفقات", !!(T1 && T2 && T3 && dA1 && dA2 && dB && vA0 && mA2 && fB));

  // الإسناد
  ok("الإسناد: العميل كاملًا للفني 1", !(await rpc(mgr, "assignment_set", [T1, A, null, null])).error);
  const a2 = await rpc(mgr, "assignment_set", [T2, A, [A1], "تغطية المبنى أ1"]);
  ok("الإسناد: الفني 2 لموقع أ1 فقط", !a2.error, a2.error);
  ok("الإسناد: موقع لعميل آخر يُرفض", (await rpc(mgr, "assignment_set", [T3, A, [B1], null])).code === "23514");
  ok("الإسناد: الفني لا يُسند", (await rpc(u1, "assignment_set", [T3, A, null, null])).code === "42501");
  ok("الإسناد: لا كتابة مباشرة في نطاق المواقع", !!(await as(mgr, "insert into public.technician_customer_sites (assignment_id, site_id, company_id) values ($1, $2, $3)", [a2.data, A2, co])).error);
  const ev = async (t) => (await c.query("select event from public.technician_assignment_events where technician_id = $1 order by occurred_at, event", [t])).rows.map((r) => r.event);
  ok("السجل: أحداث الإسناد ونطاق الموقع محفوظة", same(await ev(T2), ["assigned", "site_added"]) && same(await ev(T1), ["assigned"]), JSON.stringify(await ev(T2)));

  // الرؤية
  ok("الرؤية: فني الموقع يرى العميل", same(await ids(u2, "select id from public.customers where company_id = $1", [co]), [A]));
  ok("الرؤية: فني الموقع يرى موقعه فقط", same(await ids(u2, "select id from public.customer_sites where company_id = $1", [co]), [A1]));
  ok("الرؤية: فني الموقع يرى أجهزة موقعه فقط", same(await ids(u2, "select id from public.devices where company_id = $1", [co]), [dA1]));
  ok("الرؤية: فني الموقع يرى زيارات موقعه فقط (لا زيارات بلا موقع)", same(await ids(u2, "select id from public.visits where company_id = $1", [co]), [vA1]));
  ok("الرؤية: فني الموقع يرى صيانة موقعه فقط", same(await ids(u2, "select id from public.maintenance_records where company_id = $1", [co]), [mA1]));
  ok("الرؤية: فني الموقع يرى مرفقات أجهزته فقط", same(await ids(u2, "select id from public.attachments where company_id = $1", [co]), [fA1]));
  ok("الرؤية: فني العميل كاملًا يرى كل مواقع العميل وزياراته", same(await ids(u1, "select id from public.visits where company_id = $1", [co]), [vA1, vA2, vA0])
    && same(await ids(u1, "select id from public.devices where company_id = $1", [co]), [dA1, dA2]));
  ok("الرؤية: فني العميل لا يرى عميلًا آخر ولا مرفقاته", same(await ids(u1, "select id from public.attachments where company_id = $1", [co]), [fA1, fA2]));
  ok("الرؤية: فني بلا إسناد لا يرى شيئًا ولا مرفقات", (await ids(u3, "select id from public.devices where company_id = $1", [co])).length === 0
    && (await ids(u3, "select id from public.attachments where company_id = $1", [co])).length === 0);
  ok("الرؤية: المدير يرى كل شيء", (await ids(mgr, "select id from public.attachments where company_id = $1", [co])).length === 3);
  const qr = async (uid, d) => (await rpc(uid, "resolve_device_token", [(await c.query("select qr_token from public.devices where id = $1", [d])).rows[0].qr_token])).data?.status;
  ok("QR: فني الموقع يفتح جهاز موقعه ويُمنع من غيره", (await qr(u2, dA1)) === "ok" && (await qr(u2, dA2)) === "forbidden");

  // الفني الأساسي
  ok("الأساسي: تعيين الفني 1 أساسيًا", !(await rpc(mgr, "assignment_set_primary", [A, T1, null])).error
    && (await c.query("select technician_id from public.technician_customers where customer_id = $1 and is_primary", [A])).rows[0]?.technician_id === T1);
  ok("الأساسي: فني مسند لموقع فقط لا يكون أساسيًا", (await rpc(mgr, "assignment_set_primary", [A, T2, null])).code === "P0001");
  ok("الأساسي: فني غير مسند لا يكون أساسيًا", (await rpc(mgr, "assignment_set_primary", [A, T3, null])).code === "P0001");
  await rpc(mgr, "assignment_set", [T3, A, null, null]);
  ok("الأساسي: تغييره يحفظ أساسيًا واحدًا", !(await rpc(mgr, "assignment_set_primary", [A, T3, "إعادة توزيع"])).error
    && (await c.query("select count(*)::int n from public.technician_customers where customer_id = $1 and is_primary", [A])).rows[0].n === 1);
  ok("الأساسي: تاريخ التغيير محفوظ للسابق والجديد", (await ev(T1)).includes("primary_cleared") && (await ev(T3)).includes("primary_set"));
  ok("الأساسي: فهرس يمنع أساسيين اثنين", (await c.query("savepoint px").then(() => c.query("update public.technician_customers set is_primary = true where customer_id = $1", [A]))
    .then(() => false, () => true).finally(() => c.query("rollback to savepoint px"))));
  ok("التعيين لزيارة محددة لا يغيّر الأساسي", !(await as(mgr, "insert into public.visit_technicians (visit_id, technician_id, company_id) values ($1, $2, $3)", [vA2, T2, co])).error
    && (await c.query("select technician_id from public.technician_customers where customer_id = $1 and is_primary", [A])).rows[0]?.technician_id === T3);
  ok("التعيين لزيارة محددة يتيح للفني تلك الزيارة فقط", same(await ids(u2, "select id from public.visits where company_id = $1", [co]), [vA1, vA2]));

  // نطاق التنبيهات
  const resp = async (d) => (await c.query("select user_id from app_private.device_responsible_users($1)", [d])).rows.map((r) => r.user_id);
  ok("التنبيهات: جهاز أ2 لفنيي العميل كاملًا لا لفني الموقع أ1", same(await resp(dA2), [u1, u3]));
  ok("التنبيهات: جهاز أ1 لفنيي العميل وفني موقعه", same(await resp(dA1), [u1, u2, u3]));

  // الإلغاء
  ok("الإلغاء: إزالة إسناد الفني 1 بسبب", !(await rpc(mgr, "assignment_remove", [T1, A, "انتقل لمنطقة أخرى"])).error);
  ok("الإلغاء: الفني 1 فقد الوصول فورًا", (await ids(u1, "select id from public.devices where company_id = $1", [co])).length === 0);
  const un = (await c.query("select reason from public.technician_assignment_events where technician_id = $1 and event = 'unassigned'", [T1])).rows[0];
  ok("الإلغاء: الحدث محفوظ بسببه ويبقى التاريخ السابق", un?.reason === "انتقل لمنطقة أخرى" && (await ev(T1)).length === 4, JSON.stringify(await ev(T1)));
  ok("السجل: لا يُعدَّل ولا يُحذف", !!(await as(mgr, "delete from public.technician_assignment_events where technician_id = $1", [T1])).error
    && (await c.query("select count(*)::int n from public.technician_assignment_events where technician_id = $1", [T1])).rows[0].n === 4);
  ok("السجل: الفني يرى تاريخ إسناده فقط", (await ids(u2, "select id from public.technician_assignment_events where company_id = $1", [co])).length === 2);
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
