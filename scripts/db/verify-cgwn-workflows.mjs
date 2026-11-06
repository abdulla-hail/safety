// اختبار وظيفي لدورات العمل التشغيلية كما ترسلها الواجهة (العملاء، المواقع، الفنيون، الإسناد، الكتالوج، الأجهزة وQR،
// أوامر العمل، الزيارات، الصيانة، المرفقات، التقارير، الإشعارات، الأرشفة) على قاعدة cgwn داخل معاملة يُتراجع عنها دائمًا.
// يُنشئ شركة وحسابات اختبار مؤقتة داخل المعاملة فقط؛ لا يُحفظ أي شيء ولا تُمس بيانات قائمة.
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

// --with-migration <file>: يطبّق ترحيلًا لم يُعتمد بعد داخل المعاملة نفسها (يُتراجع عنه مع الاختبار)
const mi = process.argv.indexOf("--with-migration");
const before = await fingerprint(c);
await c.query("begin");
try {
  if (mi > 0) await c.query((await import("node:fs")).readFileSync(process.argv[mi + 1], "utf8"));
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), tech = await mk("tech"), tech2 = await mk("tech2"), acct = await mk("accountant"), stranger = await mk("stranger");

  // شركة اختبار مؤقتة وأعضاؤها
  const created = await rpc(owner, "platform_create_company", [`شركة تشغيل ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const co = created.data?.company_id;
  await rpc(mgr, "accept_company_invitation", [created.data?.token]);
  for (const [uid, email, role] of [[tech, "tech", "technician"], [tech2, "tech2", "technician"], [acct, "accountant", "accountant"]]) {
    const inv = await rpc(mgr, "company_invite_member", [co, `${email}.${tag}@ays-test.invalid`, role, email, null, null, 24]);
    await rpc(uid, "accept_company_invitation", [inv.data?.token]);
  }
  const members = (await c.query("select count(*)::int n from public.company_memberships where company_id = $1 and status = 'active'", [co])).rows[0].n;
  ok("تجهيز: شركة نشطة بمدير وفنيين ومحاسب", members === 4, members);

  // العملاء (createCustomer / updateCustomer)
  const cust = await one(mgr, `insert into public.customers (company_id, name, customer_type, is_active, contact_name, phone, email, city, address,
      commercial_registration, vat_number, notes) values ($1, 'عميل أ', 'company', true, 'أحمد', '0500000000', 'a@x.sa', 'الرياض', null, null, null, null)
      returning id, ref_no`, [co]);
  ok("العملاء: المدير يضيف عميلًا ويقرأ معرّفه (insert + select)", /^CUS-\d{6}$/.test(cust.row?.ref_no ?? ""), cust.error);
  const cust2 = await one(mgr, "insert into public.customers (company_id, name) values ($1, 'عميل ب') returning id", [co]);
  const upd = await as(mgr, "update public.customers set city = 'جدة' where id = $1 and company_id = $2 returning id", [cust.row?.id, co]);
  ok("العملاء: المدير يعدّل عميلًا", upd.rows?.length === 1, upd.error);
  ok("العملاء: المحاسب يقرأ العملاء", (await count(acct, "select id from public.customers where company_id = $1", [co])) === 2);
  ok("العملاء: المحاسب لا يضيف عميلًا", (await as(acct, "insert into public.customers (company_id, name) values ($1, 'ممنوع')", [co])).code === "42501");
  ok("العملاء: من خارج الشركة لا يرى شيئًا", (await count(stranger, "select id from public.customers where company_id = $1", [co])) === 0);

  // المواقع
  const site = await one(mgr, `insert into public.customer_sites (company_id, customer_id, name, city, district, address, contact_name, contact_phone, notes)
      values ($1, $2, 'الفرع الرئيسي', 'الرياض', null, null, null, null, null) returning id, ref_no`, [co, cust.row?.id]);
  ok("المواقع: المدير يضيف موقعًا لعميل", /^SIT-\d{6}$/.test(site.row?.ref_no ?? ""), site.error);
  ok("المواقع: تعديل الموقع", (await as(mgr, "update public.customer_sites set name = 'الفرع 1' where id = $1 and company_id = $2 returning id", [site.row?.id, co])).rows?.length === 1);

  // الفنيون والإسناد
  // قبول دعوة الفني ينشئ سجل الفني التشغيلي المرتبط بعضويته تلقائيًا (ترحيل 20261029000100)
  const t1 = await one(mgr, "select id, ref_no from public.technicians where company_id = $1 and user_id = $2", [co, tech]);
  ok("الفنيون: قبول الدعوة أنشأ سجل فني مرتبطًا بالعضوية", /^TEC-\d{6}$/.test(t1.row?.ref_no ?? ""), t1.error);
  const t2 = await one(mgr, "select id from public.technicians where company_id = $1 and user_id = $2", [co, tech2]);
  ok("الفنيون: الفني الثاني مرتبط أيضًا", !!t2.row?.id, t2.error);
  ok("الفنيون: لا سجل مكرر لنفس العضو", (await as(mgr, "insert into public.technicians (company_id, full_name, user_id) values ($1, 'مكرر', $2)", [co, tech])).code === "23505");
  const tm = await one(mgr, `insert into public.technicians (company_id, full_name, phone, email, job_title, specialties, availability, is_active, hire_date, user_id, notes)
      values ($1, 'فني بلا حساب', null, null, 'فني', '{alarm}', 'available', true, null, null, null) returning id, ref_no`, [co]);
  ok("الفنيون: المدير يضيف فنيًا يدويًا دون حساب", /^TEC-\d{6}$/.test(tm.row?.ref_no ?? ""), tm.error);
  ok("الفنيون: ربط حساب ليس عضوًا يُرفض", (await as(mgr, "insert into public.technicians (company_id, full_name, user_id) values ($1, 'دخيل', $2)", [co, stranger])).code === "23514");
  ok("الفنيون: قائمة الأعضاء لربط الحساب ظاهرة للمدير", (await count(mgr, "select user_id from public.company_memberships where company_id = $1 and status = 'active'", [co])) === 4);
  const assignSql = `insert into public.technician_customers (company_id, technician_id, customer_id) values ($1, $2, $3)
      on conflict (technician_id, customer_id) do nothing`;
  ok("الإسناد: المدير يسند عميلًا لفني", !(await as(mgr, assignSql, [co, t1.row?.id, cust.row?.id])).error);
  ok("الإسناد: تكرار الإسناد يُتجاهل دون خطأ", !(await as(mgr, assignSql, [co, t1.row?.id, cust.row?.id])).error);
  ok("الإسناد: إشعار للفني عند الإسناد", (await count(tech, "select id from public.notifications where kind = 'assignment'")) === 1);
  ok("الإسناد: الفني لا يسند", (await as(tech, assignSql, [co, t1.row?.id, cust2.row?.id])).code === "42501");

  // ما يراه الفني: العملاء المسندون فقط
  ok("الفني يرى العميل المسند فقط", (await count(tech, "select id from public.customers where company_id = $1", [co])) === 1);
  ok("الفني يرى مواقع عميله المسند", (await count(tech, "select id from public.customer_sites where company_id = $1", [co])) === 1);
  // مقصود: نموذج تسجيل الصيانة يعرض فنيي الشركة لاختيار المشاركين (صلاحية maintenance.create)
  ok("الفني يرى فنيي شركته لاختيار المشاركين في الصيانة", (await count(tech, "select id from public.technicians where company_id = $1", [co])) === 3);
  ok("الفني لا يعدّل بيانات فني", (await as(tech, "update public.technicians set phone = '1' where company_id = $1 returning id", [co])).rows?.length === 0);
  ok("الفني الثاني (دون إسناد) لا يرى العملاء", (await count(tech2, "select id from public.customers where company_id = $1", [co])) === 0);

  // الكتالوج
  const sys = (await as(mgr, "select id, default_interval_days from public.safety_systems where company_id = $1 order by sort_order limit 1", [co])).rows?.[0];
  ok("الكتالوج: الأنظمة الافتراضية مزروعة للشركة الجديدة", !!sys);
  const item = await one(mgr, `insert into public.catalog_items (company_id, system_id, name, manufacturer, model, device_type, default_interval_days)
      values ($1, $2, 'كاشف دخان', 'Siemens', 'OH720', 'detector', 120) returning id, ref_no`, [co, sys?.id]);
  ok("الكتالوج: إضافة جهاز للكتالوج", /^CAT-\d{6}$/.test(item.row?.ref_no ?? ""), item.error);
  ok("الكتالوج: الفني يقرأ الكتالوج", (await count(tech, "select id from public.catalog_items where company_id = $1", [co])) === 1);

  // الأجهزة وQR
  const dev = await one(mgr, `insert into public.devices (company_id, customer_id, system_id, catalog_item_id, site_id, name, manufacturer, model, device_type,
      serial_number, location_detail, capacity, installed_at, expires_at, status, maintenance_interval_days, next_maintenance_at, notes)
      values ($1, $2, $3, $4, $5, '', null, null, null, 'SN-1', 'الدور الأول', null, null, null, 'operational', null, null, null)
      returning id, ref_no, qr_token, name, manufacturer, maintenance_interval_days, next_maintenance_at`, [co, cust.row?.id, sys?.id, item.row?.id, site.row?.id]);
  ok("الأجهزة: تسجيل جهاز من الكتالوج يرث الاسم والمصنع ومدة الصيانة", dev.row?.name === "كاشف دخان" && dev.row?.manufacturer === "Siemens"
    && dev.row?.maintenance_interval_days === 120 && dev.row?.next_maintenance_at, dev.error ?? JSON.stringify(dev.row));
  ok("الأجهزة: رقم مرجعي ورمز QR من 12 حرفًا", /^DEV-\d{6}$/.test(dev.row?.ref_no ?? "") && /^[A-Z2-9]{12}$/.test(dev.row?.qr_token ?? ""));
  const dup = await as(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name, manufacturer, serial_number) values ($1, $2, $3, $4, 'نسخة', 'siemens', 'sn-1')",
    [co, cust.row?.id, sys?.id, site.row?.id]);
  ok("الأجهزة: منع تكرار الرقم التسلسلي للمصنع نفسه (23505)", dup.code === "23505", dup.error);
  const wrongSite = await as(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name) values ($1, $2, $3, $4, 'خطأ')",
    [co, cust2.row?.id, sys?.id, site.row?.id]);
  ok("الأجهزة: موقع لا يتبع العميل يُرفض", wrongSite.code === "23514", wrongSite.error);
  // كل جهاز يُسجَّل في موقع محدد لدى عميله (ترحيل 20261102000100)
  const site2 = await one(mgr, "insert into public.customer_sites (company_id, customer_id, name) values ($1, $2, 'الموقع الرئيسي') returning id", [co, cust2.row?.id]);
  const dev2 = await one(mgr, "insert into public.devices (company_id, customer_id, system_id, site_id, name) values ($1, $2, $3, $4, 'طفاية') returning id", [co, cust2.row?.id, sys?.id, site2.row?.id]);
  ok("الأجهزة: تعديل جهاز", (await as(mgr, "update public.devices set location_detail = 'المدخل' where id = $1 and company_id = $2 returning id", [dev.row?.id, co])).rows?.length === 1);
  ok("الأجهزة: رمز QR لا يتغير", (await as(mgr, "update public.devices set qr_token = 'ABCDEFGHJKLM' where id = $1", [dev.row?.id])).code === "P0001");
  const resolve = async (uid) => (await rpc(uid, "resolve_device_token", [dev.row?.qr_token?.toLowerCase()])).data?.status;
  ok("QR: المدير يفتح الجهاز بالرمز (حتى بأحرف صغيرة)", (await resolve(mgr)) === "ok");
  ok("QR: الفني المسند يفتح الجهاز", (await resolve(tech)) === "ok");
  ok("QR: فني غير مسند يُمنع", (await resolve(tech2)) === "forbidden");
  ok("QR: من خارج الشركة يُمنع", (await resolve(stranger)) === "forbidden");
  ok("QR: رمز غير موجود", (await rpc(mgr, "resolve_device_token", ["ZZZZZZZZZZZZ"])).data?.status === "not_found");
  ok("الأجهزة: الفني يرى أجهزة عميله المسند فقط", (await count(tech, "select id from public.devices where company_id = $1", [co])) === 1);
  ok("الملصقات: قراءة بيانات الطباعة للأجهزة المحددة", (await count(mgr, `select d.id, d.ref_no, d.qr_token, d.name, c.name customer from public.devices d
      join public.customers c on c.id = d.customer_id where d.id = any($1::uuid[])`, [[dev.row?.id, dev2.row?.id]])) === 2);

  // أوامر العمل
  const wo = await one(mgr, `insert into public.work_orders (company_id, customer_id, site_id, title, description, order_type, priority, scheduled_for, due_at, status)
      values ($1, $2, $3, 'صيانة دورية للإنذار', null, 'preventive', 'high', now() + interval '1 day', null, 'scheduled') returning id, ref_no`, [co, cust.row?.id, site.row?.id]);
  ok("أوامر العمل: إنشاء أمر عمل", /^WO-\d{6}$/.test(wo.row?.ref_no ?? ""), wo.error);
  ok("أوامر العمل: ربط جهاز", !(await as(mgr, "insert into public.work_order_devices (work_order_id, device_id, company_id) values ($1, $2, $3)", [wo.row?.id, dev.row?.id, co])).error);
  ok("أوامر العمل: جهاز مكرر يُتجاهل (upsert)", !(await as(mgr, `insert into public.work_order_devices (work_order_id, device_id, company_id) values ($1, $2, $3)
      on conflict (work_order_id, device_id) do nothing`, [wo.row?.id, dev.row?.id, co])).error);
  ok("أوامر العمل: تعيين فني", !(await as(mgr, `insert into public.work_order_technicians (work_order_id, technician_id, company_id) values ($1, $2, $3)
      on conflict (work_order_id, technician_id) do nothing`, [wo.row?.id, t1.row?.id, co])).error);
  ok("أوامر العمل: إشعار الفني بالتعيين", (await count(tech, "select id from public.notifications where kind = 'work_order_assigned'")) === 1);
  ok("أوامر العمل: الفني يرى أمر العمل المعيّن له", (await count(tech, "select id from public.work_orders where company_id = $1", [co])) === 1);
  ok("أوامر العمل: الفني يرى أجهزة وفنيي أمره", (await count(tech, "select device_id from public.work_order_devices where work_order_id = $1", [wo.row?.id])) === 1
    && (await count(tech, "select technician_id from public.work_order_technicians where work_order_id = $1", [wo.row?.id])) === 1);
  ok("أوامر العمل: موقع عميل آخر يُرفض", (await as(mgr, "insert into public.work_orders (company_id, customer_id, site_id, title) values ($1, $2, $3, 'خطأ موقع')",
    [co, cust2.row?.id, site.row?.id])).code === "23514");
  ok("أوامر العمل: تعديل البيانات", (await as(mgr, "update public.work_orders set priority = 'critical' where id = $1 and company_id = $2 returning id", [wo.row?.id, co])).rows?.length === 1);
  ok("أوامر العمل: لا اعتماد قبل الاكتمال", (await as(mgr, `update public.work_orders set approved_at = now(), approved_by = $3 where id = $1 and company_id = $2
      and status = 'completed' and approved_at is null returning id`, [wo.row?.id, co, mgr])).rows?.length === 0);
  ok("أوامر العمل: الفني لا يغيّر الحالة (لا صلاحية)", (await as(tech, "update public.work_orders set status = 'completed' where id = $1 returning id", [wo.row?.id])).rows?.length === 0);
  ok("أوامر العمل: المدير يكمل الأمر", (await as(mgr, "update public.work_orders set status = 'completed', completed_at = now() where id = $1 and company_id = $2 returning id",
    [wo.row?.id, co])).rows?.length === 1);
  ok("أوامر العمل: إشعار الفني بتغير الحالة", (await count(tech, "select id from public.notifications where kind = 'work_order_status'")) === 1);
  const appr = await one(mgr, `update public.work_orders set approved_at = now(), approved_by = $3 where id = $1 and company_id = $2
      and status = 'completed' and approved_at is null returning approved_by`, [wo.row?.id, co, mgr]);
  ok("أوامر العمل: اعتماد الأمر المكتمل", appr.row?.approved_by === mgr, appr.error);

  // الزيارات
  const visit = await one(mgr, `insert into public.visits (company_id, customer_id, site_id, work_order_id, scheduled_start, scheduled_end, notes)
      values ($1, $2, $3, $4, now() + interval '2 day', now() + interval '2 day 2 hour', null) returning id, ref_no`, [co, cust.row?.id, site.row?.id, wo.row?.id]);
  ok("الزيارات: جدولة زيارة مرتبطة بأمر عمل", /^VIS-\d{6}$/.test(visit.row?.ref_no ?? ""), visit.error);
  ok("الزيارات: أمر عمل لعميل آخر يُرفض", (await as(mgr, "insert into public.visits (company_id, customer_id, work_order_id, scheduled_start) values ($1, $2, $3, now())",
    [co, cust2.row?.id, wo.row?.id])).code === "23514");
  ok("الزيارات: تعيين فني", !(await as(mgr, "insert into public.visit_technicians (visit_id, technician_id, company_id) values ($1, $2, $3)", [visit.row?.id, t1.row?.id, co])).error);
  ok("الزيارات: إشعار الفني بالزيارة", (await count(tech, "select id from public.notifications where kind = 'visit_scheduled'")) === 1);
  ok("الزيارات: تغيير الموعد يشعر الفني", !(await as(mgr, "update public.visits set scheduled_start = scheduled_start + interval '1 hour' where id = $1 returning id", [visit.row?.id])).error
    && (await count(tech, "select id from public.notifications where kind = 'visit_rescheduled'")) === 1);
  ok("الزيارات: الفني يبدأ الزيارة (visits.update)", (await as(tech, "update public.visits set status = 'in_progress', actual_start = now() where id = $1 and company_id = $2 returning id",
    [visit.row?.id, co])).rows?.length === 1);
  ok("الزيارات: الفني الثاني لا يرى الزيارة", (await count(tech2, "select id from public.visits where company_id = $1", [co])) === 0);

  // الصيانة (بعد 20261106000100: النتائج عبر الزيارة فقط — بدء/استئناف، بند لكل جهاز، إغلاق)
  const started = await rpc(tech, "visit_start", [crypto.randomUUID(), site.row?.id, "periodic", null, null, null]);
  ok("الصيانة: الفني يستأنف الزيارة الدورية المفتوحة للموقع بدل إنشاء أخرى", started.data === visit.row?.id, started.error ?? started.data);
  const vItem = (await as(tech, "select id, version from public.visit_devices where visit_id = $1 and device_id = $2", [visit.row?.id, dev.row?.id])).rows?.[0];
  const saved = await rpc(tech, "visit_save_item", [vItem?.id, { inspection_status: "inspected", result: "pass_with_notes", status_after: "needs_maintenance", notes: "بطارية ضعيفة" }, vItem?.version]);
  ok("الصيانة: الفني المسند يحفظ نتيجة الجهاز", saved.data === (vItem?.version ?? 0) + 1, saved.error);
  const closed = await rpc(tech, "visit_close", [visit.row?.id, null, null]);
  ok("الصيانة: إغلاق الزيارة ينشئ السجل", closed.data && !closed.data.already_closed && closed.data.inspected >= 1, closed.error ?? JSON.stringify(closed.data));
  const mr = await one(tech, "select id, ref_no, next_due_at from public.maintenance_records where visit_id = $1 and device_id = $2", [visit.row?.id, dev.row?.id]);
  ok("الصيانة: ربط الفني بالسجل تلقائيًا", (await count(tech, "select record_id from public.maintenance_record_technicians where record_id = $1 and technician_id = $2", [mr.row?.id, t1.row?.id])) === 1, mr.error);
  const dAfter = (await c.query("select status, last_maintenance_at, next_maintenance_at from public.devices where id = $1", [dev.row?.id])).rows[0];
  ok("الصيانة: حالة الجهاز وموعده يُحدّثان تلقائيًا", dAfter.status === "needs_maintenance" && dAfter.last_maintenance_at && dAfter.next_maintenance_at, JSON.stringify(dAfter));
  ok("الصيانة: لا سجل صيانة مباشر بلا زيارة", !!(await as(tech, `insert into public.maintenance_records (company_id, device_id, action, result, status_after)
      values ($1, $2, 'inspection', 'pass', 'operational')`, [co, dev.row?.id])).error);
  ok("الصيانة: الفني لا يبدأ زيارة لموقع عميل غير مسند", (await rpc(tech, "visit_start", [crypto.randomUUID(), site2.row?.id, "periodic", null, null, null])).code === "42501");
  ok("الصيانة: السجل التاريخي لا يُعدّل", !!(await as(mgr, "update public.maintenance_records set notes = 'x' where id = $1", [mr.row?.id])).error);
  ok("الصيانة: المحاسب يقرأ السجلات", (await count(acct, "select id from public.maintenance_records where company_id = $1", [co])) === 1);

  // المرفقات
  const att = await as(mgr, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes)
      values ($1, 'device', $2, $3, 'صورة.png', 'image/png', 1000)`, [co, dev.row?.id, `${co}/device/${dev.row?.id}/x-${tag}.png`]);
  ok("المرفقات: تسجيل مرفق جهاز", !att.error, att.error);
  ok("المرفقات: المحاسب لا يرفع مرفقًا", (await as(acct, `insert into public.attachments (company_id, entity_type, entity_id, storage_path, file_name)
      values ($1, 'device', $2, $3, 'y.png')`, [co, dev.row?.id, `${co}/device/${dev.row?.id}/y-${tag}.png`])).code === "42501");

  // التقارير
  ok("التقارير: الأجهزة حسب النظام", (await count(mgr, "select * from public.report_devices_by_system where company_id = $1", [co])) >= 1);
  ok("التقارير: ملخص العملاء", (await count(mgr, "select * from public.report_customer_summary where company_id = $1", [co])) === 2);
  ok("التقارير: لا يرى غير الأعضاء التقارير", (await count(stranger, "select * from public.report_customer_summary where company_id = $1", [co])) === 0);

  // الإشعارات
  // تجهيز تأخر كمسؤول القاعدة (ليس طلب واجهة): تغيير الموعد من الواجهة صار بإجراء device_set_next_due فقط
  await c.query("select set_config('request.jwt.claims', '', true)");
  await c.query("update public.devices set next_maintenance_at = current_date - 1 where id = $1", [dev2.row?.id]);
  const alerts = await rpc(mgr, "run_maintenance_alerts", [co]);
  ok("التنبيهات: تشغيل تنبيهات الصيانة", alerts.data >= 1, alerts.error ?? alerts.data);
  ok("التنبيهات: التشغيل المتكرر خلال ساعة لا يكرر", (await rpc(mgr, "run_maintenance_alerts", [co])).data === 0);
  ok("الإشعارات: المدير يتلقى تنبيه التأخير", (await count(mgr, "select id from public.notifications where kind = 'maintenance_overdue'")) === 1);
  const ctx = (await rpc(tech, "get_my_context", [])).data;
  ok("الإشعارات: عدد غير المقروء في get_my_context للفني", ctx?.unread_notifications >= 4, ctx?.unread_notifications);
  ok("الإشعارات: الفني يحدد الكل كمقروء", !(await as(tech, "update public.notifications set read_at = now() where read_at is null and recipient_user_id = $1", [tech])).error
    && (await count(tech, "select id from public.notifications where read_at is null")) === 0);
  ok("الإشعارات: لا يمكن تعديل نص الإشعار", (await as(tech, "update public.notifications set title = 'x' where recipient_user_id = $1", [tech])).code === "42501");
  ok("الإشعارات: لا يرى أحد إشعارات غيره", (await count(acct, "select id from public.notifications where recipient_user_id = $1", [tech])) === 0);

  // الأرشفة والحذف
  ok("الأرشفة: المدير يؤرشف جهازًا", (await as(mgr, "update public.devices set archived_at = now() where id = $1 and company_id = $2 returning archived_by", [dev2.row?.id, co])).rows?.[0]?.archived_by === mgr);
  ok("الأرشفة: الفني لا يؤرشف", (await as(tech, "update public.visits set archived_at = now() where id = $1", [visit.row?.id])).code === "42501");
  const del = await as(mgr, "delete from public.customers where id = $1 and company_id = $2 returning id", [cust.row?.id, co]);
  ok("الحذف: عميل له أجهزة لا يُحذف نهائيًا (يُقترح الأرشفة)", del.code === "23503", del.error);
  ok("سجل التدقيق: العمليات مسجلة للمدير", (await count(mgr, "select id from public.company_audit_log where company_id = $1", [co])) >= 15);

  // العضوية: مالك المنصة يرى العضويات لا البيانات التشغيلية، ولا يدير مدير شركة أعضاء شركة أخرى
  const mgrB = await mk("managerB");
  const createdB = await rpc(owner, "platform_create_company", [`شركة ثانية ${tag}`, `managerB.${tag}@ays-test.invalid`, null, null, null, 24]);
  await rpc(mgrB, "accept_company_invitation", [createdB.data?.token]);
  const coB = createdB.data?.company_id;
  ok("المالك يرى عضويات الشركة", (await count(owner, "select id from public.company_memberships where company_id = $1", [co])) >= 4);
  ok("المالك لا يرى عملاء أو أجهزة الشركة", (await count(owner, "select id from public.customers where company_id = $1", [co])) === 0
    && (await count(owner, "select id from public.devices where company_id = $1", [co])) === 0);
  const techMember = (await c.query("select id from public.company_memberships where company_id = $1 and user_id = $2", [co, tech])).rows[0].id;
  ok("مدير شركة أخرى لا يعطّل عضوًا هنا", !!(await rpc(mgrB, "company_set_member_status", [techMember, "suspended"])).error);
  ok("مدير شركة أخرى لا يدعو إلى هذه الشركة", !!(await rpc(mgrB, "company_invite_member", [co, `x.${tag}@ays-test.invalid`, "technician", null, null, null, 24])).error);
  ok("مدير شركة أخرى لا يرى عضويات هذه الشركة", (await count(mgrB, "select id from public.company_memberships where company_id = $1", [co])) === 0);

  // تعطيل عضو فني يوقف سجله التشغيلي ولا يحذفه
  await rpc(mgr, "company_set_member_status", [techMember, "suspended"]);
  ok("تعطيل العضو الفني يوقف سجله دون حذف", (await c.query("select is_active from public.technicians where user_id = $1", [tech])).rows[0]?.is_active === false);
  ok("العضو المعطّل لا يرى بيانات الشركة", (await count(tech, "select id from public.customers where company_id = $1", [co])) === 0);
  await rpc(mgr, "company_set_member_status", [techMember, "active"]);

  // صفحة الدعوة بهوية الشركة (قبل الدخول): الهوية والتفاصيل برمز صالح فقط
  const invL = (await rpc(mgr, "company_invite_member", [co, `landing.${tag}@ays-test.invalid`, "supervisor", "مشرف", null, null, 24])).data;
  const land = (await rpc(null, "invitation_landing", [invL?.token])).data;
  ok("صفحة الدعوة: الزائر يرى اسم الشركة والدور والصلاحيات", land?.status === "pending" && land?.company_name?.includes("شركة تشغيل") && land?.role === "supervisor" && land?.permissions?.length > 0);
  ok("صفحة الدعوة: لا يُكشف البريد كاملًا ولا بيانات تشغيلية", !JSON.stringify(land).includes(`landing.${tag}@`) && !JSON.stringify(land).includes("عميل أ"));
  ok("صفحة الدعوة: رمز غير صحيح لا يكشف شيئًا", JSON.stringify((await rpc(null, "invitation_landing", ["Z".repeat(43)])).data) === JSON.stringify({ status: "invalid" }));
  await rpc(mgr, "company_revoke_invitation", [invL?.invitation_id]);
  const landR = (await rpc(null, "invitation_landing", [invL?.token])).data;
  ok("صفحة الدعوة: الملغاة تعرض الهوية دون التفاصيل", landR?.status === "revoked" && !!landR?.company_name && landR?.permissions === undefined);

  // دعوة فني بتخصصات وصلاحيات مخصصة عبر الرابط
  const tech4 = await mk("tech4");
  const inv4 = await rpc(mgr, "company_invite_member", [co, `tech4.${tag}@ays-test.invalid`, "technician", "فني رابط", "فني", "alarm,pumps", 24]);
  ok("صلاحيات مخصصة للدعوة (المدير)", !(await rpc(mgr, "company_set_invitation_permissions", [inv4.data?.invitation_id, ["field.assigned", "maintenance.create", "devices.print"]])).error);
  ok("مدير شركة أخرى لا يخصص صلاحيات الدعوة", !!(await rpc(mgrB, "company_set_invitation_permissions", [inv4.data?.invitation_id, ["devices.view"]])).error);
  ok("غير المدعو لا يقبل الدعوة", !!(await rpc(stranger, "accept_company_invitation", [inv4.data?.token])).error);
  ok("الفني المدعو يقبل الدعوة", !(await rpc(tech4, "accept_company_invitation", [inv4.data?.token])).error);
  ok("لا قبول ثانٍ للدعوة نفسها", !!(await rpc(tech4, "accept_company_invitation", [inv4.data?.token])).error);
  const t4 = (await c.query("select company_id, specialties, full_name from public.technicians where user_id = $1", [tech4])).rows;
  ok("سجل فني واحد بالشركة الصحيحة والتخصصات", t4.length === 1 && t4[0].company_id === co && t4[0].specialties.join() === "alarm,pumps", JSON.stringify(t4));
  const ctx4 = (await rpc(tech4, "get_my_context", [])).data;
  ok("الصلاحيات المخصصة طُبقت عند القبول", ctx4?.memberships?.[0]?.permissions?.join() === "devices.print,field.assigned,maintenance.create", JSON.stringify(ctx4?.memberships?.[0]?.permissions));
  ok("الفني لا يرى شركة أخرى", (await count(tech4, "select id from public.companies where id = $1", [coB])) === 0);

  // مساعد المالك: بدعوة من المالك فقط، بالبريد نفسه، بصلاحيات محددة، ولا وصول تشغيلي
  const asst = await mk("assistant");
  ok("مساعد: مسار طلب الانضمام القديم مغلق", !!(await rpc(asst, "platform_request_assistant", ["مساعد اختبار", null])).error);
  ok("مساعد: غير المالك لا يدعو مساعدًا", !!(await rpc(mgr, "platform_invite_assistant", [`assistant.${tag}@ays-test.invalid`, null, ["platform.companies.view"], 24])).error);
  const ainv = (await rpc(owner, "platform_invite_assistant", [`assistant.${tag}@ays-test.invalid`, "مساعد اختبار", ["platform.companies.view"], 24])).data;
  ok("مساعد: المالك ينشئ دعوة بصلاحية العرض", !!ainv?.token);
  ok("مساعد: صفحة الدعوة قبل الدخول تعرض الصلاحيات دون البريد", (await rpc(null, "assistant_invitation_landing", [ainv?.token])).data?.permissions?.join() === "platform.companies.view");
  ok("مساعد: غير المدعو لا يقبل", !!(await rpc(stranger, "accept_platform_assistant_invitation", [ainv?.token])).error);
  ok("مساعد: المدعو يقبل مرة واحدة فقط", !(await rpc(asst, "accept_platform_assistant_invitation", [ainv?.token])).error
    && !!(await rpc(asst, "accept_platform_assistant_invitation", [ainv?.token])).error);
  ok("مساعد: لا يدعو مساعدين آخرين", !!(await rpc(asst, "platform_invite_assistant", [`x.${tag}@ays-test.invalid`, null, ["platform.companies.view"], 24])).error);
  ok("مساعد: لا يغيّر شعار المنصة دون صلاحية صريحة", !!(await rpc(asst, "platform_set_logo", [null])).error);
  ok("مساعد: يرى الشركات والعضويات", (await count(asst, "select id from public.companies where id = $1", [co])) === 1
    && (await count(asst, "select id from public.company_memberships where company_id = $1", [co])) >= 4);
  ok("مساعد: لا يرى العملاء ولا الأجهزة", (await count(asst, "select id from public.customers where company_id = $1", [co])) === 0
    && (await count(asst, "select id from public.devices where company_id = $1", [co])) === 0);
  ok("مساعد: لا ينشئ شركة بلا صلاحية", !!(await rpc(asst, "platform_create_company", [`x ${tag}`, `m.${tag}@ays-test.invalid`, null, null, null, 24])).error);
  ok("مساعد: لا يغيّر حالة شركة بلا صلاحية", !!(await rpc(asst, "platform_set_company_status", [co, "suspended"])).error);
  await rpc(owner, "platform_update_assistant", [asst, null, "suspended"]);
  ok("مساعد: التعطيل يوقف الوصول فورًا", (await count(asst, "select id from public.companies")) === 0);

  // صورة الجهاز: المسار والعزل
  const imgPath = `${co}/device-image/${dev.row?.id}/img-${tag}.png`;
  ok("صورة: رفض مسار شركة أخرى", (await as(mgr, "update public.devices set image_path = $1 where id = $2", [`${coB}/device-image/${dev.row?.id}/x.png`, dev.row?.id])).code === "23514");
  ok("صورة: المدير يرفع إلى مسار شركته", !(await as(mgr, "insert into storage.objects (bucket_id, name) values ('org-files', $1)", [imgPath])).error);
  ok("صورة: مدير شركة أخرى لا يرفع إلى مسارها", (await as(mgrB, "insert into storage.objects (bucket_id, name) values ('org-files', $1)", [`${co}/device-image/${dev.row?.id}/evil.png`])).code === "42501");
  ok("صورة: حفظ المسار في سجل الجهاز", !(await as(mgr, "update public.devices set image_path = $1 where id = $2", [imgPath, dev.row?.id])).error);
  ok("صورة: الفني المسند يراها", (await count(tech, "select name from storage.objects where name = $1", [imgPath])) === 1);
  ok("صورة: الفني غير المسند لا يراها", (await count(tech2, "select name from storage.objects where name = $1", [imgPath])) === 0);
  ok("صورة: شركة أخرى لا تراها", (await count(mgrB, "select name from storage.objects where name = $1", [imgPath])) === 0);
  // Supabase يمنع الحذف المباشر من جداول التخزين بمشغّل (storage.protect_delete)؛ الحذف عبر Storage API يخضع لسياسة الحذف
  const del2 = await as(acct, "delete from storage.objects where name = $1 returning id", [imgPath]);
  ok("صورة: المحاسب لا يحذفها", (del2.rows?.length ?? 0) === 0, del2.error);
  const pol = (await c.query(`select public.company_has_any_perm(app_private.storage_company($1), array['devices.update','devices.create']) as acct_allowed
      from (select set_config('request.jwt.claim.sub', $2, true)) s`, [imgPath, acct])).rows[0];
  ok("صورة: سياسة الحذف ترفض المحاسب (فحص الشرط مباشرة)", pol.acct_allowed === false);
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
const changed = Object.keys({ ...before, ...after }).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
ok("لم يُحفظ أي أثر للاختبار (البصمات مطابقة)", changed.length === 0,
  `تغيرت: ${changed.map((t) => `${t} ${before[t]?.rows}→${after[t]?.rows}`).join("، ")} (قد يكون نشاطًا متزامنًا من التطبيق)`);
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ rolled_back: true, passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : undefined }, null, 2));
if (failed.length) process.exitCode = 1;
