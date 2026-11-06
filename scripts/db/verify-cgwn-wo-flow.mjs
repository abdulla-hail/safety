// اختبار شامل لدورة أمر العمل على بيانات cgwn الفعلية (مدير الشركة وفنيها وموقعها وأجهزتها القائمة) مع RLS،
// داخل معاملة واحدة يُتراجع عنها دائمًا: إسناد أمر ← ظهوره للفني ← بدء الزيارة ← تقرير وملاحظات ← بلاغ عطل ← صور ← إغلاق ← التقرير.
// الاستخدام: node scripts/db/verify-cgwn-wo-flow.mjs
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

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
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = (await c.query(sql, params)).rows;
    await c.query("reset role");
    await c.query(`release savepoint ${sp}`);
    return { rows: r };
  } catch (e) {
    await c.query("reset role").catch(() => {});
    await c.query(`rollback to savepoint ${sp}`);
    return { error: e.message, code: e.code };
  }
}
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
  return r.error ? { error: r.error, code: r.code } : { data: r.rows[0].r };
};
const created = { visits: [], wos: [] };

await c.query("begin");
await c.query("set local lock_timeout = '5s'");
await c.query("set local statement_timeout = '60s'");
try {
  const x = (await c.query(`select m.user_id mgr, t.user_id tech, t.id tech_id, s.company_id, s.id site_id, s.customer_id,
      (select d.id from public.devices d where d.site_id = s.id and d.archived_at is null and d.status not in ('decommissioned','replaced') order by d.created_at limit 1) device_id
    from public.customer_sites s join public.companies co on co.id = s.company_id and co.status = 'active'
    join public.company_memberships m on m.company_id = s.company_id and m.role = 'company_manager' and m.status = 'active'
    join public.technicians t on t.company_id = s.company_id and t.user_id is not null and t.archived_at is null and t.is_active
    join public.company_memberships tm on tm.user_id = t.user_id and tm.company_id = t.company_id and tm.status = 'active' and tm.role = 'technician'
      and 'faults.create' = any (public.company_effective_permissions(tm.role, tm.permissions))
    where s.archived_at is null and exists (select 1 from public.devices d where d.site_id = s.id and d.archived_at is null and d.status not in ('decommissioned','replaced'))
    limit 1`)).rows[0];
  ok("تجهيز: مدير وفني وموقع وجهاز فعلي", !!x?.device_id, "لا توجد بيانات كافية");
  if (!x?.device_id) throw new Error("stop");
  const { mgr, tech } = x;

  // 1) المدير ينشئ أمرًا طارئًا ويسنده للفني
  const wo = await as(mgr, `insert into public.work_orders (company_id, customer_id, site_id, title, description, order_type, priority, status)
    values ($1, $2, $3, 'اختبار: عطل طارئ', 'اختبار دورة العمل', 'emergency', 'critical', 'new') returning id`, [x.company_id, x.customer_id, x.site_id]);
  ok("الإسناد: المدير ينشئ أمر عمل طارئًا", !!wo.rows?.[0]?.id, wo.error);
  const woId = wo.rows?.[0]?.id; created.wos.push(woId);
  ok("الإسناد: ربط الجهاز بالأمر", !(await as(mgr, "insert into public.work_order_devices (work_order_id, device_id, company_id) values ($1, $2, $3)", [woId, x.device_id, x.company_id])).error);
  ok("الإسناد: إسناد الفني", !(await as(mgr, "insert into public.work_order_technicians (work_order_id, technician_id, company_id) values ($1, $2, $3)", [woId, x.tech_id, x.company_id])).error);
  ok("الإسناد: إشعار الفني بالأمر", ((await as(tech, "select id from public.notifications where entity_id = $1", [woId])).rows ?? []).length >= 1);

  // 2) ظهور الأمر للفني بتفاصيله كما يطلبها «عملي»
  const seen = (await as(tech, `select w.title, w.priority, w.status, cu.name customer, s.name site, (select count(*)::int from public.work_order_devices d join public.devices dv on dv.id = d.device_id where d.work_order_id = w.id) devices
    from public.work_orders w left join public.customers cu on cu.id = w.customer_id left join public.customer_sites s on s.id = w.site_id where w.id = $1`, [woId])).rows?.[0];
  ok("عملي: الفني يرى الأمر والعميل والموقع والأجهزة والأولوية والحالة", seen?.customer && seen?.site && seen?.devices === 1 && seen?.priority === "critical", JSON.stringify(seen ?? {}));

  // 3) بدء الزيارة
  const key = crypto.randomUUID();
  const v = await rpc(tech, "work_order_start_visit", [woId, key]);
  ok("البدء: الفني المعيَّن يبدأ الزيارة", !!v.data, v.error);
  created.visits.push(v.data);
  ok("البدء: لا تكرار (المفتاح نفسه أو مفتاح آخر)", (await rpc(tech, "work_order_start_visit", [woId, key])).data === v.data && (await rpc(tech, "work_order_start_visit", [woId, crypto.randomUUID()])).data === v.data);
  ok("البدء: الأمر صار قيد التنفيذ", (await c.query("select status from public.work_orders where id = $1", [woId])).rows[0].status === "in_progress");
  const item = (await as(tech, "select id, version from public.visit_devices where visit_id = $1 and device_id = $2", [v.data, x.device_id])).rows?.[0];
  ok("البدء: جهاز الأمر ضمن بنود الزيارة", !!item);

  // 4) التقرير والملاحظات (حفظ تدريجي)
  ok("التقرير: حفظ مسودة", !!(await rpc(tech, "visit_save_report", [v.data, "مسودة", null, null])).data);
  ok("التقرير: تحديث التقرير والملاحظات والتوصيات", !!(await rpc(tech, "visit_save_report", [v.data, "تقرير الاختبار", "ملاحظات الفني", "توصية"])).data);

  // 5) بلاغ عطل أثناء الزيارة
  const fk = crypto.randomUUID();
  const f = await rpc(tech, "visit_report_fault", [v.data, x.device_id, fk, "اختبار: عطل في الجهاز", "high", "awaiting_verification", "إصلاح اختباري", "متابعة"]);
  ok("العطل: الفني يسجل بلاغًا مرتبطًا", !!f.data, f.error);
  // فني آخر بصلاحيات مخصصة بلا faults.create (إن وُجد) يُرفض حتى لو عُيّن للأمر
  const noFault = (await c.query(`select t.id, t.user_id from public.technicians t join public.company_memberships tm on tm.user_id = t.user_id and tm.company_id = t.company_id
    where t.company_id = $1 and tm.status = 'active' and not ('faults.create' = any (public.company_effective_permissions(tm.role, tm.permissions))) limit 1`, [x.company_id])).rows[0];
  if (noFault) {
    await as(mgr, "insert into public.work_order_technicians (work_order_id, technician_id, company_id) values ($1, $2, $3)", [woId, noFault.id, x.company_id]);
    ok("العطل: فني بلا صلاحية تسجيل البلاغات يُرفض", (await rpc(noFault.user_id, "visit_report_fault", [v.data, x.device_id, crypto.randomUUID(), "x", "low", "open", null, null])).code === "42501");
  }
  ok("العطل: إعادة الإرسال لا تكرر", (await rpc(tech, "visit_report_fault", [v.data, x.device_id, fk, "تكرار", "low", "open", null, null])).data === f.data);
  const fr = (await as(tech, "select work_order_id, visit_id, customer_id, site_id, device_id, status, action_taken, recommendation from public.device_faults where id = $1", [f.data])).rows?.[0];
  ok("العطل: مربوط بالأمر والزيارة والعميل والموقع والجهاز ويراه الفني", fr?.work_order_id === woId && fr?.visit_id === v.data && fr?.customer_id === x.customer_id
    && fr?.site_id === x.site_id && fr?.status === "awaiting_verification" && fr?.action_taken === "إصلاح اختباري", JSON.stringify(fr ?? {}));

  // 6) الصور: تسجيل مرفق بتصنيف وجهاز، وحذف الرافع له قبل الإغلاق
  const att = await as(tech, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, photo_stage, device_id)
    values ($1, 'visit', $2, $3, 'fault.jpg', 'image/jpeg', 100, 'fault', $4) returning id`, [x.company_id, v.data, `${x.company_id}/visit/${v.data}/test-${Date.now()}.jpg`, x.device_id]);
  ok("الصور: صورة «توثيق عطل» مرتبطة بالجهاز", !!att.rows?.[0]?.id, att.error);
  const gen = await as(tech, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, photo_stage)
    values ($1, 'visit', $2, $3, 'general.jpg', 'image/jpeg', 100, 'general') returning id`, [x.company_id, v.data, `${x.company_id}/visit/${v.data}/gen-${Date.now()}.jpg`]);
  ok("الصور: صورة عامة بلا جهاز", !!gen.rows?.[0]?.id, gen.error);
  ok("الصور: تصنيف غير معتمد يُرفض", (await as(tech, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, photo_stage)
    values ($1, 'visit', $2, $3, 'x.jpg', 'bogus')`, [x.company_id, v.data, `${x.company_id}/visit/${v.data}/x-${Date.now()}.jpg`])).code === "23514");
  ok("الصور: الرافع يحذف صورته قبل الإغلاق (مع تدقيق)", !!(await rpc(tech, "attachment_delete", [gen.rows?.[0]?.id])).data
    && (await c.query("select count(*)::int n from public.company_audit_log where action = 'attachment_deleted' and target_id = $1", [gen.rows?.[0]?.id])).rows[0].n === 1);

  // 7) النتيجة والإغلاق
  ok("الفحص: حفظ نتيجة الجهاز", !!(await rpc(tech, "visit_save_item", [item?.id, { inspection_status: "inspected", action: "repair", result: "pass_with_notes", status_after: "operational" }, item?.version])).data);
  const cl = await rpc(tech, "visit_close", [v.data, null, null]);
  ok("الإغلاق: نجح", cl.data && !cl.data.already_closed, cl.error ?? JSON.stringify(cl.data));
  const w2 = (await c.query("select status, completed_at is not null done from public.work_orders where id = $1", [woId])).rows[0];
  ok("الإغلاق: الأمر صار مكتملًا", w2.status === "completed" && w2.done, JSON.stringify(w2));
  ok("بعد الإغلاق: التقرير لا يُعدَّل", (await rpc(tech, "visit_save_report", [v.data, "تعديل", null, null])).code === "P0001");
  ok("بعد الإغلاق: لا بلاغ جديد على الزيارة", (await rpc(tech, "visit_report_fault", [v.data, x.device_id, crypto.randomUUID(), "x", "low", "open", null, null])).code === "P0001");
  ok("بعد الإغلاق: الفني لا يحذف صورة الزيارة", (await rpc(tech, "attachment_delete", [att.rows?.[0]?.id])).code === "42501");

  // 8) بيانات التقرير الموحد كما يطلبها الفني
  const rep = (await as(tech, `select v.ref_no, v.summary, v.technician_notes, v.recommendations, w.ref_no wo,
      (select count(*)::int from public.visit_devices d where d.visit_id = v.id) items, (select count(*)::int from public.maintenance_records m where m.visit_id = v.id) recs,
      (select count(*)::int from public.device_faults f where f.visit_id = v.id) faults, (select count(*)::int from public.attachments a where a.entity_type = 'visit' and a.entity_id = v.id) photos
    from public.visits v left join public.work_orders w on w.id = v.work_order_id where v.id = $1`, [v.data])).rows?.[0];
  ok("التقرير: الزيارة والأمر والبنود والسجل والبلاغ والصور والملاحظات", rep?.summary === "تقرير الاختبار" && rep?.technician_notes === "ملاحظات الفني" && rep?.wo
    && rep?.items === 1 && rep?.recs === 1 && rep?.faults === 1 && rep?.photos === 1, JSON.stringify(rep ?? {}));
} catch (e) {
  if (e.message !== "stop") ok("تنفيذ الاختبار دون استثناء", false, `${e.code ?? ""} ${e.message}`);
} finally {
  await c.query("rollback");
}
const left = (await c.query("select (select count(*)::int from public.visits where id = any($1::uuid[])) + (select count(*)::int from public.work_orders where id = any($2::uuid[])) n",
  [created.visits.filter(Boolean), created.wos.filter(Boolean)])).rows[0].n;
ok("لم يُحفظ أي أثر: الأمر والزيارة غير موجودين بعد التراجع", left === 0, left);
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : results.map((r) => r.name) }, null, 2));
if (failed.length) process.exitCode = 1;
