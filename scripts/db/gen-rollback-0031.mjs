// يولّد ملف التراجع لترحيل 20261031000100 من تعريف get_my_context الحالي في cgwn (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0031.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.platform_settings') t")).rows[0].t) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريف الحالي ليس تعريف ما قبل الترحيل — توقف.");
}
const def = (await c.query(`select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_my_context'`)).rows[0].def;
await c.query("rollback");
await c.end();

const sql = `-- =====================================================================
-- التراجع عن 20261031000100_invite_branding_platform_logo_assistant_invites.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت دعوات مساعدين أو سجل تدقيق منصة أو شعار منصة محفوظ أو ملفات في حاوية شعار المنصة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_assistant_invitations) or exists (select 1 from public.platform_audit_log)
     or exists (select 1 from public.platform_settings where logo_path is not null)
     or exists (select 1 from storage.objects where bucket_id = 'platform-branding')
     or exists (select 1 from public.platform_assistants where 'platform.branding' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل';
  end if;
end $$;

${def.trim()};

grant execute on function public.platform_request_assistant(text, text) to authenticated;
drop function if exists public.accept_platform_assistant_invitation(text);
drop function if exists public.assistant_invitation_landing(text);
drop function if exists public.platform_mark_assistant_invitation_emailed(uuid);
drop function if exists public.platform_revoke_assistant_invitation(uuid);
drop function if exists public.platform_resend_assistant_invitation(uuid, integer);
drop function if exists public.platform_invite_assistant(text, text, text[], integer);
drop table if exists public.platform_assistant_invitations;

drop policy if exists ays_platform_branding_write on storage.objects;
drop policy if exists ays_platform_branding_delete on storage.objects;
-- حاوية platform-branding تبقى فارغة: Supabase يمنع حذف الحاويات بـ SQL
drop function if exists public.platform_set_logo(text);
drop function if exists public.platform_public_settings();
drop table if exists public.platform_settings;
delete from public.platform_permission_definitions where key = 'platform.branding';

drop policy if exists ays_branding_invite_read on storage.objects;
drop function if exists public.storage_invite_logo_allowed(text);
drop function if exists public.invitation_landing(text);

drop trigger if exists trg_platform_assistants_audit on public.platform_assistants;
drop function if exists app_private.audit_platform_assistant();
drop function if exists app_private.platform_audit(text, jsonb);
drop table if exists public.platform_audit_log;

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261031000100_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261031000100_rollback.sql" }));
