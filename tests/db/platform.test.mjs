// اختبارات قاعدة البيانات: العزل، الصلاحيات، الأرقام المرجعية، QR، الإسناد، الإشعارات، التدقيق.
// تشغيل محلي (Postgres مضمّن): npm run test:db
// تشغيل على قاعدة Supabase الفعلية داخل معاملة يُتراجع عنها دائمًا: npm run test:live
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, asUser, createUser, errorCode } from "./harness.mjs";

const LIVE = process.env.LIVE_DB === "1";
const tag = LIVE ? `-${Date.now().toString(36)}` : "";
const mail = (name) => `${name}${tag}@ays-test.invalid`;

let db;
const u = {};
const org = {};

async function q(userId, sql, params = []) {
  return asUser(db, userId, async (tx) => (await tx.query(sql, params)).rows);
}

before(async () => {
  if (LIVE) {
    const { createLiveDb } = await import("./live-harness.mjs");
    db = await createLiveDb();
  } else db = await createTestDb({
    seed: async (d) => {
      // بيانات «قائمة» قبل الترحيل للتأكد من الحفاظ عليها وترقيمها
      const { rows } = await d.query("insert into public.organizations (name, status) values ('شركة قائمة', 'approved') returning id");
      await d.query("insert into public.customers (organization_id, name) values ($1, 'عميل قديم 1'), ($1, 'عميل قديم 2')", [rows[0].id]);
    },
  });
  u.platform = await createUser(db, mail("platform"));
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.platform]);
  u.ownerA = await createUser(db, mail("a.owner"), "مالك أ");
  u.ownerB = await createUser(db, mail("b.owner"), "مالك ب");
  u.tech = await createUser(db, mail("tech"), "فني");
  u.viewer = await createUser(db, mail("viewer"), "مشاهد");
  u.stranger = await createUser(db, mail("stranger"), "غريب");

  org.A = (await q(u.ownerA, "select public.request_company('شركة أ', '101', null, 'الرياض') as id"))[0].id;
  org.B = (await q(u.ownerB, "select public.request_company('شركة ب') as id"))[0].id;
});

after(async () => {
  if (db?.close) await db.close();
});

test("البيانات القائمة محفوظة ومرقّمة دون فقد", { skip: LIVE && "يُختبر محليًا فقط" }, async () => {
  const rows = (await db.query("select name, ref_no from public.customers order by ref_no")).rows;
  assert.deepEqual(rows.map((r) => r.ref_no), ["CUS-000001", "CUS-000002"]);
  const orgs = (await db.query("select ref_no from public.organizations order by ref_no")).rows;
  assert.equal(orgs[0].ref_no, "ORG-000001");
});

test("طلب الشركة لا يمنح أي وصول قبل اعتماد مالك المنصة", async () => {
  const ctx = (await q(u.ownerA, "select public.get_my_context() as c"))[0].c;
  assert.equal(ctx.memberships[0].member_status, "pending");
  assert.equal(ctx.memberships[0].permissions.length, 0);
  assert.equal(await errorCode(q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'x')", [org.A])), "42501");
  // ليس لغير مالك المنصة اعتماد الشركات
  assert.equal(await errorCode(q(u.ownerA, "select public.platform_set_company_status($1, 'approved')", [org.A])), "42501");
});

test("اعتماد مالك المنصة يفعّل المالك بكل الصلاحيات ويزرع الكتالوج", async () => {
  await q(u.platform, "select public.platform_set_company_status($1, 'approved')", [org.A]);
  await q(u.platform, "select public.platform_set_company_status($1, 'approved')", [org.B]);
  const ctx = (await q(u.ownerA, "select public.get_my_context() as c"))[0].c;
  assert.equal(ctx.memberships[0].member_status, "active");
  assert.ok(ctx.memberships[0].permissions.includes("users.permissions"));
  assert.ok(!ctx.memberships[0].permissions.includes("field.assigned"));
  const systems = await q(u.ownerA, "select name from public.safety_systems");
  assert.equal(systems.length, 7);
});

test("الأرقام المرجعية: تلقائية، متسلسلة لكل شركة، ثابتة، لا يعاد استخدامها", async () => {
  const c1 = (await q(u.ownerA, "insert into public.customers (organization_id, name, ref_no) values ($1, 'ع1', 'CUS-999999') returning id, ref_no", [org.A]))[0];
  assert.equal(c1.ref_no, "CUS-000001"); // القيمة المرسلة من الواجهة تُتجاهل
  const c2 = (await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'ع2') returning id, ref_no", [org.A]))[0];
  assert.equal(c2.ref_no, "CUS-000002");
  assert.equal(await errorCode(q(u.ownerA, "update public.customers set ref_no = 'CUS-000050' where id = $1", [c2.id])), "P0001");
  await q(u.ownerA, "delete from public.customers where id = $1", [c2.id]);
  const c3 = (await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'ع3') returning ref_no", [org.A]))[0];
  assert.equal(c3.ref_no, "CUS-000003");
  const b1 = (await q(u.ownerB, "insert into public.customers (organization_id, name) values ($1, 'عميل ب') returning ref_no", [org.B]))[0];
  assert.equal(b1.ref_no, "CUS-000001"); // نطاق التفرد: لكل شركة
});

test("الأرقام المرجعية تحت إدراجات متتالية سريعة لا تتكرر", async () => {
  const inserts = Array.from({ length: 40 }, (_, i) =>
    q(u.ownerA, "insert into public.technicians (organization_id, full_name) values ($1, $2) returning ref_no", [org.A, `فني ${i}`]));
  const refs = (await Promise.all(inserts)).map((r) => r[0].ref_no);
  assert.equal(new Set(refs).size, 40);
});

test("عزل الشركات: لا قراءة ولا كتابة ولا نقل بين الشركات", async () => {
  const bCustomers = await q(u.ownerA, "select id from public.customers where organization_id = $1", [org.B]);
  assert.equal(bCustomers.length, 0);
  assert.equal(await errorCode(q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'تسلل')", [org.B])), "42501");
  const [bc] = await q(u.ownerB, "select id from public.customers limit 1");
  const updated = await q(u.ownerA, "update public.customers set name = 'مخترق' where id = $1 returning id", [bc.id]);
  assert.equal(updated.length, 0);
  const [ac] = await q(u.ownerA, "select id from public.customers limit 1");
  assert.equal(await errorCode(q(u.ownerA, "update public.customers set organization_id = $1 where id = $2", [org.B, ac.id])), "42501");
  // الغريب بلا عضوية لا يرى شيئًا
  assert.equal((await q(u.stranger, "select id from public.customers")).length, 0);
  assert.equal((await q(u.stranger, "select id from public.organizations")).length, 0);
  // anon لا يملك أي وصول للجداول الجديدة
  assert.equal(await errorCode(q(null, "select id from public.devices")), "42501");
});

test("الدعوة والصلاحيات المتعددة ومنع التصعيد", async () => {
  await q(u.ownerA, "select public.invite_member($1, $2, 'مشاهد', array['customers.view','reports.view','users.invite'], array['supervisor'])", [org.A, mail("Viewer")]);
  const accepted = (await q(u.viewer, "select public.accept_my_invitations() as n"))[0].n;
  assert.equal(accepted, 1);
  const ctx = (await q(u.viewer, "select public.get_my_context() as c"))[0].c;
  const m = ctx.memberships.find((x) => x.organization_id === org.A);
  assert.equal(m.member_status, "active");
  assert.deepEqual(m.permissions.sort(), ["customers.view", "reports.view", "users.invite"]);

  // المشاهد يقرأ ولا يضيف
  assert.ok((await q(u.viewer, "select id from public.customers")).length > 0);
  assert.equal(await errorCode(q(u.viewer, "insert into public.customers (organization_id, name) values ($1, 'x')", [org.A])), "42501");
  // لا يمنح صلاحيات لا يملكها (لا يملك users.permissions أصلًا)
  assert.equal(await errorCode(q(u.viewer, "select public.invite_member($1, 'x@y.z', null, array['customers.delete'])", [org.A])), "42501");
  // لا يستطيع تعديل صلاحياته بنفسه
  assert.equal(await errorCode(q(u.viewer, "select public.set_member_permissions($1, array['customers.delete'])", [m.member_id])), "42501");
  // لا كتابة مباشرة على جدول الصلاحيات
  assert.equal(await errorCode(q(u.viewer, "insert into public.member_permissions (member_id, permission_key, organization_id) values ($1, 'users.permissions', $2)", [m.member_id, org.A])), "42501");
});

test("حماية آخر مدير صلاحيات وحماية المالك", async () => {
  const [owner] = await q(u.ownerA, "select id from public.organization_members where user_id = $1 and organization_id = $2", [u.ownerA, org.A]);
  assert.equal(await errorCode(q(u.ownerA, "select public.set_member_permissions($1, array['customers.view'])", [owner.id])), "P0001");
  assert.equal(await errorCode(q(u.ownerA, "select public.set_member_status($1, 'suspended')", [owner.id])), "P0001");
});

test("الأرشفة تتطلب صلاحية مستقلة، والحذف يُمنع عند وجود علاقات", async () => {
  const [{ id: cust }] = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'عميل مرتبط') returning id", [org.A]);
  // المشاهد لا يؤرشف
  const r = await q(u.viewer, "update public.customers set archived_at = now() where id = $1 returning id", [cust]);
  assert.equal(r.length, 0);
  await q(u.ownerA, "update public.customers set archived_at = now() where id = $1", [cust]);
  let [row] = await q(u.ownerA, "select archived_at, archived_by from public.customers where id = $1", [cust]);
  assert.ok(row.archived_at);
  assert.equal(row.archived_by, u.ownerA);
  await q(u.ownerA, "update public.customers set archived_at = null where id = $1", [cust]);
  [row] = await q(u.ownerA, "select archived_at from public.customers where id = $1", [cust]);
  assert.equal(row.archived_at, null);

  await q(u.ownerA, "insert into public.devices (organization_id, customer_id, name) values ($1, $2, 'طفاية')", [org.A, cust]);
  assert.ok(["23503", "23001"].includes(await errorCode(q(u.ownerA, "delete from public.customers where id = $1", [cust]))));
  const logs = await q(u.ownerA, "select action from public.audit_logs where entity_id = $1 order by id", [cust]);
  assert.deepEqual(logs.map((l) => l.action), ["create", "archive", "restore"]);
});

test("الإسناد الجماعي: متعدد إلى متعدد، منع التكرار، منع الربط بين الشركات", async () => {
  const [tech] = await q(u.ownerA, "insert into public.technicians (organization_id, full_name) values ($1, 'فني الإسناد') returning id", [org.A]);
  const custs = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1,'ج1'),($1,'ج2'),($1,'ج3') returning id", [org.A]);
  for (const c of custs) {
    await q(u.ownerA, "insert into public.technician_customers (organization_id, technician_id, customer_id) values ($1,$2,$3)", [org.A, tech.id, c.id]);
  }
  assert.equal(await errorCode(q(u.ownerA, "insert into public.technician_customers (organization_id, technician_id, customer_id) values ($1,$2,$3)", [org.A, tech.id, custs[0].id])), "23505");
  const [tech2] = await q(u.ownerA, "insert into public.technicians (organization_id, full_name) values ($1, 'فني ثان') returning id", [org.A]);
  await q(u.ownerA, "insert into public.technician_customers (organization_id, technician_id, customer_id) values ($1,$2,$3)", [org.A, tech2.id, custs[0].id]);
  const forCustomer = await q(u.ownerA, "select technician_id from public.technician_customers where customer_id = $1", [custs[0].id]);
  assert.equal(forCustomer.length, 2);
  // إزالة الإسناد لا تحذف العميل
  await q(u.ownerA, "delete from public.technician_customers where technician_id = $1 and customer_id = $2", [tech.id, custs[1].id]);
  assert.equal((await q(u.ownerA, "select id from public.customers where id = $1", [custs[1].id])).length, 1);
  // فني من شركة أخرى
  const [bc] = await q(u.ownerB, "select id from public.customers limit 1");
  assert.ok(["23503", "42501"].includes(await errorCode(q(u.ownerA, "insert into public.technician_customers (organization_id, technician_id, customer_id) values ($1,$2,$3)", [org.A, tech.id, bc.id]))));
});

test("الكتالوج يعبّئ بيانات الجهاز، والرمز فريد وثابت ولا يعاد استخدامه", async () => {
  const [sys] = await q(u.ownerA, "select id from public.safety_systems where name = 'طفايات الحريق'");
  const [item] = await q(u.ownerA, "insert into public.catalog_items (organization_id, system_id, name, manufacturer, model, device_type, default_interval_days) values ($1,$2,'طفاية بودرة 6 كجم','NAFFCO','DP-6','powder', 365) returning id, ref_no", [org.A, sys.id]);
  assert.match(item.ref_no, /^CAT-\d{6}$/);
  const [cust] = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'عميل الأجهزة') returning id", [org.A]);
  const [site] = await q(u.ownerA, "insert into public.customer_sites (organization_id, customer_id, name) values ($1,$2,'الفرع الرئيسي') returning id, ref_no", [org.A, cust.id]);
  assert.match(site.ref_no, /^SIT-\d{6}$/);
  const [dev] = await q(u.ownerA, "insert into public.devices (organization_id, customer_id, site_id, catalog_item_id, name, serial_number, installed_at) values ($1,$2,$3,$4,'', 'SN-1', '2026-01-01') returning *", [org.A, cust.id, site.id, item.id]);
  assert.equal(dev.name, "طفاية بودرة 6 كجم");
  assert.equal(dev.manufacturer, "NAFFCO");
  assert.equal(dev.model, "DP-6");
  assert.equal(dev.system_id, sys.id);
  assert.equal(dev.maintenance_interval_days, 365);
  assert.match(dev.qr_token, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.match(dev.ref_no, /^DEV-\d{6}$/);
  // تعديل الكتالوج لا يغيّر الجهاز القائم
  await q(u.ownerA, "update public.catalog_items set name = 'اسم جديد' where id = $1", [item.id]);
  assert.equal((await q(u.ownerA, "select name from public.devices where id = $1", [dev.id]))[0].name, "طفاية بودرة 6 كجم");
  // الرمز ثابت
  assert.equal(await errorCode(q(u.ownerA, "update public.devices set qr_token = 'AAAAAAAAAAAA' where id = $1", [dev.id])), "P0001");
  // تعديل الاسم والموقع لا يغير الرمز
  await q(u.ownerA, "update public.devices set name = 'طفاية المدخل', location_detail = 'الدور الأول' where id = $1", [dev.id]);
  assert.equal((await q(u.ownerA, "select qr_token from public.devices where id = $1", [dev.id]))[0].qr_token, dev.qr_token);
  // الموقع يجب أن يتبع العميل نفسه
  const [cust2] = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'عميل آخر') returning id", [org.A]);
  assert.equal(await errorCode(q(u.ownerA, "insert into public.devices (organization_id, customer_id, site_id, name) values ($1,$2,$3,'x')", [org.A, cust2.id, site.id])), "23514");
  // 200 جهاز: رموز فريدة
  for (let i = 0; i < 200; i++) {
    await q(u.ownerA, "insert into public.devices (organization_id, customer_id, name) values ($1,$2,$3)", [org.A, cust2.id, `جهاز ${i}`]);
  }
  const tokens = (await db.query("select count(*)::int n, count(distinct qr_token)::int d from public.devices")).rows[0];
  assert.equal(tokens.n, tokens.d);
  // حذف جهاز بلا سجلات: الرمز يبقى محجوزًا ويظهر كـ«محذوف»
  const [tmp] = await q(u.ownerA, "insert into public.devices (organization_id, customer_id, name) values ($1,$2,'مؤقت') returning id, qr_token", [org.A, cust2.id]);
  await q(u.ownerA, "delete from public.devices where id = $1", [tmp.id]);
  assert.equal((await db.query("select count(*)::int n from app_private.device_tokens where token = $1", [tmp.qr_token])).rows[0].n, 1);
  assert.equal((await q(u.ownerA, "select public.resolve_device_token($1) as r", [tmp.qr_token]))[0].r.status, "removed");
  assert.equal((await q(u.ownerA, "select public.resolve_device_token($1) as r", [dev.qr_token]))[0].r.status, "ok");
  assert.equal((await q(u.ownerB, "select public.resolve_device_token($1) as r", [dev.qr_token]))[0].r.status, "forbidden");
  assert.equal((await q(u.ownerA, "select public.resolve_device_token('ZZZZZZZZZZZZ') as r"))[0].r.status, "not_found");
});

test("سجل الصيانة يحدّث الجهاز ولا يمكن تعديله أو حذفه", async () => {
  const [dev] = await q(u.ownerA, "select id, maintenance_interval_days from public.devices where serial_number = 'SN-1'");
  const [rec] = await q(u.ownerA, "insert into public.maintenance_records (organization_id, device_id, action, result, status_after, performed_at) values ($1,$2,'inspection','pass','operational','2026-10-01T09:00:00+03:00') returning *", [org.A, dev.id]);
  assert.match(rec.ref_no, /^MNT-\d{6}$/);
  assert.equal(rec.device_name_snapshot, "طفاية المدخل");
  const [after] = await q(u.ownerA, "select last_maintenance_at, next_maintenance_at, status from public.devices where id = $1", [dev.id]);
  assert.equal(after.last_maintenance_at.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(after.next_maintenance_at.toISOString().slice(0, 10), "2027-10-01");
  assert.ok(await errorCode(q(u.ownerA, "update public.maintenance_records set notes = 'x' where id = $1", [rec.id])));
  assert.ok(await errorCode(q(u.ownerA, "delete from public.maintenance_records where id = $1", [rec.id])));
  // الجهاز ذو السجلات لا يُحذف
  assert.ok(["23503", "23001"].includes(await errorCode(q(u.ownerA, "delete from public.devices where id = $1", [dev.id]))));
});

test("الفني بصلاحية «المسندين فقط» يرى عملاءه وأجهزتهم فقط، والإشعارات خاصة به", async () => {
  await q(u.ownerA, "select public.invite_member($1, $2, 'فني', array['field.assigned','maintenance.create'], array['technician'])", [org.A, mail("tech")]);
  await q(u.tech, "select public.accept_my_invitations()");
  const [tech] = await q(u.ownerA, "insert into public.technicians (organization_id, full_name, user_id) values ($1, 'الفني الميداني', $2) returning id", [org.A, u.tech]);
  const [cust] = await q(u.ownerA, "select id from public.customers where name = 'عميل الأجهزة'");
  assert.equal((await q(u.tech, "select id from public.devices")).length, 0);
  await q(u.ownerA, "insert into public.technician_customers (organization_id, technician_id, customer_id) values ($1,$2,$3)", [org.A, tech.id, cust.id]);
  const visible = await q(u.tech, "select customer_id from public.devices");
  assert.ok(visible.length > 0 && visible.every((d) => d.customer_id === cust.id));
  assert.equal((await q(u.tech, "select id from public.customers")).length, 1);

  const notes = await q(u.tech, "select id, kind, title, link from public.notifications");
  assert.ok(notes.some((n) => n.kind === "assignment" && n.link === `/customers/${cust.id}`));
  // المالك لا يرى إشعارات الفني
  assert.equal((await q(u.ownerA, "select id from public.notifications where recipient_user_id = $1", [u.tech])).length, 0);
  // الفني يحدد كمقروء ولا يغيّر المحتوى
  await q(u.tech, "update public.notifications set read_at = now() where id = $1", [notes[0].id]);
  assert.equal(await errorCode(q(u.tech, "update public.notifications set title = 'x' where id = $1", [notes[0].id])), "42501");
});

test("تنبيهات الصيانة لا تتكرر عند التشغيل المتعدد", async () => {
  const [cust] = await q(u.ownerA, "select id from public.customers where name = 'عميل الأجهزة'");
  await q(u.ownerA, "insert into public.devices (organization_id, customer_id, name, next_maintenance_at) values ($1,$2,'متأخر', current_date - 5), ($1,$2,'قريب', current_date + 3)", [org.A, cust.id]);
  await db.query("select app_private.run_maintenance_alerts_for($1)", [org.A]);
  const n1 = (await db.query("select count(*)::int n from public.notifications where kind in ('maintenance_due','maintenance_overdue')")).rows[0].n;
  await db.query("select app_private.run_maintenance_alerts_for($1)", [org.A]);
  const n2 = (await db.query("select count(*)::int n from public.notifications where kind in ('maintenance_due','maintenance_overdue')")).rows[0].n;
  assert.ok(n1 > 0);
  assert.equal(n1, n2);
  const techNotes = await q(u.tech, "select kind from public.notifications where kind = 'maintenance_overdue'");
  assert.ok(techNotes.length >= 1);
});

test("سجل التدقيق محمي ويُعرض فقط لصاحب الصلاحية", async () => {
  assert.ok((await q(u.ownerA, "select id from public.audit_logs")).length > 0);
  assert.equal((await q(u.viewer, "select id from public.audit_logs")).length, 0);
  assert.ok(await errorCode(q(u.ownerA, "delete from public.audit_logs")));
  assert.ok(await errorCode(q(u.ownerA, "insert into public.audit_logs (organization_id, action, entity_type) values ($1, 'x', 'y')", [org.A])));
  assert.equal((await q(u.ownerB, "select id from public.audit_logs where organization_id = $1", [org.A])).length, 0);
});

test("الهوية البصرية: صلاحية مستقلة، مسارات الشركة فقط، واستعادة النسخة السابقة", async () => {
  await q(u.ownerA, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ primary_color: "#112233", header_text: "ترويسة أ" })]);
  await q(u.ownerA, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ primary_color: "#445566" })]);
  assert.equal(await errorCode(q(u.ownerA, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ logo_path: `${org.B}/logo.png` })])), "42501");
  assert.equal(await errorCode(q(u.ownerA, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ status: "approved" })])), "22023");
  assert.equal(await errorCode(q(u.viewer, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ primary_color: "#000000" })])), "42501");
  assert.equal(await errorCode(q(u.ownerB, "select public.update_company_profile($1, $2::jsonb)", [org.A, JSON.stringify({ primary_color: "#000000" })])), "42501");
  const [h] = await q(u.ownerA, "select id, snapshot from public.organization_branding_history where organization_id = $1 order by created_at desc limit 1", [org.A]);
  assert.equal(h.snapshot.primary_color, "#112233");
  await q(u.ownerA, "select public.restore_company_branding($1)", [h.id]);
  assert.equal((await q(u.ownerA, "select primary_color from public.organizations where id = $1", [org.A]))[0].primary_color, "#112233");
  assert.equal((await q(u.ownerB, "select primary_color from public.organizations where id = $1", [org.A])).length, 0);
});

test("التخزين: لا رفع لملفات في مجلد شركة أخرى", async () => {
  assert.equal(await errorCode(q(u.ownerA, "insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${org.B}/logo.png`])), "42501");
  await q(u.ownerA, "insert into storage.objects (bucket_id, name) values ('org-branding', $1)", [`${org.A}/logo.png`]);
  assert.equal((await q(u.ownerB, "select id from storage.objects where bucket_id = 'org-branding'")).length, 0);
  // ملف مرفق بلا سجل مرفق مرئي لا يُقرأ
  await q(u.ownerA, "insert into storage.objects (bucket_id, name) values ('org-files', $1)", [`${org.A}/x.pdf`]);
  assert.equal((await q(u.ownerA, "select id from storage.objects where bucket_id = 'org-files'")).length, 0);
});

test("طلب الانضمام ينتظر الاعتماد ولا يمنح وصولًا", async () => {
  const [{ ref_no }] = (await db.query("select ref_no from public.organizations where id = $1", [org.A])).rows;
  const memberId = (await q(u.stranger, "select public.request_membership($1) as id", [ref_no]))[0].id;
  assert.equal((await q(u.stranger, "select id from public.customers")).length, 0);
  await q(u.viewer, "select public.set_member_status($1, 'active')", [memberId]); // viewer يملك users.invite
  const ctx = (await q(u.stranger, "select public.get_my_context() as c"))[0].c;
  assert.equal(ctx.memberships[0].member_status, "active");
  assert.equal(ctx.memberships[0].permissions.length, 0); // معتمد لكن بلا صلاحيات حتى تُمنح
  assert.equal((await q(u.stranger, "select id from public.customers")).length, 0);
  // العضوية المنتهية لا تمنح وصولًا
  await q(u.ownerA, "select public.set_member_permissions($1, array['customers.view'])", [memberId]);
  assert.ok((await q(u.stranger, "select id from public.customers")).length > 0);
  await q(u.ownerA, "select public.set_member_status($1, 'active', now() - interval '1 minute')", [memberId]);
  assert.equal((await q(u.stranger, "select id from public.customers")).length, 0);
});

test("اعتماد أمر العمل صلاحية مستقلة عن التعديل، والمعتمِد يُسجَّل من الجلسة", async () => {
  const [cust] = await q(u.ownerA, "select id from public.customers where name = 'عميل الأجهزة'");
  const [wo] = await q(u.ownerA, "insert into public.work_orders (organization_id, customer_id, title, status) values ($1,$2,'أمر اختبار','completed') returning id", [org.A, cust.id]);
  // المشاهد لا يملك الاعتماد
  assert.equal((await q(u.viewer, "update public.work_orders set approved_at = now() where id = $1 returning id", [wo.id])).length, 0);
  // لا يمكن تزوير المعتمِد
  await q(u.ownerA, "update public.work_orders set approved_at = now(), approved_by = $2 where id = $1", [wo.id, u.viewer]);
  const [row] = await q(u.ownerA, "select approved_by from public.work_orders where id = $1", [wo.id]);
  assert.equal(row.approved_by, u.ownerA);
});

test("إشعارات أوامر العمل والزيارات تصل للفني المعيّن فقط", async () => {
  const [cust] = await q(u.ownerA, "select id from public.customers where name = 'عميل الأجهزة'");
  const [tech] = await q(u.ownerA, "select id from public.technicians where user_id = $1", [u.tech]);
  const [wo] = await q(u.ownerA, "insert into public.work_orders (organization_id, customer_id, title) values ($1,$2,'فحص ربع سنوي') returning id", [org.A, cust.id]);
  await q(u.ownerA, "insert into public.work_order_technicians (work_order_id, technician_id, organization_id) values ($1,$2,$3)", [wo.id, tech.id, org.A]);
  await q(u.ownerA, "update public.work_orders set status = 'in_progress' where id = $1", [wo.id]);
  const [v] = await q(u.ownerA, "insert into public.visits (organization_id, customer_id, work_order_id, scheduled_start) values ($1,$2,$3, now() + interval '1 day') returning id", [org.A, cust.id, wo.id]);
  await q(u.ownerA, "insert into public.visit_technicians (visit_id, technician_id, organization_id) values ($1,$2,$3)", [v.id, tech.id, org.A]);
  await q(u.ownerA, "update public.visits set scheduled_start = now() + interval '2 days' where id = $1", [v.id]);
  const kinds = (await q(u.tech, "select kind from public.notifications where entity_id in ($1, $2)", [wo.id, v.id])).map((n) => n.kind).sort();
  assert.deepEqual(kinds, ["visit_rescheduled", "visit_scheduled", "work_order_assigned", "work_order_status"]);
  // الفني يرى أمر العمل المعيّن له حتى دون صلاحية عرض أوامر العمل
  assert.equal((await q(u.tech, "select id from public.work_orders where id = $1", [wo.id])).length, 1);
  assert.equal((await q(u.viewer, "select id from public.notifications where entity_id = $1", [wo.id])).length, 0);
});

test("الزيارة وأمر العمل يجب أن يتبعا العميل نفسه، والموقع كذلك", async () => {
  const [c1] = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'ع-روابط-1') returning id", [org.A]);
  const [c2] = await q(u.ownerA, "insert into public.customers (organization_id, name) values ($1, 'ع-روابط-2') returning id", [org.A]);
  const [wo] = await q(u.ownerA, "insert into public.work_orders (organization_id, customer_id, title) values ($1,$2,'أمر ع1') returning id", [org.A, c1.id]);
  assert.equal(await errorCode(q(u.ownerA, "insert into public.visits (organization_id, customer_id, work_order_id, scheduled_start) values ($1,$2,$3, now())", [org.A, c2.id, wo.id])), "23514");
  const [s1] = await q(u.ownerA, "insert into public.customer_sites (organization_id, customer_id, name) values ($1,$2,'موقع ع1') returning id", [org.A, c1.id]);
  assert.equal(await errorCode(q(u.ownerA, "insert into public.work_orders (organization_id, customer_id, site_id, title) values ($1,$2,$3,'خطأ')", [org.A, c2.id, s1.id])), "23514");
});

test("عروض التقارير تخضع لـ RLS (security_invoker) ولا تكشف بيانات شركة أخرى", async () => {
  const a = await q(u.ownerA, "select organization_id from public.report_customer_summary");
  assert.ok(a.length > 0 && a.every((r) => r.organization_id === org.A));
  const b = await q(u.ownerB, "select organization_id from public.report_devices_by_system");
  assert.ok(b.every((r) => r.organization_id === org.B));
  assert.equal((await q(u.stranger, "select * from public.report_technician_assignments")).length, 0);
});

test("أرشفة تعريف الكتالوج لا تمس الأجهزة القائمة ولا سجلاتها، وحذفه ممنوع ما دام مرتبطًا", async () => {
  const [item] = await q(u.ownerA, "select id from public.catalog_items limit 1");
  const before = await q(u.ownerA, "select id, name from public.devices where catalog_item_id = $1 order by id", [item.id]);
  await q(u.ownerA, "update public.catalog_items set archived_at = now() where id = $1", [item.id]);
  const after = await q(u.ownerA, "select id, name from public.devices where catalog_item_id = $1 order by id", [item.id]);
  assert.deepEqual(after, before);
  assert.ok(["23503", "23001"].includes(await errorCode(q(u.ownerA, "delete from public.catalog_items where id = $1", [item.id]))));
});
