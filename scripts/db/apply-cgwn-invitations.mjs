// تطبيق مقترح الشركات والعضويات والدعوات على مشروع cgwn فقط، داخل معاملة واحدة مع تحققات إلزامية قبل الالتزام.
//   --dry-run : تطبيق + تحقق + تجربة ملف التراجع + ROLLBACK (لا يُحفظ شيء)
//   --apply   : تطبيق + تحقق؛ COMMIT فقط إذا نجحت كل التحققات، وإلا ROLLBACK
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : null;
if (!mode) { console.error("استخدم --dry-run أو --apply"); process.exit(1); }

const dir = path.resolve(process.cwd(), "supabase", "proposed");
const MIGRATION = fs.readFileSync(path.join(dir, "20261027000100_companies_memberships_invitations.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(dir, "20261027000100_rollback.sql"), "utf8");
const PROTECTED = ["platform_admins", "safety_tenants", "safety_company_access", "safety_owner_workspaces", "company_memberships"];

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); };

async function structure() {
  return {
    policies: await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by 1,2`),
    grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3`),
    constraints: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1,2`),
    functions: await q(`select proname, md5(pg_get_functiondef(oid)) h from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by 1`),
    columns: await q(`select table_name, column_name, udt_name from information_schema.columns where table_schema='public' order by 1,2`),
  };
}

let committed = false;
try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");
  await c.query("set local statement_timeout = '60s'");
  const before = await fingerprint(c);
  const beforeStructure = await structure();
  const companiesBefore = await q("select id, name, status, created_at from public.companies order by id");

  await c.query(MIGRATION);

  // --- تحققات سلامة البيانات ---
  const after = await fingerprint(c);
  for (const t of PROTECTED) check(`بيانات ${t} لم تتغير`, after[t]?.md5 === before[t]?.md5 && after[t]?.rows === before[t]?.rows, `${before[t]?.rows} صف`);
  const companiesAfter = await q("select id, name, status, created_at, ref_no from public.companies order by id");
  check("عدد الشركات ثابت", companiesAfter.length === companiesBefore.length, `${companiesAfter.length}`);
  check("أسماء الشركات وتواريخها لم تتغير", companiesAfter.every((r, i) => r.id === companiesBefore[i].id && r.name === companiesBefore[i].name && +r.created_at === +companiesBefore[i].created_at));
  const map = { waiting_list: "pending", closed: "suspended" };
  check("الحالات حُوّلت كما هو مقصود فقط", companiesAfter.every((r, i) => r.status === (map[companiesBefore[i].status] ?? companiesBefore[i].status)));
  check("لكل شركة رقم مرجعي فريد", companiesAfter.every((r) => /^ORG-\d{6,}$/.test(r.ref_no)) && new Set(companiesAfter.map((r) => r.ref_no)).size === companiesAfter.length,
    companiesAfter.map((r) => r.ref_no).join(","));

  // --- تحققات الأمان ---
  const newTables = await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('company_invitations','company_audit_log')`);
  check("الجدولان الجديدان موجودان وRLS مفعّل", newTables.length === 2 && newTables.every((t) => t.relrowsecurity));
  const writeGrants = await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public'
    and table_name in ('companies','company_memberships','company_invitations','company_audit_log') and grantee in ('anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')`);
  check("لا صلاحية كتابة مباشرة لـ anon/authenticated", writeGrants.length === 0, JSON.stringify(writeGrants));
  const anonSelect = await q(`select table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon'
    and table_name in ('companies','company_memberships','company_invitations','company_audit_log')`);
  check("لا قراءة لـ anon", anonSelect.length === 0);
  const tokenCol = (await q(`select has_column_privilege('authenticated', 'public.company_invitations', 'token_hash', 'select') p`))[0].p;
  check("بصمة الرمز غير قابلة للقراءة من الواجهة", tokenCol === false);
  const oldWritePolicies = await q(`select policyname from pg_policies where schemaname='public' and tablename='companies' and cmd <> 'SELECT'`);
  check("حُذفت سياسات الكتابة المباشرة على companies فقط", oldWritePolicies.length === 0);
  const selectPolicies = await q(`select policyname from pg_policies where schemaname='public' and policyname in ('companies_select_authorized','memberships_select_authorized','company_invitations_select','company_audit_log_select')`);
  check("سياسات القراءة القائمة والجديدة موجودة", selectPolicies.length === 4);
  const definers = await q(`select p.proname, p.proconfig from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
    and p.proname in ('company_next_ref','company_audit','company_create_invitation','current_company_role','require_company_manager','require_platform_admin',
      'platform_create_company','platform_update_company','platform_set_company_status','platform_invite_manager','platform_delete_company',
      'company_invite_member','company_transfer_management','company_can_manage_invitation','company_revoke_invitation','company_resend_invitation',
      'company_member_guard','company_update_member','company_set_member_role','company_set_member_status','company_change_member_email',
      'invitation_preview','accept_company_invitation')`);
  check("23 دالة SECURITY DEFINER بمسار بحث فارغ", definers.length === 23 && definers.every((f) => (f.proconfig ?? []).some((x) => x === 'search_path=""' || x === "search_path=")),
    definers.filter((f) => !(f.proconfig ?? []).some((x) => x.startsWith("search_path"))).map((f) => f.proname).join(","));
  const internal = await q(`select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
    ('company_audit','company_create_invitation','require_company_manager','require_platform_admin','company_member_guard','company_next_ref','company_can_manage_invitation')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
  check("الدوال الداخلية غير قابلة للاستدعاء من الواجهة", internal.length === 0, internal.map((r) => r.proname).join(","));
  const anonRpc = await q(`select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
    ('platform_create_company','accept_company_invitation','invitation_preview','company_invite_member') and has_function_privilege('anon', p.oid, 'execute')`);
  check("anon لا يستدعي دوال الشركات والدعوات", anonRpc.length === 0);
  const seq = (await q(`select has_sequence_privilege('anon','public.company_ref_seq','usage') a, has_sequence_privilege('authenticated','public.company_ref_seq','usage') b`))[0];
  check("التسلسل غير متاح للواجهة", !seq.a && !seq.b);
  const cascade = (await q(`select confdeltype from pg_constraint where conname='company_memberships_company_id_fkey'`))[0]?.confdeltype;
  check("حذف الشركة لا يحذف العضويات (RESTRICT)", cascade === "r");

  if (mode === "dry-run") {
    await c.query(ROLLBACK);
    const restored = await fingerprint(c);
    const restoredStructure = await structure();
    check("ملف التراجع يعيد البيانات كما كانت", Object.keys(before).every((t) => restored[t]?.md5 === before[t].md5));
    check("ملف التراجع يعيد البنية والسياسات والصلاحيات كما كانت", JSON.stringify(restoredStructure) === JSON.stringify(beforeStructure));
  }

  const failed = checks.filter((x) => !x.ok);
  if (mode === "apply" && failed.length === 0) {
    await c.query("commit");
    committed = true;
  } else {
    await c.query("rollback");
  }
  console.log(JSON.stringify({ mode, committed, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log(JSON.stringify({ mode, committed: false, error: e.code ?? "", message: e.message, where: e.where ?? "" }, null, 2));
  process.exitCode = 2;
} finally {
  await c.end();
}
