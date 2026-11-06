// قياس أداء الاستعلامات تحت RLS والحذف الكامل على بيانات اصطناعية كبيرة في PGlite محلي (لا اتصال بأي قاعدة حية):
// بالترحيلات الحالية، ثم مع فهارس المفاتيح المقترحة (20261109000200)، ثم مع تسريع RLS (20261109000300). الأزمنة نسبية (PGlite أبطأ من Postgres الفعلي).
// الاستخدام: node scripts/perf/pglite-scale.mjs [عدد الأجهزة، افتراضي 4000]
import { pgliteBase } from "./pglite-base.mjs";

const DEVICES = Number(process.argv[2] ?? 4000);
const PURGE = "20261109000100_company_purge.sql";
const INDEXES = "20261109000200_fk_indexes.sql";
const RLS = "20261109000300_rls_initplan.sql";

async function run(proposed) {
  // الأساس دون الفهرس وRLS (طُبّقا 2026-10-28) ثم يُضافان حسب التشغيل، فتبقى المقارنة «قبل/بعد» صحيحة
  const db = await pgliteBase([PURGE, ...proposed], [INDEXES, RLS]);
  const user = async (email) => (await db.query("insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), $1, now()) returning id", [email])).rows[0].id;
  const as = (uid, sql, params = []) => db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ role: "authenticated", sub: uid })]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
  const rpc = async (uid, fn, args) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args))[0].r;

  const owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [owner]);
  const c = await rpc(owner, "platform_create_company", ["شركة كبيرة", "m@big.invalid", null, null, null, 24]);
  const co = c.company_id;
  const mgr = await user("m@big.invalid");
  await rpc(mgr, "accept_company_invitation", [c.token]);
  const tech = await user("t@big.invalid");
  const inv = await rpc(mgr, "company_invite_member", [co, "t@big.invalid", "technician", "فني", null, null, 24]);
  await rpc(tech, "accept_company_invitation", [inv.token]);
  const techId = (await db.query("select id from public.technicians where user_id = $1", [tech])).rows[0].id;

  // تعبئة جماعية بلا مشغلات (session_replication_role = replica) ببيانات متسقة
  const nCust = Math.max(10, Math.round(DEVICES / 20));
  const t0 = performance.now();
  await db.exec(`set session_replication_role = replica;
    insert into public.customers (id, company_id, name, ref_no) select gen_random_uuid(), '${co}', 'عميل ' || g, 'CUS-' || g from generate_series(1, ${nCust}) g;
    insert into public.customer_sites (id, company_id, customer_id, name, ref_no)
      select gen_random_uuid(), c.company_id, c.id, 'موقع ' || s, c.ref_no || '-S' || s from public.customers c, generate_series(1, 2) s where c.company_id = '${co}';
    insert into public.devices (id, company_id, customer_id, site_id, name, ref_no, qr_token, next_maintenance_at, maintenance_interval_months)
      select gen_random_uuid(), s.company_id, s.customer_id, s.id, 'جهاز ' || d, s.ref_no || '-D' || d, md5(random()::text), current_date + ((random() * 120)::int - 60), 3
      from public.customer_sites s, generate_series(1, 10) d where s.company_id = '${co}';
    insert into public.visits (id, company_id, customer_id, site_id, scheduled_start, status, ref_no)
      select gen_random_uuid(), s.company_id, s.customer_id, s.id, now() - (v || ' days')::interval, 'completed', s.ref_no || '-V' || v
      from public.customer_sites s, generate_series(1, 8) v where s.company_id = '${co}';
    insert into public.visit_devices (id, company_id, visit_id, device_id, customer_id, site_id)
      select gen_random_uuid(), v.company_id, v.id, d.id, v.customer_id, v.site_id
      from public.visits v join lateral (select id from public.devices d where d.site_id = v.site_id limit 2) d on true where v.company_id = '${co}';
    insert into public.maintenance_records (id, company_id, device_id, customer_id, site_id, visit_id, action, result, status_after, ref_no)
      select vd.id, vd.company_id, vd.device_id, vd.customer_id, vd.site_id, vd.visit_id, 'inspection', 'pass', 'operational', 'MNT-' || row_number() over ()
      from public.visit_devices vd where vd.company_id = '${co}';
    insert into public.work_orders (id, company_id, customer_id, site_id, title, ref_no)
      select gen_random_uuid(), s.company_id, s.customer_id, s.id, 'أمر عمل', s.ref_no || '-W' from public.customer_sites s where s.company_id = '${co}';
    insert into public.device_faults (id, company_id, device_id, customer_id, site_id, visit_id, work_order_id, description, ref_no)
      select gen_random_uuid(), v.company_id, vd.device_id, v.customer_id, v.site_id, v.id, w.id, 'عطل اختبار', 'FLT-' || row_number() over ()
      from public.visits v join public.visit_devices vd on vd.visit_id = v.id join public.work_orders w on w.site_id = v.site_id
      where v.company_id = '${co}' and random() < 0.1;
    insert into public.device_maintenance_cycles (company_id, device_id, customer_id, site_id, due_date)
      select company_id, id, customer_id, site_id, next_maintenance_at from public.devices where company_id = '${co}';
    insert into public.technician_customers (company_id, technician_id, customer_id)
      select '${co}', '${techId}', id from public.customers where company_id = '${co}' order by ref_no limit ${Math.max(2, Math.round(nCust / 10))};
    insert into public.notifications (company_id, recipient_user_id, kind, title) select '${co}', '${mgr}', 'info', 'إشعار ' || g from generate_series(1, ${DEVICES / 2}) g;
    set session_replication_role = origin;
    analyze;`);
  const seedMs = Math.round(performance.now() - t0);
  const counts = (await db.query(`select (select count(*) from public.devices)::int devices, (select count(*) from public.visits)::int visits,
    (select count(*) from public.maintenance_records)::int records, (select count(*) from public.device_faults)::int faults`)).rows[0];

  const ids = (await db.query(`select (select id from public.customer_sites where company_id = $1 order by ref_no offset 7 limit 1) site,
    (select id from public.visits where company_id = $1 order by ref_no offset 11 limit 1) visit,
    (select id from public.work_orders where company_id = $1 order by ref_no offset 5 limit 1) wo,
    (select id from public.devices where company_id = $1 order by ref_no offset 13 limit 1) device`, [co])).rows[0];

  const Q = {
    "get_my_context (مدير)": [mgr, "select public.get_my_context()"],
    "قائمة الأجهزة صفحة 1 + العدد (مدير)": [mgr, `select d.id, d.ref_no, d.name, c.name, s.name, count(*) over () from public.devices d
      left join public.customers c on c.id = d.customer_id left join public.customer_sites s on s.id = d.site_id
      where d.company_id = $1 and d.archived_at is null order by d.ref_no limit 25`, [co]],
    "لوحة التحكم: المتأخر (مدير)": [mgr, "select count(*) from public.devices where company_id = $1 and archived_at is null and next_maintenance_at < current_date", [co]],
    "زيارات موقع (مدير)": [mgr, "select id, ref_no, scheduled_start, status from public.visits where site_id = $1 order by scheduled_start desc limit 20", [ids.site]],
    "سجلات زيارة (مدير)": [mgr, "select id, device_id, result from public.maintenance_records where visit_id = $1", [ids.visit]],
    "بلاغات أمر عمل (مدير)": [mgr, "select id, status from public.device_faults where work_order_id = $1", [ids.wo]],
    "زيارات أمر عمل (مدير)": [mgr, "select id from public.visits where work_order_id = $1", [ids.wo]],
    "صفحة جهاز: سجله (مدير)": [mgr, "select id, result, created_at from public.maintenance_records where device_id = $1 order by created_at desc limit 20", [ids.device]],
    "عملي: مستحقات الفني (فني)": [tech, "select d.id, d.name, d.next_maintenance_at from public.devices d where d.company_id = $1 and d.archived_at is null and d.next_maintenance_at <= current_date + 7 order by d.next_maintenance_at limit 50", [co]],
    "قائمة الأجهزة (فني، RLS نطاق الإسناد)": [tech, "select count(*) from public.devices where company_id = $1", [co]],
  };
  const out = {};
  for (const [name, [uid, sql, params]] of Object.entries(Q)) {
    const t = [];
    for (let i = 0; i < 5; i++) { const s = performance.now(); await as(uid, sql, params ?? []); t.push(performance.now() - s); }
    t.sort((a, b) => a - b);
    out[name] = Math.round(t[2] * 10) / 10;
  }
  const s = performance.now();
  await rpc(owner, "platform_purge_company", ["" + co, "شركة كبيرة", false]).catch((e) => { out.purge_error = e.message; });
  out["الحذف الكامل للشركة"] = Math.round(performance.now() - s);
  await db.close();
  return { seedMs, counts, ms: out };
}

await run([]); // تحمية WASM (التشغيل الأول أبطأ دائمًا) — لا تُحتسب
const before = await run([]);
const idx = await run([INDEXES]);
const after = await run([INDEXES, RLS]);
console.log(JSON.stringify({ devices: DEVICES, counts: before.counts, note: "الوسيط من 5 تشغيلات بالمللي ثانية؛ PGlite (WASM) أبطأ من Postgres الفعلي — للمقارنة النسبية فقط" }, null, 1));
console.log("الاستعلام | الحالي | + الفهارس | + الفهارس وRLS");
for (const k of Object.keys(before.ms)) console.log(`${k} | ${before.ms[k]} | ${idx.ms[k]} | ${after.ms[k]}`);
