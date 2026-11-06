// اختبار شامل لتدفق الزيارة على بيانات cgwn الفعلية (الشركة والفني والموقع والأجهزة القائمة) بهوية الفني ومع RLS،
// داخل معاملة واحدة يُتراجع عنها دائمًا: لا يُحفظ شيء ولا يُحذف شيء. لا يطبع بيانات شخصية.
// الاستخدام: node scripts/db/verify-cgwn-visit-flow.mjs
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

const created = [];
await c.query("begin");
await c.query("set local lock_timeout = '5s'");
await c.query("set local statement_timeout = '60s'");
try {
  // فني فعلي له إسناد، وموقع ضمن نطاقه فيه أجهزة نشطة
  const ctx = (await c.query(`select t.user_id, t.id tech_id, t.company_id, s.id site_id, s.customer_id
    from public.technicians t join public.company_memberships m on m.user_id = t.user_id and m.company_id = t.company_id and m.status = 'active'
    join public.companies co on co.id = t.company_id and co.status = 'active'
    join public.technician_customers tc on tc.technician_id = t.id
    join public.customer_sites s on s.customer_id = tc.customer_id and s.archived_at is null
    where t.archived_at is null and t.user_id is not null
      and exists (select 1 from public.devices d where d.site_id = s.id and d.archived_at is null and d.status not in ('decommissioned', 'replaced'))
    limit 1`)).rows[0];
  ok("تجهيز: فني فعلي مسند وموقع فيه أجهزة نشطة", !!ctx, "لا يوجد فني مسند لموقع فيه أجهزة");
  if (!ctx) throw new Error("stop");
  const tech = ctx.user_id;
  const today = (await c.query("select (now() at time zone 'Asia/Riyadh')::date::text d")).rows[0].d;
  const devsBefore = (await c.query("select id, next_maintenance_at::text n, status, maintenance_interval_months m, maintenance_interval_days d from public.devices where site_id = $1 and archived_at is null and status not in ('decommissioned','replaced') order by created_at", [ctx.site_id])).rows;

  // 1) الزيارة الدورية
  const key = crypto.randomUUID();
  const v = await rpc(tech, "visit_start", [key, ctx.site_id, "periodic", null, null, null]);
  ok("الدورية: الفني يبدأ (أو يستأنف) زيارة الموقع", !!v.data, v.error);
  created.push(v.data);
  ok("الدورية: إعادة الإرسال بالمفتاح نفسه لا تكرر", (await rpc(tech, "visit_start", [key, ctx.site_id, "periodic", null, null, null])).data === v.data);
  ok("الدورية: لا زيارة دورية ثانية مفتوحة للموقع", (await rpc(tech, "visit_start", [crypto.randomUUID(), ctx.site_id, "periodic", null, null, null])).data === v.data);
  const items = (await as(tech, "select id, device_id, version, inspection_status from public.visit_devices where visit_id = $1 order by created_at", [v.data])).rows ?? [];
  ok("الدورية: بند لكل جهاز نشط في الموقع (يراه الفني)", items.length === devsBefore.length && items.every((i) => devsBefore.some((d) => d.id === i.device_id)), `${items.length}/${devsBefore.length}`);

  // 2) مسودة واستئناف
  const i1 = items[0];
  const v1 = await rpc(tech, "visit_save_item", [i1.id, { inspection_status: "pending", notes: "مسودة اختبار" }, i1.version]);
  ok("المسودة: حفظ مسودة جهاز", v1.data === i1.version + 1, v1.error);
  const resumed = (await as(tech, "select notes, version from public.visit_devices where id = $1", [i1.id])).rows?.[0];
  ok("المسودة: الاستئناف يعيد المدخلات والإصدار", resumed?.notes === "مسودة اختبار" && resumed?.version === v1.data);
  ok("المسودة: الإصدار القديم يُرفض (لا كتابة فوق جلسة أخرى)", (await rpc(tech, "visit_save_item", [i1.id, { inspection_status: "pending" }, i1.version])).code === "40001");
  ok("الإغلاق: يُمنع مع جهاز بلا نتيجة", (await rpc(tech, "visit_close", [v.data, null, null])).code === "P0001");

  // 3) النتائج: الأول مفحوص، والبقية «تعذر الفحص» بسبب
  const s1 = await rpc(tech, "visit_save_item", [i1.id, { inspection_status: "inspected", result: "pass", status_after: "operational",
    readings: { "الضغط": "12" }, parts: [{ name: "ملصق فحص", qty: 1 }], notes: "اختبار" }, v1.data]);
  ok("الفحص: حفظ نتيجة الجهاز", !!s1.data, s1.error);
  for (const it of items.slice(1)) await rpc(tech, "visit_save_item", [it.id, { inspection_status: "unable", skip_reason: "اختبار تعذر" }, it.version]);
  ok("الفحص: «تعذر الفحص» بلا سبب يُرفض", items.length < 2 || (await rpc(tech, "visit_save_item", [items[1].id, { inspection_status: "unable" }, null])).code === "22023");

  // 4) الإغلاق
  const cl = await rpc(tech, "visit_close", [v.data, null, "اختبار"]);
  ok("الإغلاق: نجح ونتيجته محسوبة", cl.data && !cl.data.already_closed && cl.data.inspected === 1, cl.error ?? JSON.stringify(cl.data));
  ok("الإغلاق: تكراره آمن", (await rpc(tech, "visit_close", [v.data, null, null])).data?.already_closed === true);
  const recs = (await as(tech, "select id, kind, result, customer_id, site_id from public.maintenance_records where visit_id = $1", [v.data])).rows ?? [];
  ok("السجل: سجل صيانة واحد للمفحوص فقط ويراه الفني", recs.length === 1 && recs[0].id === i1.id && recs[0].kind === "periodic", JSON.stringify(recs));
  const d1 = devsBefore.find((d) => d.id === i1.device_id);
  const d1After = (await c.query("select next_maintenance_at::text n, last_maintenance_at::text l from public.devices where id = $1", [d1.id])).rows[0];
  const expected = d1.m ? (await c.query("select app_private.add_months($1::date, $2::int)::text d", [today, d1.m])).rows[0].d
    : d1.d ? (await c.query("select ($1::date + $2::int)::text d", [today, d1.d])).rows[0].d : null;
  ok("الموعد: من تاريخ التنفيذ الفعلي + فترة الخطة", d1After.n === expected && d1After.l === today, `${d1After.n} ≠ ${expected}`);
  for (const d of devsBefore.slice(1)) {
    const now = (await c.query("select next_maintenance_at::text n from public.devices where id = $1", [d.id])).rows[0].n;
    ok("الموعد: الجهاز غير المفحوص يبقى على موعده", now === d.n, `${now} ≠ ${d.n}`);
  }
  ok("بعد الإغلاق: البند لا يُعدّل", (await rpc(tech, "visit_save_item", [i1.id, { inspection_status: "pending" }, null])).code === "P0001");
  ok("بعد الإغلاق: لا سجل صيانة مباشر بلا زيارة", !!(await as(tech, "insert into public.maintenance_records (company_id, device_id, action, result, status_after) values ($1, $2, 'inspection', 'pass', 'operational')", [ctx.company_id, d1.id])).error);

  // 5) القراءة كما تطلبها الصفحات والتقارير (بالروابط المضمّنة المكافئة) تحت RLS
  const page = (await as(tech, `select m.ref_no, m.device_name_snapshot, cu.name customer, s.name site, v.ref_no visit, t.full_name tech
    from public.maintenance_records m left join public.customers cu on cu.id = m.customer_id left join public.customer_sites s on s.id = m.site_id
    left join public.visits v on v.id = m.visit_id left join public.maintenance_record_technicians mt on mt.record_id = m.id left join public.technicians t on t.id = mt.technician_id
    where m.id = $1`, [i1.id])).rows?.[0];
  ok("سجلات الصيانة: الجهاز والعميل والموقع والزيارة والفني", page?.ref_no && page?.device_name_snapshot && page?.customer && page?.visit && page?.tech, JSON.stringify(page ?? {}));
  const insp = (await as(tech, "select count(*)::int n from public.visit_devices vd join public.visits v on v.id = vd.visit_id where vd.visit_id = $1 and v.closed_at is not null", [v.data])).rows?.[0]?.n;
  ok("التقرير: بنود الزيارة المغلقة (سجل نتائج الفحص)", insp === items.length, insp);

  // 6) الزيارة الطارئة
  const tomorrow = (await c.query("select ($1::date + 1)::text d", [today])).rows[0].d;
  const nextBefore = (await c.query("select next_maintenance_at::text n from public.devices where id = $1", [d1.id])).rows[0].n;
  const u = await rpc(tech, "visit_start", [crypto.randomUUID(), ctx.site_id, "emergency", "fault", [d1.id], "اختبار بلاغ"]);
  ok("الطارئة: بدء زيارة لجهاز بسبب", !!u.data, u.error);
  created.push(u.data);
  const ui = (await as(tech, "select id, version from public.visit_devices where visit_id = $1", [u.data])).rows?.[0];
  ok("الطارئة: لا تغيّر الموعد الدوري حتى بطلب صريح من الفني", (await rpc(tech, "visit_save_item", [ui?.id, { inspection_status: "inspected", result: "fail", status_after: "faulty",
    next_due_override: "2030-01-01", next_due_reason: "اختبار تأجيل" }, ui?.version])).code === "P0001");
  const us = await rpc(tech, "visit_save_item", [ui?.id, { inspection_status: "inspected", action: "repair", result: "fail", status_after: "faulty", findings: "اختبار",
    resolved: false, follow_up_needed: true, follow_up_technician_id: ctx.tech_id, follow_up_due: tomorrow }, ui?.version]);
  ok("الطارئة: حفظ النتيجة والمتابعة", !!us.data, us.error);
  const uc = await rpc(tech, "visit_close", [u.data, null, null]);
  ok("الطارئة: الإغلاق يفتح متابعة", uc.data?.outcome === "follow_up_required" && uc.data?.followups === 1, uc.error ?? JSON.stringify(uc.data));
  const ur = (await c.query("select kind from public.maintenance_records where visit_id = $1", [u.data])).rows;
  ok("الطارئة: سجل تصحيحي لا دوري", ur.length === 1 && ur[0].kind === "corrective", JSON.stringify(ur));
  ok("الطارئة: الموعد الدوري لم يتغير", (await c.query("select next_maintenance_at::text n from public.devices where id = $1", [d1.id])).rows[0].n === nextBefore);
  const f = (await as(tech, "select kind, status, follow_up_due::text due, assigned_technician_id a from public.device_faults where visit_id = $1", [u.data])).rows?.[0];
  ok("الطارئة: طلب إصلاح مفتوح بمسؤول وتاريخ يراه الفني", f?.kind === "repair_request" && f?.status === "open" && f?.due === tomorrow && f?.a === ctx.tech_id, JSON.stringify(f ?? {}));
  ok("السجل التاريخي: الحالة الجديدة لا تغيّر سجل الفحص السابق", (await c.query("select status_after from public.maintenance_records where id = $1", [i1.id])).rows[0].status_after === "operational");
} catch (e) {
  if (e.message !== "stop") ok("تنفيذ الاختبار دون استثناء", false, `${e.code ?? ""} ${e.message}`);
} finally {
  await c.query("rollback");
}
const leftovers = created.filter(Boolean).length
  ? (await c.query("select count(*)::int n from public.visits where id = any($1::uuid[])", [created.filter(Boolean)])).rows[0].n : 0;
ok("لم يُحفظ أي أثر: الزيارات المنشأة في الاختبار غير موجودة بعد التراجع", leftovers === 0 || created.length === 0, leftovers);
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : results.map((r) => r.name) }, null, 2));
if (failed.length) process.exitCode = 1;
