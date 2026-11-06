// اختبار وظيفي لسجل الزيارة والفحص والصور والتصحيح الموثق والبلاغات (ترحيل 20261105000100) على cgwn داخل معاملة يُتراجع عنها دائمًا.
// قبل التطبيق: node scripts/db/verify-cgwn-faults.mjs --with-migration supabase/migrations/20261105000100_visits_faults_history.sql
// بعد التطبيق: node scripts/db/verify-cgwn-faults.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

pg.types.setTypeParser(1082, (v) => v);
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
    await c.query("select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)");
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
const sys1 = async (sql, params) => (await c.query(sql, params)).rows[0];
const cnt = async (uid, sql, params) => (await as(uid, sql, params)).rows?.length ?? -1;

const before = await fingerprint(c);
await c.query("begin");
try {
  if (MIGRATION) await c.query(MIGRATION);
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), u1 = await mk("tech1"), u2 = await mk("tech2");
  const created = await rpc(owner, "platform_create_company", [`شركة بلاغات ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const co = created.data?.company_id;
  await rpc(mgr, "accept_company_invitation", [created.data?.token]);
  for (const [uid, email] of [[u1, "tech1"], [u2, "tech2"]]) {
    const inv = await rpc(mgr, "company_invite_member", [co, `${email}.${tag}@ays-test.invalid`, "technician", email, null, null, 24]);
    await rpc(uid, "accept_company_invitation", [inv.data?.token]);
  }
  const T1 = (await one(mgr, "select id from public.technicians where company_id = $1 and user_id = $2", [co, u1])).row?.id;
  const ins = async (sql, p) => { const r = await one(mgr, sql, p); if (r.error) throw new Error(r.error); return r.row?.id; };
  const A = await ins("insert into public.customers (company_id, name) values ($1, 'مستشفى أ') returning id", [co]);
  const B = await ins("insert into public.customers (company_id, name) values ($1, 'مصنع ب') returning id", [co]);
  const A1 = await ins("insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'أ1') returning id", [co, A]);
  const B1 = await ins("insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'ب1') returning id", [co, B]);
  await rpc(mgr, "assignment_set", [T1, A, null, null]);
  const sys = (await one(mgr, "select id from public.safety_systems where company_id = $1 order by sort_order limit 1", [co])).row?.id;
  const dA = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, next_maintenance_at) values ($1, $2, $3, $4, 'جهاز أ', current_date + 30) returning id", [co, A, A1, sys]);
  const dA2 = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, next_maintenance_at) values ($1, $2, $3, $4, 'جهاز أ2', current_date + 40) returning id", [co, A, A1, sys]);
  const dB = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name) values ($1, $2, $3, $4, 'جهاز ب') returning id", [co, B, B1, sys]);
  const vA = await ins("insert into public.visits (company_id, customer_id, site_id, scheduled_start, visit_type) values ($1, $2, $3, now(), 'emergency') returning id", [co, A, A1]);
  ok("الزيارة: نوع الزيارة يُحفظ (طارئة)", (await sys1("select visit_type from public.visits where id = $1", [vA])).visit_type === "emergency");
  ok("الزيارة: النتيجة والتوصيات والمتابعة", (await as(mgr, "update public.visits set outcome = 'follow_up_required', recommendations = 'استبدال البطارية', follow_up_status = 'required' where id = $1 returning id", [vA])).rows?.length === 1);

  // الفحص داخل الزيارة
  const mr = await one(u1, `insert into public.maintenance_records (company_id, device_id, visit_id, action, result, status_after, readings, actions_taken, recommendations)
    values ($1, $2, $3, 'inspection', 'pass_with_notes', 'needs_maintenance', '{"الضغط":"12 بار"}', 'تنظيف الحساس', 'متابعة خلال شهر') returning id, condition_before`, [co, dA, vA]);
  ok("الفحص: الفني يسجل القراءات والإجراءات والتوصيات، وتُلتقط حالة الجهاز عند الفحص", mr.row?.condition_before === "operational", mr.error);
  ok("الفحص: الحالة الحالية للجهاز منفصلة عن نتيجة الفحص", (await sys1("select status from public.devices where id = $1", [dA])).status === "needs_maintenance");
  ok("الفحص: زيارة لعميل آخر تُرفض", (await as(mgr, "insert into public.maintenance_records (company_id, device_id, visit_id, action, result, status_after) values ($1, $2, $3, 'inspection', 'pass', 'operational')", [co, dB, vA])).code === "23514");
  ok("الفحص: قراءات بغير صيغة حقول تُرفض", (await as(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after, readings) values ($1, $2, 'inspection', 'pass', 'operational', '[1]')", [co, dA2])).code === "22023");
  ok("الحالات: «معطل» و«مستبدل» متاحتان", !(await as(mgr, "update public.devices set status = 'faulty' where id = $1", [dB])).error
    && !!(await as(mgr, "update public.devices set status = 'broken' where id = $1", [dB])).error);
  await as(mgr, "update public.devices set status = 'operational' where id = $1", [dB]);

  // التصحيح الموثق
  ok("التصحيح: الفني لا يصحح", (await rpc(u1, "maintenance_correct", [mr.row?.id, "result", JSON.stringify("pass"), "خطأ في الإدخال"])).code === "42501");
  ok("التصحيح: سبب قصير يُرفض", (await rpc(mgr, "maintenance_correct", [mr.row?.id, "result", JSON.stringify("pass"), "خطأ"])).code === "22023");
  const cr = await rpc(mgr, "maintenance_correct", [mr.row?.id, "result", JSON.stringify("pass"), "أُدخلت النتيجة خطأ والصحيح سليم"]);
  ok("التصحيح: المدير يصحح بسبب موثق", !cr.error, cr.error);
  const cx = await sys1("select old_value, new_value, corrected_by from public.maintenance_corrections where id = $1", [cr.data]);
  ok("التصحيح: يحفظ القيمة السابقة والجديدة والمنفّذ", cx.old_value === "pass_with_notes" && cx.new_value === "pass" && cx.corrected_by === mgr);
  ok("التصحيح: السجل الأصلي لم يتغير", (await sys1("select result from public.maintenance_records where id = $1", [mr.row?.id])).result === "pass_with_notes");
  ok("التصحيح: لا يُعدَّل ولا يُحذف", !!(await as(mgr, "delete from public.maintenance_corrections where id = $1", [cr.data])).error
    && (await sys1("select count(*)::int n from public.maintenance_corrections where id = $1", [cr.data])).n === 1);
  ok("التصحيح: الفني يرى تصحيحات سجلات عملائه", (await cnt(u1, "select id from public.maintenance_corrections where record_id = $1", [mr.row?.id])) === 1);

  // الصور
  const ph = (dev, stage) => as(u1, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, photo_stage, device_id)
    values ($1, 'visit', $2, $3, 'p.jpg', $4, $5) returning id`, [co, vA, `${co}/visit/${vA}/${Math.random().toString(36).slice(2)}.jpg`, stage, dev]);
  ok("الصور: صورة قبل وبعد لجهاز الزيارة", !(await ph(dA, "before")).error && !(await ph(dA, "after")).error);
  ok("الصور: جهاز عميل آخر يُرفض", (await ph(dB, "before")).code === "23514");
  ok("الصور: الصورتان تبقيان (لا استبدال) وتظهران في سجل الجهاز", (await cnt(u1, "select id from public.attachments where device_id = $1", [dA])) === 2);
  ok("الصور: فني غير مسند لا يراها", (await cnt(u2, "select id from public.attachments where device_id = $1", [dA])) === 0);

  // البلاغات
  const nextBefore = (await sys1("select next_maintenance_at d from public.devices where id = $1", [dA])).d;
  const nextOther = (await sys1("select next_maintenance_at d from public.devices where id = $1", [dA2])).d;
  const f = await one(u1, "insert into public.device_faults (company_id, device_id, description, severity, source) values ($1, $2, 'تسرب في الصمام', 'high', 'technician') returning id, ref_no, status, customer_id", [co, dA]);
  ok("البلاغ: الفني المسند يسجل بلاغًا برقم مرجعي ومرتبطًا بعميل الجهاز", /^FLT-\d{6}$/.test(f.row?.ref_no ?? "") && f.row?.status === "open" && f.row?.customer_id === A, f.error);
  ok("البلاغ: فني غير مسند لا يسجل على جهاز لا يراه", !!(await as(u2, "insert into public.device_faults (company_id, device_id, description) values ($1, $2, 'محاولة')", [co, dA])).error);
  ok("البلاغ: لا يمكن فرض حالة أو عميل عند الإنشاء", !!(await as(u1, "insert into public.device_faults (company_id, device_id, description, status) values ($1, $2, 'x y z', 'closed')", [co, dA])).error);
  ok("البلاغ: إشعار للإدارة دون المبلّغ", (await sys1("select count(*)::int n from public.notifications where kind = 'fault_reported' and recipient_user_id = $1", [mgr])).n === 1
    && (await sys1("select count(*)::int n from public.notifications where kind = 'fault_reported' and recipient_user_id = $1", [u1])).n === 0);
  ok("البلاغ: فني غير مسند لا يراه", (await cnt(u2, "select id from public.device_faults where company_id = $1", [co])) === 0);
  ok("البلاغ: الفني لا يدير البلاغ", (await rpc(u1, "fault_transition", [f.row?.id, "in_progress", null, null, null, null])).code === "42501");
  ok("البلاغ: تعديل الحالة مباشرة ممنوع", !!(await as(mgr, "update public.device_faults set status = 'closed' where id = $1", [f.row?.id])).error);
  const woB = await ins("insert into public.work_orders (company_id, customer_id, title, order_type) values ($1, $2, 'أمر عميل آخر', 'corrective') returning id", [co, B]);
  ok("البلاغ: ربط أمر عمل لعميل آخر يُرفض", (await rpc(mgr, "fault_transition", [f.row?.id, "in_progress", null, woB, null, null])).code === "23514");
  const wo = await ins("insert into public.work_orders (company_id, customer_id, site_id, title, order_type) values ($1, $2, $3, 'إصلاح الصمام', 'corrective') returning id", [co, A, A1]);
  ok("البلاغ: بدء المعالجة بأمر عمل مستقل دون إنشاء زيارة", !(await rpc(mgr, "fault_transition", [f.row?.id, "in_progress", "بدء", wo, null, "under_repair"])).error
    && (await sys1("select count(*)::int n from public.visits where work_order_id = $1", [wo])).n === 0);
  ok("البلاغ: حالة الجهاز تتغير فقط بالاختيار الصريح", (await sys1("select status from public.devices where id = $1", [dA])).status === "under_repair");
  ok("البلاغ: إرسال للتحقق دون وصف الإصلاح يُرفض", (await rpc(mgr, "fault_transition", [f.row?.id, "awaiting_verification", null, null, null, null])).code === "22023");
  ok("البلاغ: تم الإصلاح ⇒ بانتظار التحقق", !(await rpc(mgr, "fault_transition", [f.row?.id, "awaiting_verification", "استبدال الحشوة", null, null, null])).error);
  ok("البلاغ: الإغلاق دون تحقق ناجح يُرفض", (await rpc(mgr, "fault_transition", [f.row?.id, "closed", null, null, null, null])).code === "22023");
  ok("البلاغ: تحقق فاشل يعيده للمعالجة", !(await rpc(mgr, "fault_transition", [f.row?.id, "in_progress", "ما زال يسرب", null, "failed", null])).error);
  await rpc(mgr, "fault_transition", [f.row?.id, "awaiting_verification", "استبدال الصمام كاملًا", null, null, null]);
  ok("البلاغ: تحقق ناجح يغلقه", !(await rpc(mgr, "fault_transition", [f.row?.id, "closed", null, null, "passed", "operational"])).error
    && (await sys1("select status, verification_result from public.device_faults where id = $1", [f.row?.id])).verification_result === "passed");
  ok("البلاغ: سجل الأحداث كامل ولا يُعدَّل", (await sys1("select count(*)::int n from public.device_fault_events where fault_id = $1", [f.row?.id])).n === 6
    && !!(await as(mgr, "delete from public.device_fault_events where fault_id = $1", [f.row?.id])).error);
  ok("البلاغ: لم يتغير موعد صيانة الجهاز ولا بقية الأجهزة", (await sys1("select next_maintenance_at d from public.devices where id = $1", [dA])).d === nextBefore
    && (await sys1("select next_maintenance_at d from public.devices where id = $1", [dA2])).d === nextOther);
  ok("البلاغ: مرفقاته مرئية لمن يرى البلاغ فقط", !(await as(u1, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name) values ($1, 'fault', $2, $3, 'f.jpg')`,
    [co, f.row?.id, `${co}/fault/${f.row?.id}/${tag}.jpg`])).error && (await cnt(u2, "select id from public.attachments where entity_type = 'fault'", [])) === 0);
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
