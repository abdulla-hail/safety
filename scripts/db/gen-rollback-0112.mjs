// يولّد ملف التراجع لترحيل 20261112000100 من تعريفات cgwn الحالية (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0112.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regprocedure('app_private.can_manage_team(uuid)') p")).rows[0].p) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريفات الحالية ليست تعريفات ما قبل الترحيل — توقف.");
}
const fns = ["public.company_effective_permissions(text, text[])", "public.company_member_guard(uuid)", "public.company_set_member_role(uuid, text)",
  "public.company_set_member_permissions(uuid, text[])", "public.company_update_member(uuid, text, text, text)",
  "public.company_invite_member(uuid, text, text, text, text, text, integer)", "public.company_can_manage_invitation(public.company_invitations)",
  "public.company_set_invitation_permissions(uuid, text[])", "app_private.invitation_permissions_flow()", "public.accept_company_invitation(text)"];
const defs = [];
for (const f of fns) defs.push((await c.query("select pg_get_functiondef($1::regprocedure) d", [f])).rows[0].d.trim() + ";");
const pols = (await c.query(`select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'
  and ((tablename = 'company_invitations' and policyname = 'company_invitations_select') or (tablename = 'company_audit_log' and policyname = 'company_audit_log_select'))
  order by 1, 2`)).rows;
const hasCol = (await c.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='customer_sites' and column_name='location_text'`)).rows[0].n;
await c.query("rollback");
await c.end();
if (pols.length !== 2) throw new Error(`عُثر على ${pols.length} سياسات بدل 2 — توقف.`);
if (hasCol) throw new Error("customer_sites.location_text موجود مسبقًا — توقف.");

const polSql = pols.map((p) => {
  const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",")).join(", ");
  return `drop policy if exists ${p.policyname} on public.${p.tablename};\ncreate policy ${p.policyname} on public.${p.tablename} for ${p.cmd.toLowerCase()} to ${roles}`
    + (p.qual ? ` using (${p.qual})` : "") + (p.with_check ? ` with check (${p.with_check})` : "") + ";";
}).join("\n");

const sql = `-- =====================================================================
-- التراجع عن 20261112000100_roles_locations.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بيانات تعتمد على الترحيل: نص موقع محفوظ، أو مدير غير أساسي، أو دعوة «مدير» أُنشئت بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.customer_sites where location_text is not null)
     or exists (select 1 from public.company_memberships where role = 'company_manager' and not is_primary)
     or exists (select 1 from public.company_invitations i where i.kind = 'member' and i.role = 'company_manager'
                and not exists (select 1 from app_private.migration_0112_invitations b where b.invitation_id = i.id)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

-- الدعوات المحوّلة: تعود لدورها وصلاحياتها الأصلية ما لم تتغير بعد الترحيل
update public.company_invitations i set role = b.role, permissions = b.permissions
from app_private.migration_0112_invitations b
where i.id = b.invitation_id and i.role = 'company_manager' and i.permissions is not distinct from b.migrated_permissions;

${polSql}

${defs.join("\n\n")}

drop function if exists app_private.check_grantable(uuid, text, text[]);
drop function if exists app_private.require_team_manager(uuid);
drop function if exists app_private.can_manage_team(uuid);
drop function if exists app_private.is_primary_manager(uuid);
drop function if exists app_private.management_permissions();

alter table public.customer_sites drop constraint if exists customer_sites_location_text_len;
alter table public.customer_sites drop column if exists location_text;

update public.company_memberships set permissions = array_remove(permissions, 'team.manage') where 'team.manage' = any (permissions);
update public.company_invitations set permissions = array_remove(permissions, 'team.manage') where 'team.manage' = any (permissions);
delete from public.company_role_permissions where permission_key = 'team.manage';
delete from public.permission_definitions where key = 'team.manage';
drop table if exists app_private.migration_0112_invitations;

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261112000100_rollback.sql", sql);
console.log("wrote supabase/proposed/20261112000100_rollback.sql", { functions: defs.length, policies: pols.length });
