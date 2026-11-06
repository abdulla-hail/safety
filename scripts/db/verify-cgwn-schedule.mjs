// اختبار وظيفي لجدولة الصيانة ودورات الاستحقاق والتنبيهات (ترحيل 20261104000100) على cgwn داخل معاملة يُتراجع عنها دائمًا.
// قبل التطبيق: node scripts/db/verify-cgwn-schedule.mjs --with-migration supabase/migrations/20261104000100_maintenance_schedule_alerts.sql
// بعد التطبيق: node scripts/db/verify-cgwn-schedule.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

// التواريخ (date) نصًا كما هي في القاعدة، دون تحويل منطقة زمنية
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
    await c.query("select set_config('request.jwt.claims', '', true)");
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
const day = (s) => (s instanceof Date ? s.toISOString().slice(0, 10) : String(s).slice(0, 10));

const before = await fingerprint(c);
await c.query("begin");
try {
  if (MIGRATION) await c.query(MIGRATION);
  const v = async (sql, p) => day(Object.values(await sys1(sql, p))[0]);
  ok("الحساب: 31 يناير + شهر = آخر فبراير", (await v("select app_private.add_months('2026-01-31', 1)")) === "2026-02-28");
  ok("الحساب: 29 فبراير + سنة = 28 فبراير", (await v("select app_private.add_months('2028-02-29', 12)")) === "2029-02-28");
  ok("الحساب الثابت: لا انزياح لنهاية الشهر (بداية 31 يناير، إنجاز 5 مارس ⇒ 31 مارس)",
    (await v("select app_private.compute_next_due('2026-01-31', 1, null, 'fixed', '2026-03-05', '2026-02-28')")) === "2026-03-31");
  ok("الحساب الثابت: الإنجاز المبكر يغطي الاستحقاق الحالي (استحقاق 1 أبريل، إنجاز 25 مارس ⇒ 1 يوليو)",
    (await v("select app_private.compute_next_due('2026-01-01', 3, null, 'fixed', '2026-03-25', '2026-04-01')")) === "2026-07-01");
  ok("الحساب من الإنجاز: 5 مارس + 3 أشهر = 5 يونيو",
    (await v("select app_private.compute_next_due('2026-01-01', 3, null, 'from_completion', '2026-03-05', '2026-04-01')")) === "2026-06-05");
  ok("الحساب بالأيام للأجهزة القديمة يبقى كما هو", (await v("select app_private.compute_next_due('2026-01-01', null, 90, 'from_completion', '2026-03-05', null)")) === "2026-06-03");

  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), u1 = await mk("tech1"), u2 = await mk("tech2");
  const created = await rpc(owner, "platform_create_company", [`شركة جدولة ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
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
  const plainSys = await ins("insert into public.safety_systems (company_id, name) values ($1, 'نظام بلا فترة') returning id", [co]);
  const today = day((await sys1("select (now() at time zone 'Asia/Riyadh')::date d")).d);
  const plus = async (d, k) => day((await sys1("select ($1::date + $2::int) d", [d, k])).d);

  // التسجيل
  const d0 = await one(mgr, "insert into public.devices (company_id, customer_id, site_id, system_id, name, installed_at) values ($1, $2, $3, $4, 'جهاز افتراضي', $5) returning id, maintenance_interval_months m, schedule_start_date s, next_maintenance_at nx",
    [co, A, A1, plainSys, "2026-01-31"]);
  ok("التسجيل: بلا فترة ⇒ الافتراضي 3 أشهر وبداية الجدول = التركيب", d0.row?.m === 3 && day(d0.row?.s) === "2026-01-31" && day(d0.row?.nx) === "2026-04-30", d0.error ?? JSON.stringify(d0.row));
  const cyc0 = await sys1("select count(*)::int n, min(due_date) d from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [d0.row?.id]);
  ok("التسجيل: يُفتح استحقاق للجهاز الجديد", cyc0.n === 1 && day(cyc0.d) === "2026-04-30");
  const sysDays = (await one(mgr, "select id, default_interval_days d from public.safety_systems where company_id = $1 and default_interval_days is not null order by sort_order limit 1", [co])).row;
  const dT = await one(mgr, "insert into public.devices (company_id, customer_id, site_id, system_id, name) values ($1, $2, $3, $4, 'جهاز بنوع') returning maintenance_interval_months m, maintenance_interval_days dd", [co, A, A1, sysDays.id]);
  ok("التسجيل: فترة نوع النظام تُحترم (لا تُفرض فترة واحدة لكل الأنواع)", dT.row?.m === null && dT.row?.dd === sysDays.d, JSON.stringify(dT.row));
  const dM = await one(mgr, "insert into public.devices (company_id, customer_id, site_id, system_id, name, maintenance_interval_months) values ($1, $2, $3, $4, 'جهاز شهري', 1) returning id, next_maintenance_at nx", [co, A, A1, plainSys]);
  ok("التسجيل: فترة شهر محددة صراحة", !!dM.row?.nx, dM.error);

  // جهاز متأخر 10 أيام وجهاز للعميل نفسه وجهاز لعميل آخر
  const late = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, maintenance_interval_months, installed_at, next_maintenance_at) values ($1, $2, $3, $4, 'جهاز متأخر', 3, $5, $6) returning id",
    [co, A, A1, plainSys, await plus(today, -100), await plus(today, -10)]);
  const other = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, maintenance_interval_months, next_maintenance_at) values ($1, $2, $3, $4, 'جهاز مجاور', 3, $5) returning id",
    [co, A, A1, plainSys, await plus(today, 3)]);
  const dueToday = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, maintenance_interval_months, next_maintenance_at) values ($1, $2, $3, $4, 'مستحق اليوم', 3, $5) returning id",
    [co, B, B1, plainSys, today]);
  ok("الحالة: متأخر/مستحق/قريب/قادم", (await sys1("select public.maintenance_due_status($1::date - 1, 14) a, public.maintenance_due_status($1::date, 14) b, public.maintenance_due_status($1::date + 3, 14) c, public.maintenance_due_status($1::date + 40, 14) d", [today]))
    ? JSON.stringify(Object.values(await sys1("select public.maintenance_due_status($1::date - 1, 14) a, public.maintenance_due_status($1::date, 14) b, public.maintenance_due_status($1::date + 3, 14) c, public.maintenance_due_status($1::date + 40, 14) d", [today]))) === JSON.stringify(["overdue", "due", "due_soon", "upcoming"]) : false);

  // فتح زيارة لا يُتم الصيانة
  await ins("insert into public.visits (company_id, customer_id, site_id, scheduled_start, status) values ($1, $2, $3, now(), 'in_progress') returning id", [co, A, A1]);
  ok("الزيارة المفتوحة لا تُتم الاستحقاق", (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [late])).n === 1
    && day((await sys1("select next_maintenance_at d from public.devices where id = $1", [late])).d) === await plus(today, -10));

  // التنبيهات — القرار المعتمد: الفني إشعار لكل جهاز ضمن نطاقه؛ الإدارة (assignments.manage) ملخص يومي + إشعار لكل جهاز متأخر
  // + تصعيد إضافي لكل جهاز بلغ حد التصعيد (7 أيام افتراضيًا). كل ذلك بتاريخ الرياض ومفاتيح منع تكرار.
  const lateSmall = await ins("insert into public.devices (company_id, customer_id, site_id, system_id, name, maintenance_interval_months, next_maintenance_at) values ($1, $2, $3, $4, 'متأخر 3 أيام', 3, $5) returning id",
    [co, A, A1, plainSys, await plus(today, -3)]);
  // المدير فني مسند أيضًا للعميل أ: يجب ألا يتلقى إشعار الجهاز نفسه مرتين
  const mgrTech = await ins("insert into public.technicians (company_id, full_name, user_id) values ($1, 'المدير فنيًا', $2) returning id", [co, mgr]);
  await rpc(mgr, "assignment_set", [mgrTech, A, null, null]);
  const runAlerts = async (d) => (await sys1("select app_private.run_maintenance_alerts_for($1, $2::date) n", [co, d ?? null])).n;
  const notes = async (u, kind, entity) => (await c.query(`select count(*)::int n from public.notifications where recipient_user_id = $1 and company_id = $2 and kind = $3
    and ($4::uuid is null or entity_id = $4)`, [u, co, kind, entity ?? null])).rows[0].n;
  await runAlerts();
  ok("الفني: إشعار تأخر مستقل لكل جهاز متأخر ضمن نطاقه (3 أجهزة)", (await notes(u1, "maintenance_overdue")) === 3
    && (await notes(u1, "maintenance_overdue", late)) === 1 && (await notes(u1, "maintenance_overdue", lateSmall)) === 1);
  ok("الفني: إشعار مسبق للجهاز القريب", (await notes(u1, "maintenance_due_soon", other)) === 1);
  ok("الفني: لا إشعار لأجهزة عميل غير مسند (مستحق اليوم لدى ب)", (await notes(u1, "maintenance_due_today")) === 0);
  ok("الفني: لا تصعيد ولا ملخص للفني", (await notes(u1, "maintenance_escalation")) === 0 && (await notes(u1, "maintenance_digest")) === 0);
  ok("الفني: فني بلا إسناد لا يتلقى شيئًا", (await c.query("select count(*)::int n from public.notifications where recipient_user_id = $1 and kind like 'maintenance_%'", [u2])).rows[0].n === 0);
  ok("المدير: إشعار تأخر مستقل لكل جهاز متأخر في الشركة (3 أجهزة، بلا تكرار رغم أنه فني مسند أيضًا)",
    (await notes(mgr, "maintenance_overdue")) === 3 && (await notes(mgr, "maintenance_overdue", late)) === 1 && (await notes(mgr, "maintenance_overdue", lateSmall)) === 1
    && (await notes(mgr, "maintenance_overdue", d0.row?.id)) === 1, `overdue=${await notes(mgr, "maintenance_overdue")}`);
  ok("المدير: تصعيد لكل جهاز بلغ حد التصعيد (7) فقط", (await notes(mgr, "maintenance_escalation")) === 2 && (await notes(mgr, "maintenance_escalation", late)) === 1 && (await notes(mgr, "maintenance_escalation", d0.row?.id)) === 1 && (await notes(mgr, "maintenance_escalation", lateSmall)) === 0);
  ok("المدير: ملخص يومي واحد", (await notes(mgr, "maintenance_digest")) === 1);
  const dg = await sys1("select dedupe_key, body from public.notifications where recipient_user_id = $1 and company_id = $2 and kind = 'maintenance_digest'", [mgr, co]);
  ok("الملخص: مفتاحه بتاريخ الرياض ويحصي المتأخر والتصعيد والمستحق", dg?.dedupe_key === `digest:${today}` && dg.body.includes("متأخرة: 3") && dg.body.includes("حد التصعيد: 2")
    && dg.body.includes("مستحقة اليوم: 1"), JSON.stringify(dg));
  const total1 = (await sys1("select count(*)::int n from public.notifications where company_id = $1", [co])).n;
  await runAlerts(); await runAlerts();
  ok("منع التكرار: إعادة التشغيل في اليوم نفسه لا تضيف أي إشعار", (await sys1("select count(*)::int n from public.notifications where company_id = $1", [co])).n === total1);
  await runAlerts(await plus(today, 3));
  // بعد 3 أيام: «مستحق اليوم» لدى العميل ب صار متأخرًا ⇒ إشعار للمدير (كل أجهزة الشركة) لا للفني (ب غير مسند له)
  ok("بعد 3 أيام: ملخص جديد ليوم جديد، إشعار للجهاز الذي تأخر حديثًا فقط، ولا تصعيد قبل الحد",
    (await notes(mgr, "maintenance_digest")) === 2 && (await notes(mgr, "maintenance_overdue")) === 4 && (await notes(mgr, "maintenance_overdue", dueToday)) === 1
    && (await notes(u1, "maintenance_overdue", dueToday)) === 0 && (await notes(u1, "maintenance_due_today", other)) === 1 && (await notes(mgr, "maintenance_escalation", lateSmall)) === 0
    && (await notes(u1, "maintenance_overdue", late)) === 1,
    `digest=${await notes(mgr, "maintenance_digest")} overdue=${await notes(mgr, "maintenance_overdue")} dueToday(other)=${await notes(u1, "maintenance_due_today", other)} escSmall=${await notes(mgr, "maintenance_escalation", lateSmall)} lateTech=${await notes(u1, "maintenance_overdue", late)}`);
  await runAlerts(await plus(today, 4));
  ok("بلوغ حد التصعيد (7 أيام): تصعيد للجهاز مرة واحدة", (await notes(mgr, "maintenance_escalation", lateSmall)) === 1);
  await runAlerts(await plus(today, 5));
  ok("بعد الحد: لا يتكرر التصعيد للاستحقاق نفسه", (await notes(mgr, "maintenance_escalation", lateSmall)) === 1 && (await notes(mgr, "maintenance_escalation", late)) === 1);
  ok("التوقيت: يتغير «اليوم» عند منتصف الليل بتوقيت الرياض (21:00 UTC)",
    day((await sys1("select app_private.riyadh_date('2026-10-26 20:59:59+00') d")).d) === "2026-10-26"
    && day((await sys1("select app_private.riyadh_date('2026-10-26 21:00:00+00') d")).d) === "2026-10-27");
  ok("التوقيت: مهمة 02:00 UTC تعمل 05:00 بتوقيت الرياض", (await sys1("select to_char(timestamptz '2026-10-27 02:00:00+00' at time zone 'Asia/Riyadh', 'HH24:MI') t")).t === "05:00");
  ok("الإشعار يحفظ المتلقي والتوقيت وحالة القراءة", !!(await sys1("select recipient_user_id, created_at, read_at is null unread from public.notifications where company_id = $1 and kind = 'maintenance_overdue' limit 1", [co]))?.unread);
  ok("الصلاحيات: دالة التنبيهات لا يستدعيها المسجلون مباشرة", !!(await as(mgr, "select app_private.run_maintenance_alerts_for($1)", [co])).error);

  // إنجاز متأخر
  const rec = await one(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'inspection', 'pass', 'operational') returning id, kind, next_due_at, cycle_id", [co, late]);
  ok("الإنجاز: الفحص الدوري نوعه periodic ويرتبط بالاستحقاق", rec.row?.kind === "periodic" && !!rec.row?.cycle_id, rec.error);
  const closed = await sys1("select status, days_late, completed_record_id from public.device_maintenance_cycles where id = $1", [rec.row?.cycle_id]);
  ok("الإنجاز: الاستحقاق المتأخر لا يُحذف بل يُغلق بأيام تأخيره والسجل الذي عالجه", closed.status === "completed" && closed.days_late === 10 && closed.completed_record_id === rec.row?.id, JSON.stringify(closed));
  const dl = await sys1("select next_maintenance_at d, last_maintenance_at l from public.devices where id = $1", [late]);
  ok("الإنجاز: الموعد القادم = الإنجاز + 3 أشهر (سياسة من الإنجاز)", day(dl.d) === day((await sys1("select app_private.add_months($1, 3) d", [today])).d) && day(dl.l) === today);
  ok("الإنجاز: استحقاق جديد مفتوح واحد", (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [late])).n === 1);
  ok("الإنجاز: أجهزة العميل الأخرى لم تتغير", day((await sys1("select next_maintenance_at d from public.devices where id = $1", [other])).d) === await plus(today, 3));

  // الإصلاح الطارئ
  const nBefore = day((await sys1("select next_maintenance_at d from public.devices where id = $1", [other])).d);
  const fix = await one(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'repair', 'pass_with_notes', 'operational') returning kind", [co, other]);
  ok("الإصلاح: نوعه تصحيحي ولا يغيّر موعد الجهاز", fix.row?.kind === "corrective" && day((await sys1("select next_maintenance_at d from public.devices where id = $1", [other])).d) === nBefore
    && (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [other])).n === 1, fix.error);
  const fix2 = await one(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after, next_due_at) values ($1, $2, 'repair', 'pass', 'operational', $3) returning id", [co, other, await plus(today, 30)]);
  ok("الإصلاح: بموعد صريح يعيد الجدولة ويستبدل الاستحقاق السابق", !fix2.error && (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'superseded'", [other])).n === 1);
  await one(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'repair', 'fail', 'under_repair') returning id", [co, dueToday]);
  ok("الإصلاح: يغيّر حالة الجهاز فقط", (await sys1("select status from public.devices where id = $1", [dueToday])).status === "under_repair"
    && day((await sys1("select next_maintenance_at d from public.devices where id = $1", [dueToday])).d) === today);

  // ضبط الجدول لمجموعة أجهزة
  const keep = day((await sys1("select next_maintenance_at d from public.devices where id = $1", [d0.row?.id])).d);
  ok("الجدول: تطبيق فترة على مجموعة دون إعادة الحساب لا يغيّر المواعيد", (await rpc(mgr, "devices_set_schedule", [[d0.row?.id, dM.row?.id], 2, null, false])).data === 2
    && day((await sys1("select next_maintenance_at d from public.devices where id = $1", [d0.row?.id])).d) === keep
    && (await sys1("select maintenance_interval_months m from public.devices where id = $1", [d0.row?.id])).m === 2);
  ok("الجدول: إعادة الحساب بقرار صريح تحدّث الموعد وتحفظ الاستحقاق السابق", !(await rpc(mgr, "devices_set_schedule", [[d0.row?.id], 1, "2026-01-31", true])).error
    && day((await sys1("select next_maintenance_at d from public.devices where id = $1", [d0.row?.id])).d) === "2026-02-28"
    && (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'superseded'", [d0.row?.id])).n === 1);
  ok("الجدول: الفني لا يضبط الجدول", (await rpc(u1, "devices_set_schedule", [[d0.row?.id], 1, null, true])).code === "42501");
  ok("الجدول: فترة غير صالحة تُرفض", (await rpc(mgr, "devices_set_schedule", [[d0.row?.id], 0, null, false])).code === "22023");

  // إعدادات الشركة
  ok("الإعدادات: المدير يحدد الفترة والسياسة والتنبيه والتصعيد", !(await rpc(mgr, "company_update_maintenance_settings", [co, 2, "fixed", 7, 5])).error
    && (await sys1("select default_interval_months m, schedule_policy p, maintenance_alert_days a, escalation_days e from public.companies where id = $1", [co])).p === "fixed");
  ok("الإعدادات: الفني لا يغيّرها", (await rpc(u1, "company_update_maintenance_settings", [co, 3, "fixed", 7, 5])).code === "42501");

  // الرؤية والجدولة الخلفية
  ok("الرؤية: الفني يرى استحقاقات أجهزة عميله فقط", (await as(u1, "select distinct customer_id from public.device_maintenance_cycles where company_id = $1", [co])).rows?.every((r) => r.customer_id === A));
  ok("الرؤية: لا كتابة مباشرة في الاستحقاقات", !!(await as(mgr, "update public.device_maintenance_cycles set status = 'completed' where device_id = $1", [late])).error
    || (await sys1("select count(*)::int n from public.device_maintenance_cycles where device_id = $1 and status = 'open'", [late])).n === 1);
  const job = await sys1("select schedule, command, active from cron.job where jobname = 'ays-maintenance-alerts'");
  ok("الجدولة الخلفية: مهمة يومية 02:00 UTC (05:00 الرياض) مفعّلة", job?.schedule === "0 2 * * *" && job?.active === true && job?.command.includes("cron_maintenance_alerts"));
  await c.query("select app_private.cron_maintenance_alerts()");
  const run = await sys1("select finished_at, error, companies from app_private.maintenance_alert_runs order by id desc limit 1");
  ok("الجدولة الخلفية: التشغيل يسجّل سجلًا بلا خطأ", !!run?.finished_at && !run.error && run.companies >= 1, JSON.stringify(run));
  ok("الجدولة الخلفية: سجل التشغيل لمالك المنصة فقط", !(await rpc(owner, "platform_maintenance_alert_runs", [])).error && !!(await rpc(mgr, "platform_maintenance_alert_runs", [])).error);
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
