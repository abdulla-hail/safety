// اختبار إصلاحات تسجيل الجهاز والصيانة ودعوة مساعد المالك على cgwn داخل معاملة يُتراجع عنها دائمًا (دون أي تغيير بنيوي).
// يكرر الحمولة التي ترسلها الواجهة الآن قبل تطبيق المرحلة الخامسة، ويثبت سبب الفشل السابق.
// الاستخدام: node scripts/db/verify-cgwn-fixes.mjs
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

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
    return { error: e.message, code: e.code, constraint: e.constraint };
  }
}
const one = async (uid, sql, params) => { const r = await as(uid, sql, params); return { row: r.rows?.[0], error: r.error, code: r.code, constraint: r.constraint }; };
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
  return r.error ? { error: r.error, code: r.code } : { data: r.rows[0].r };
};
const sys1 = async (sql, params) => (await c.query(sql, params)).rows[0];
const uuid = async () => (await sys1("select gen_random_uuid() u")).u;

const before = await fingerprint(c);
await c.query("begin");
try {
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), tech = await mk("tech"), asst = await mk("assistant"), asst2 = await mk("assistant2"), other = await mk("other");
  const created = await rpc(owner, "platform_create_company", [`شركة إصلاحات ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const co = created.data?.company_id;
  await rpc(mgr, "accept_company_invitation", [created.data?.token]);
  const inv = await rpc(mgr, "company_invite_member", [co, `tech.${tag}@ays-test.invalid`, "technician", "tech", null, null, 24]);
  await rpc(tech, "accept_company_invitation", [inv.data?.token]);
  const T = (await one(mgr, "select id from public.technicians where company_id = $1 and user_id = $2", [co, tech])).row?.id;
  const A = (await one(mgr, "insert into public.customers (company_id, name) values ($1, 'عميل') returning id", [co])).row?.id;
  const sys = (await one(mgr, "select id from public.safety_systems where company_id = $1 order by sort_order limit 1", [co])).row?.id;
  await rpc(mgr, "assignment_set", [T, A, null, null]);
  ok("تجهيز: شركة ومدير وفني مسند وعميل بلا مواقع", !!(co && T && A && sys));

  // ===== تسجيل الجهاز =====
  const cols = async (t) => (await c.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [t])).rows.map((r) => r.column_name);
  const mrCols = await cols("maintenance_records");
  ok("السبب المُثبت: أعمدة المرحلة الخامسة غير موجودة (كانت الواجهة ترسلها فيفشل الحفظ برسالة عامة)",
    !mrCols.includes("readings") && !mrCols.includes("actions_taken") && !(await cols("attachments")).includes("photo_stage"));
  const oldMr = await as(mgr, "insert into public.maintenance_records (company_id, device_id, action, result, status_after, readings) values ($1, gen_random_uuid(), 'inspection', 'pass', 'operational', '{}')", [co]);
  ok("السبب المُثبت: إدراج سجل صيانة بعمود القراءات يفشل بخطأ عمود غير موجود (42703 ≙ PGRST204 في واجهة البرمجة)", oldMr.code === "42703", oldMr.code);
  const oldStatus = await as(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name, status) values ($1, $2, $3, null, 'x', 'faulty')", [co, A, sys]);
  ok("السبب المُثبت: حالة «معطل» تُرفض قبل المرحلة الخامسة (كانت معروضة في النموذج)", oldStatus.code === "23514", oldStatus.code);

  // عميل بلا مواقع: الواجهة تنشئ «الموقع الرئيسي» ثم الجهاز بمعرّف ثابت من النموذج
  const site = (await one(mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'الموقع الرئيسي') returning id", [co, A])).row?.id;
  const devId = await uuid();
  const devSql = `insert into public.devices (id, company_id, customer_id, system_id, catalog_item_id, site_id, name, manufacturer, model, device_type, serial_number,
      location_detail, capacity, installed_at, expires_at, status, schedule_start_date, next_maintenance_at, notes, maintenance_interval_months)
    values ($1, $2, $3, $4, null, $5, 'طفاية 6 كجم', null, null, null, null, null, null, null, null, 'operational', null, null, null, null) returning id, maintenance_interval_months, next_maintenance_at`;
  const d1 = await one(mgr, devSql, [devId, co, A, sys, site]);
  ok("الجهاز: الحمولة الحالية للواجهة تُحفظ (دون صورة)", d1.row?.id === devId, d1.error);
  const d2 = await one(mgr, devSql, [devId, co, A, sys, site]);
  ok("الجهاز: إعادة الإرسال بالمعرّف نفسه تُرفض بقيد المفتاح الأساسي (تُعامل نجاحًا دون تكرار)", d2.code === "23505" && d2.constraint === "devices_pkey", `${d2.code} ${d2.constraint}`);
  ok("الجهاز: لا تكرار", (await sys1("select count(*)::int n from public.devices where company_id = $1", [co])).n === 1);
  // الصورة: المسار يُحفظ في الجهاز ويقبل مسار المجلد الصحيح فقط
  const okPath = `${co}/device-image/${devId}/${await uuid()}.jpg`;
  ok("الصورة: مسار مجلد الجهاز يُحفظ", !(await as(mgr, "update public.devices set image_path = $2 where id = $1", [devId, okPath])).error
    && (await sys1("select image_path from public.devices where id = $1", [devId])).image_path === okPath);
  ok("الصورة: مسار جهاز أو شركة أخرى يُرفض", !!(await as(mgr, "update public.devices set image_path = $2 where id = $1", [devId, `${co}/device-image/${await uuid()}/x.jpg`])).error);
  ok("الجهاز: الفني لا يسجّل جهازًا (صلاحية الخادم)", !!(await as(tech, devSql, [await uuid(), co, A, sys, site])).error);

  // ===== تسجيل الصيانة (حمولة الواجهة قبل المرحلة الخامسة: القراءات والإجراءات والتوصيات ضمن الملاحظات) =====
  const recId = await uuid();
  const mrSql = `insert into public.maintenance_records (id, company_id, device_id, action, result, status_after, performed_at, notes, next_due_at, visit_id, work_order_id)
    values ($1, $2, $3, 'inspection', 'pass_with_notes', 'needs_maintenance', now(), $4, null, null, null)`;
  const notes = "ملاحظة\nالقراءات: الضغط: 12 بار\nالإجراءات المنفذة: تنظيف\nالتوصيات: متابعة";
  const m1 = await as(tech, mrSql, [recId, co, devId, notes]);
  ok("الصيانة: الفني المسند يسجّل العملية بالحمولة الحالية", !m1.error, m1.error);
  const m2 = await as(tech, mrSql, [recId, co, devId, notes]);
  ok("الصيانة: إعادة الإرسال بالمعرّف نفسه لا تكرر السجل", m2.code === "23505" && m2.constraint === "maintenance_records_pkey", `${m2.code} ${m2.constraint}`);
  ok("الصيانة: سجل واحد، والقراءات والإجراءات والتوصيات محفوظة نصًا", (await sys1("select count(*)::int n, max(notes) t from public.maintenance_records where device_id = $1", [devId])).t === notes);
  const link = `insert into public.maintenance_record_technicians (record_id, technician_id, company_id) values ($1, $2, $3) on conflict (record_id, technician_id) do nothing`;
  ok("الصيانة: ربط الفني المنفذ مسموح للفني، وتكراره لا يفشل", !(await as(tech, link, [recId, T, co])).error && !(await as(tech, link, [recId, T, co])).error);
  const dv = await sys1("select status, last_maintenance_at::text l, next_maintenance_at::text nx from public.devices where id = $1", [devId]);
  ok("الصيانة: حالة الجهاز وموعده القادم تحدّثا (دورية مكتملة)", dv.status === "needs_maintenance" && !!dv.l && !!dv.nx, JSON.stringify(dv));
  ok("الصيانة: السجل التاريخي لا يُعدَّل ولا يُحذف", !!(await as(mgr, "update public.maintenance_records set notes = 'x' where id = $1", [recId])).error
    && !!(await as(mgr, "delete from public.maintenance_records where id = $1", [recId])).error);
  ok("الصيانة: فني غير مسند لا يسجّل على الجهاز", !!(await as(other, mrSql, [await uuid(), co, devId, null])).error);
  ok("الصيانة: حالة «معطل» مرفوضة بعد العملية قبل المرحلة الخامسة (الواجهة لم تعد تعرضها)",
    (await as(tech, `insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'inspection', 'fail', 'faulty')`, [co, devId])).code === "23514");

  // ===== دعوة مساعد المالك =====
  const invA = await rpc(owner, "platform_invite_assistant", [`assistant.${tag}@ays-test.invalid`, "مساعد", ["platform.companies.view"], 72]);
  ok("المساعد: المالك ينشئ الدعوة برابط", !!invA.data?.token, invA.error);
  const land = await rpc(null, "assistant_invitation_landing", [invA.data?.token]);
  ok("المساعد: صفحة الدعوة للزائر تعرض الدعوة المعلّقة دون كشف البريد كاملًا", land.data?.status === "pending" && !String(land.data?.email_hint ?? "").includes(`assistant.${tag}`), JSON.stringify(land.data));
  ok("المساعد: حساب ببريد آخر لا يقبلها", (await rpc(other, "accept_platform_assistant_invitation", [invA.data?.token])).code === "42501");
  ok("المساعد: عضو شركة لا يصبح مساعدًا (فصل الصفتين)", !!(await rpc(tech, "accept_platform_assistant_invitation", [invA.data?.token])).error);
  const acc = await rpc(asst, "accept_platform_assistant_invitation", [invA.data?.token]);
  ok("المساعد: القبول بالبريد المدعو", acc.data?.status === "accepted", acc.error);
  const ctxA = (await rpc(asst, "get_my_context", [])).data;
  ok("المساعد: السياق بعد القبول = مساعد بصلاحياته الممنوحة فقط (لا عضوية شركة، فلا يُحوَّل لصفحة الانضمام)",
    ctxA?.platform_role === "assistant" && ctxA?.is_platform_admin === false && JSON.stringify(ctxA?.platform_permissions) === JSON.stringify(["platform.companies.view"])
    && (ctxA?.memberships ?? []).length === 0, JSON.stringify({ r: ctxA?.platform_role, p: ctxA?.platform_permissions }));
  ok("المساعد: الدعوة لا تُستخدم مرتين", (await rpc(asst, "accept_platform_assistant_invitation", [invA.data?.token])).code === "P0001");
  ok("المساعد: يرى الشركات (صلاحية العرض)", ((await as(asst, "select id from public.companies")).rows ?? []).length >= 1);
  ok("المساعد: لا ينشئ شركة دون صلاحية", (await rpc(asst, "platform_create_company", [`ممنوع ${tag}`, `x.${tag}@ays-test.invalid`, null, null, null, 24])).code === "42501");
  ok("المساعد: لا يدعو مساعدين", !!(await rpc(asst, "platform_invite_assistant", [`y.${tag}@ays-test.invalid`, null, ["platform.companies.view"], 72])).error);
  ok("المساعد: لا يرى عملاء أو أجهزة الشركات", ((await as(asst, "select id from public.customers")).rows ?? []).length === 0
    && ((await as(asst, "select id from public.devices")).rows ?? []).length === 0);
  // دعوة ملغاة ومنتهية
  const invB = await rpc(owner, "platform_invite_assistant", [`assistant2.${tag}@ays-test.invalid`, null, ["platform.branding"], 72]);
  await rpc(owner, "platform_revoke_assistant_invitation", [invB.data?.invitation_id]);
  ok("المساعد: الدعوة الملغاة برسالة واضحة", /أُلغيت/.test((await rpc(asst2, "accept_platform_assistant_invitation", [invB.data?.token])).error ?? "")
    && (await rpc(null, "assistant_invitation_landing", [invB.data?.token])).data?.status === "revoked");
  const invC = await rpc(owner, "platform_invite_assistant", [`assistant2.${tag}@ays-test.invalid`, null, ["platform.branding"], 72]);
  await c.query("update public.platform_assistant_invitations set expires_at = now() - interval '1 minute' where id = $1", [invC.data?.invitation_id]);
  ok("المساعد: الدعوة المنتهية برسالة واضحة", /انتهت/.test((await rpc(asst2, "accept_platform_assistant_invitation", [invC.data?.token])).error ?? ""));
  const invD = await rpc(owner, "platform_invite_assistant", [`assistant2.${tag}@ays-test.invalid`, null, ["platform.branding"], 72]);
  await rpc(asst2, "accept_platform_assistant_invitation", [invD.data?.token]);
  const ctxB = (await rpc(asst2, "get_my_context", [])).data;
  ok("المساعد بصلاحية الشعار فقط: لا يرى الشركات (صفحته الأولى إعدادات الشعار لا «لا صلاحية»)",
    ctxB?.platform_role === "assistant" && ((await as(asst2, "select id from public.companies")).rows ?? []).length === 0);
  // آلية دعوة أعضاء الشركات لم تنكسر
  const inv2 = await rpc(mgr, "company_invite_member", [co, `other.${tag}@ays-test.invalid`, "technician", "other", null, null, 24]);
  ok("دعوات الشركات: المدير يدعو فنيًا ويقبلها صاحب البريد", !(await rpc(other, "accept_company_invitation", [inv2.data?.token])).error);
} catch (e) {
  ok("تنفيذ الاختبار دون استثناء", false, e.message);
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
const diff = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
ok("لم يُحفظ أي أثر للاختبار (البصمات مطابقة)", diff.length === 0, `تغيرت: ${diff.join("، ")} (قد يكون نشاطًا متزامنًا من التطبيق)`);
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : results.map((r) => r.name) }, null, 2));
if (failed.length) process.exitCode = 1;
