// يولّد ملف التراجع لترحيل 20261030000100 من تعريفات الدوال الحالية في cgwn (قراءة فقط)،
// فيعيد التراجعُ الدوالَ المعدّلة نصًا كما هي في القاعدة قبل الترحيل.
// الاستخدام (قبل التطبيق فقط): node scripts/db/gen-rollback-0030.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const REPLACED = ["platform_create_company", "platform_update_company", "platform_set_company_status", "platform_invite_manager",
  "platform_delete_company", "company_transfer_management", "company_can_manage_invitation", "get_my_context"];

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.platform_assistants') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريفات الحالية ليست تعريفات ما قبل الترحيل — توقف.");
}
const defs = (await c.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any($1) order by p.proname`, [REPLACED])).rows;
await c.query("rollback");
await c.end();
if (defs.length !== REPLACED.length) throw new Error(`عدد الدوال غير متوقع: ${defs.length}`);

const sql = `-- =====================================================================
-- التراجع عن 20261030000100_platform_assistants.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ كليًا إذا وُجدت طلبات أو مساعدون (بيانات أُنشئت بعد الترحيل).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_assistant_requests) or exists (select 1 from public.platform_assistants) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد طلبات أو مساعدون أُنشئوا بعد الترحيل';
  end if;
end $$;

drop policy if exists companies_select_platform_assistant on public.companies;
drop policy if exists memberships_select_platform_assistant on public.company_memberships;
drop policy if exists company_invitations_select_platform_assistant on public.company_invitations;
drop policy if exists company_audit_log_select_platform_assistant on public.company_audit_log;
drop trigger if exists trg_memberships_block_assistant on public.company_memberships;

-- الدوال المعدّلة كما كانت تمامًا
${defs.map((d) => `${d.def.trim()};\n`).join("\n")}
drop function if exists public.platform_update_assistant(uuid, text[], text);
drop function if exists public.platform_review_assistant_request(uuid, boolean, text[], text);
drop function if exists public.platform_cancel_assistant_request(uuid);
drop function if exists public.platform_request_assistant(text, text);
drop function if exists app_private.block_assistant_membership();
drop function if exists app_private.valid_platform_permissions(text[]);
drop function if exists app_private.is_platform_staff_email(text);
drop function if exists public.require_platform_perm(text);
drop function if exists public.platform_has_perm(text);
drop function if exists public.platform_assistant_permissions();
drop table if exists public.platform_assistants;
drop table if exists public.platform_assistant_requests;
drop table if exists public.platform_permission_definitions;

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261030000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261030000100_rollback.sql", functions: defs.map((d) => d.proname) }));
