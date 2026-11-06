// اختبار وظيفي لتعديل الشركة ومعاينة ارتباطاتها وحذفها النهائي الآمن (ترحيل 20261101000100) على cgwn داخل معاملة يُتراجع عنها دائمًا.
// قبل التطبيق: node scripts/db/verify-cgwn-companies.mjs --with-migration supabase/migrations/20261101000100_company_edit_delete.sql
// بعد التطبيق: node scripts/db/verify-cgwn-companies.mjs
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
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
  return r.error ? { error: r.error, code: r.code } : { data: r.rows[0].r };
};

const before = await fingerprint(c);
await c.query("begin");
try {
  if (MIGRATION) await c.query(MIGRATION);
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const mgr = await mk("manager"), mgr2 = await mk("manager2"), assistant = await mk("assistant"), stranger = await mk("stranger");
  await c.query(`insert into public.platform_assistants (user_id, email, permissions, status, granted_by)
    values ($1, $2, '{platform.companies.view}', 'active', $3)`, [assistant, `assistant.${tag}@ays-test.invalid`, owner]);

  // شركة A: مدير وعميل (سجل تشغيلي) — شركة B: مدير فقط بلا سجلات تشغيلية
  const a = await rpc(owner, "platform_create_company", [`شركة أ ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  const b = await rpc(owner, "platform_create_company", [`شركة ب ${tag}`, `manager2.${tag}@ays-test.invalid`, null, null, "جدة", 24]);
  await rpc(mgr, "accept_company_invitation", [a.data?.token]);
  await rpc(mgr2, "accept_company_invitation", [b.data?.token]);
  const A = a.data?.company_id, B = b.data?.company_id;
  await as(mgr, "insert into public.customers (company_id, name) values ($1, 'عميل أ')", [A]);
  const refOf = async (id) => (await c.query("select ref_no from public.companies where id = $1", [id])).rows[0].ref_no;

  // 1) التعديل
  const full = { name: `شركة أ المعدلة ${tag}`, legal_name: "مؤسسة أ", commercial_registration: "1010101010", vat_number: "300000000000003",
    license_no: "L-1", phone: "+966 11 000 0000", email: "Info@A.example", website: "https://a.example", city: "الرياض", address: "طريق الملك فهد" };
  const u1 = await rpc(owner, "platform_update_company_details", [A, full]);
  const row = (await c.query("select name, legal_name, vat_number, email, website, address from public.companies where id = $1", [A])).rows[0];
  ok("التعديل: المالك يحفظ كل الحقول فعليًا", !u1.error && row.name === full.name && row.legal_name === "مؤسسة أ" && row.vat_number === full.vat_number
    && row.email === "info@a.example" && row.address === full.address, u1.error ?? JSON.stringify(row));
  const aud = (await c.query("select details from public.company_audit_log where company_id = $1 and action = 'company_updated' order by created_at desc limit 1", [A])).rows[0];
  ok("التعديل: تدقيق يحفظ القيم قبل/بعد", aud?.details?.changes?.name?.to === full.name, JSON.stringify(aud?.details ?? {}));
  ok("التعديل: بريد غير صالح يُرفض", (await rpc(owner, "platform_update_company_details", [A, { ...full, email: "x@" }])).code === "22023");
  ok("التعديل: موقع بلا http يُرفض", (await rpc(owner, "platform_update_company_details", [A, { ...full, website: "a.example" }])).code === "22023");
  ok("التعديل: رقم ضريبي غير صالح يُرفض", (await rpc(owner, "platform_update_company_details", [A, { ...full, vat_number: "123" }])).code === "22023");
  ok("التعديل: اسم قصير يُرفض", (await rpc(owner, "platform_update_company_details", [A, { ...full, name: "x" }])).code === "22023");
  ok("التعديل: مساعد بلا صلاحية التعديل يُرفض", (await rpc(assistant, "platform_update_company_details", [A, full])).code === "42501");
  ok("التعديل: مدير الشركة لا يعدّل عبر دالة المنصة", (await rpc(mgr, "platform_update_company_details", [A, full])).code === "42501");
  const bName = (await c.query("select name from public.companies where id = $1", [B])).rows[0].name;
  ok("التعديل: لا يمس شركة أخرى", bName === `شركة ب ${tag}`);
  ok("التعديل: الرقم المرجعي لا يتغير", (await refOf(A)) === a.data?.ref_no);

  // 2) المعاينة
  const dA = await rpc(owner, "platform_company_dependencies", [A]);
  ok("المعاينة: تحصي العميل والعضوية والأنظمة الافتراضية", dA.data?.customers === 1 && dA.data?.memberships === 1 && dA.data?.safety_systems > 0 && dA.data?.can_delete === false, JSON.stringify(dA));
  ok("المعاينة: المساعد بصلاحية العرض يراها", !(await rpc(assistant, "platform_company_dependencies", [A])).error);
  ok("المعاينة: غريب لا يراها", (await rpc(stranger, "platform_company_dependencies", [A])).code === "42501");
  ok("المعاينة: anon لا يستدعيها", !!(await rpc(null, "platform_company_dependencies", [A])).error);

  // 3) الحذف
  ok("الحذف: شركة نشطة تُرفض (يجب الأرشفة أولًا)", (await rpc(owner, "platform_delete_company", [B, await refOf(B)])).code === "P0001");
  await rpc(owner, "platform_set_company_status", [A, "archived"]);
  await rpc(owner, "platform_set_company_status", [B, "archived"]);
  ok("الإيقاف/الأرشفة: مدير الشركة المؤرشفة يفقد الوصول مع بقاء البيانات",
    (await as(mgr, "select id from public.customers where company_id = $1", [A])).rows?.length === 0
    && (await c.query("select count(*)::int n from public.customers where company_id = $1", [A])).rows[0].n === 1);
  ok("الحذف: رقم تأكيد خاطئ يُرفض", (await rpc(owner, "platform_delete_company", [B, "CMP-000000"])).code === "22023");
  ok("الحذف: شركة لها سجلات تشغيلية تُرفض وتبقى مؤرشفة", (await rpc(owner, "platform_delete_company", [A, await refOf(A)])).code === "23503"
    && (await c.query("select count(*)::int n from public.companies where id = $1", [A])).rows[0].n === 1);
  ok("الحذف: المساعد بلا صلاحية الحذف يُرفض", (await rpc(assistant, "platform_delete_company", [B, await refOf(B)])).code === "42501");
  const refB = await refOf(B);
  const del = await rpc(owner, "platform_delete_company", [B, refB]);
  ok("الحذف: شركة مؤرشفة بلا سجلات تشغيلية (بأنظمة افتراضية وعضوية) تُحذف", !del.error
    && (await c.query("select count(*)::int n from public.companies where id = $1", [B])).rows[0].n === 0, del.error);
  ok("الحذف: لا عضويات أو أنظمة يتيمة", (await c.query(`select (select count(*) from public.company_memberships where company_id = $1)
    + (select count(*) from public.safety_systems where company_id = $1) + (select count(*) from public.company_invitations where company_id = $1) n`, [B])).rows[0].n == 0);
  const snap = (await c.query("select details from public.company_audit_log where company_id = $1 and action = 'company_deleted'", [B])).rows[0];
  ok("الحذف: لقطة في سجل التدقيق تبقى بعد الحذف", snap?.details?.ref_no === refB && Array.isArray(snap?.details?.members) && snap.details.members.length === 1);
  ok("الحذف: مسجل في تدقيق المنصة", (await c.query("select count(*)::int n from public.platform_audit_log where action = 'company_deleted' and details->>'ref_no' = $1", [refB])).rows[0].n === 1);
  ok("الحذف: الشركة الأخرى سليمة", (await c.query("select count(*)::int n from public.customers where company_id = $1", [A])).rows[0].n === 1);
} catch (e) {
  ok("تنفيذ الاختبار دون استثناء", false, e.message);
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
ok("البيانات القائمة لم تتغير بعد التراجع", JSON.stringify(after) === JSON.stringify(before));
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ withMigration: !!MIGRATION, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
