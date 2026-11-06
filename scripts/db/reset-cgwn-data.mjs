// تفريغ بيانات cgwn للبدء من الصفر (بطلب صريح من المالك 2026-10-27): يحذف كل البيانات التشغيلية والتجريبية وحسابات المستخدمين
// عدا مالك المنصة، ويُبقي المخطط والدوال والسياسات وتعريفات الصلاحيات وإعدادات المنصة (شعارها) وسجل رموز الأجهزة.
// الكتالوج (أنظمة السلامة لكل شركة) يُحذف مع الشركات بقرار المالك؛ أي شركة جديدة تُزرع لها الأنظمة الافتراضية تلقائيًا.
// صفوف safety_* المرتبطة بغير المالك تُحذف؛ صفوف المالك فيها تبقى. ملفات التخزين لا تُحذف بـ SQL (Supabase يمنع ذلك):
// يُطبع مسار كل ملف تابع للبيانات المحذوفة ليحذفه المالك من لوحة Storage. معاملة واحدة.
// الاستخدام: node scripts/db/reset-cgwn-data.mjs --dry-run | --apply
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const OWNER_EMAIL = "alhommaidi1999@gmail.com";
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : null;
if (!mode) { console.error("الاستخدام: reset-cgwn-data.mjs --dry-run|--apply"); process.exit(1); }

const TABLES = [
  "attachments", "catalog_items", "safety_systems", "companies", "company_audit_log", "company_branding_history", "company_invitations",
  "company_memberships", "customer_sites", "customers", "device_due_changes", "device_fault_events", "device_faults", "device_maintenance_cycles",
  "device_transfers", "devices", "maintenance_corrections", "maintenance_record_technicians", "maintenance_records", "notifications",
  "platform_assistant_invitations", "platform_assistant_requests", "platform_assistants", "platform_audit_log", "technician_assignment_events",
  "technician_customer_sites", "technician_customers", "technicians", "visit_devices", "visit_technicians", "visits", "work_order_devices",
  "work_order_technicians", "work_orders",
];
const KEEP = ["permission_definitions", "company_role_permissions", "platform_permission_definitions", "platform_settings", "platform_admins"];

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, ...(ok ? {} : { detail: String(detail) }) });
let committed = false;
try {
  await c.query("begin");
  await c.query("set local lock_timeout = '10s'");
  await c.query("set local statement_timeout = '120s'");

  // التحقق قبل الحذف: المشروع، المالك، والجداول
  const owner = (await q(`select u.id, (select count(*)::int from public.platform_admins pa where pa.user_id = u.id) admin,
    (select count(*)::int from auth.identities i where i.user_id = u.id) identities from auth.users u where lower(u.email) = $1`, [OWNER_EMAIL]));
  check("قبل: حساب المالك موجود ومرة واحدة", owner.length === 1, owner.length);
  check("قبل: الحساب مالك المنصة", owner[0]?.admin === 1);
  check("قبل: مالك منصة واحد فقط", (await q("select count(*)::int n from public.platform_admins"))[0].n === 1);
  if (checks.some((x) => !x.ok)) throw new Error("فشل التحقق قبل الحذف");
  const ownerId = owner[0].id;
  const keepBefore = {};
  for (const t of KEEP) keepBefore[t] = (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h from public."${t}" x`))[0];
  const ownerSafety = {
    tenants: (await q("select count(*)::int n from public.safety_tenants where user_id = $1", [ownerId]))[0].n,
    workspaces: (await q("select count(*)::int n from public.safety_owner_workspaces where user_id = $1", [ownerId]))[0].n,
    access: (await q("select count(*)::int n from public.safety_company_access where user_id = $1 and account_id = $1", [ownerId]))[0].n,
  };
  const files = await q(`select bucket_id, name from storage.objects where bucket_id in ('org-files', 'org-branding') order by 1, 2`);
  const before = {};
  for (const t of TABLES) before[t] = (await q(`select count(*)::int n from public."${t}"`))[0].n;
  const usersBefore = (await q("select count(*)::int n from auth.users"))[0].n;

  // الحذف: البيانات التشغيلية دفعة واحدة (TRUNCATE لا يطلق مشغلات منع تعديل السجل التاريخي، وبلا CASCADE يرفض لو أشار جدول غير مدرج)
  await c.query(`truncate table ${TABLES.map((t) => `public."${t}"`).join(", ")}`);
  await c.query("truncate table app_private.maintenance_alert_runs, app_private.ref_counters");
  // صفوف safety_* المرتبطة بغير المالك، ثم حسابات المستخدمين عدا المالك (هوياتها وجلساتها تُحذف معها)
  const sa = await c.query("delete from public.safety_company_access where user_id is distinct from $1 or account_id is distinct from $1", [ownerId]);
  const st = await c.query("delete from public.safety_tenants where user_id is distinct from $1", [ownerId]);
  const sw = await c.query("delete from public.safety_owner_workspaces where user_id is distinct from $1", [ownerId]);
  const du = await c.query("delete from auth.users where id <> $1", [ownerId]);

  // التحقق بعد الحذف (داخل المعاملة)
  for (const t of TABLES) check(`بعد: ${t} فارغ`, (await q(`select count(*)::int n from public."${t}"`))[0].n === 0);
  check("بعد: حساب مستخدم واحد فقط (المالك)", (await q("select count(*)::int n from auth.users"))[0].n === 1);
  const o2 = (await q(`select (select count(*)::int from auth.identities i where i.user_id = u.id) identities, u.banned_until, u.deleted_at,
    (select count(*)::int from public.platform_admins pa where pa.user_id = u.id) admin from auth.users u where u.id = $1`, [ownerId]))[0];
  check("بعد: هويات دخول المالك (Google) كما هي", o2?.identities === owner[0].identities, `${o2?.identities}/${owner[0].identities}`);
  check("بعد: المالك غير محظور ولا محذوف", o2 && !o2.banned_until && !o2.deleted_at);
  check("بعد: المالك ما زال مالك المنصة", o2?.admin === 1);
  for (const t of KEEP) {
    const now = (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h from public."${t}" x`))[0];
    check(`بعد: ${t} لم يتغير`, now.n === keepBefore[t].n && now.h === keepBefore[t].h);
  }
  check("بعد: صفوف safety_* الخاصة بالمالك باقية",
    (await q("select count(*)::int n from public.safety_tenants where user_id = $1", [ownerId]))[0].n === ownerSafety.tenants
    && (await q("select count(*)::int n from public.safety_owner_workspaces where user_id = $1", [ownerId]))[0].n === ownerSafety.workspaces
    && (await q("select count(*)::int n from public.safety_company_access where user_id = $1 and account_id = $1", [ownerId]))[0].n === ownerSafety.access);
  // سياق المالك كما تطلبه الواجهة عند الدخول
  await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [ownerId, JSON.stringify({ sub: ownerId, role: "authenticated" })]);
  await c.query("set local role authenticated");
  const ctx = (await q("select public.get_my_context() r"))[0].r;
  const isAdmin = (await q("select public.is_platform_admin() r"))[0].r;
  await c.query("reset role");
  check("بعد: سياق دخول المالك يعمل (مالك المنصة، بلا عضويات)", isAdmin === true && JSON.stringify(ctx ?? {}).length > 2, JSON.stringify(ctx ?? {}).slice(0, 200));

  const failed = checks.filter((x) => !x.ok);
  if (mode === "apply" && failed.length === 0) { await c.query("commit"); committed = true; } else await c.query("rollback");
  console.log(JSON.stringify({
    mode, committed, passed: checks.length - failed.length, failed: failed.length, failures: failed,
    deleted: { ...before, auth_users: du.rowCount, safety_company_access: sa.rowCount, safety_tenants: st.rowCount, safety_owner_workspaces: sw.rowCount, usersBefore },
    storage_files_to_delete_in_dashboard: files.map((f) => `${f.bucket_id}/${f.name}`),
  }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log(JSON.stringify({ mode, committed: false, error: e.code ?? "", message: e.message, where: e.where ?? "", checks }, null, 2));
  process.exitCode = 2;
} finally {
  await c.end();
}
