-- =====================================================================
-- التراجع عن 20261027000100_companies_memberships_invitations.sql
-- يعيد البنية والسياسات والصلاحيات إلى ما كانت عليه قبل التطبيق (مأخوذة من نقطة الاستعادة).
-- تحذير: يحذف جدولي الدعوات وسجل التدقيق والأعمدة المضافة ومحتواها.
-- يرفض التنفيذ إن وُجدت قيم لا تتسع لها القيود القديمة (دور storekeeper أو حالة removed).
-- =====================================================================

do $$ begin
  if exists (select 1 from public.company_memberships where role = 'storekeeper' or status = 'removed') then
    raise exception 'توجد عضويات بدور أمين مستودع أو حالة مُزال؛ عالجها يدويًا قبل التراجع';
  end if;
end $$;

-- الجداول الجديدة أولًا (سياساتها تعتمد على دوال مساعدة)
drop function if exists public.company_can_manage_invitation(public.company_invitations);
drop table if exists public.company_audit_log;
drop function if exists public.company_audit_block();
drop table if exists public.company_invitations;

-- الدوال الجديدة
drop function if exists public.accept_company_invitation(text);
drop function if exists public.invitation_preview(text);
drop function if exists public.company_change_member_email(uuid, text, integer);
drop function if exists public.company_set_member_status(uuid, text);
drop function if exists public.company_set_member_role(uuid, text);
drop function if exists public.company_update_member(uuid, text, text, text);
drop function if exists public.company_member_guard(uuid);
drop function if exists public.company_resend_invitation(uuid, integer);
drop function if exists public.company_revoke_invitation(uuid);
drop function if exists public.company_transfer_management(uuid, text, integer);
drop function if exists public.company_invite_member(uuid, text, text, text, text, text, integer);
drop function if exists public.platform_delete_company(uuid, text);
drop function if exists public.platform_invite_manager(uuid, text, integer);
drop function if exists public.platform_set_company_status(uuid, text);
drop function if exists public.platform_update_company(uuid, text, text, text, text);
drop function if exists public.platform_create_company(text, text, text, text, text, integer);
drop function if exists public.require_platform_admin();
drop function if exists public.require_company_manager(uuid);
drop function if exists public.current_company_role(uuid);
drop function if exists public.company_create_invitation(uuid, text, text, text, text, text, text, uuid, integer);
drop function if exists public.company_token_hash(text);
drop function if exists public.company_audit(uuid, text, text, uuid, jsonb);


-- العضويات
drop trigger if exists company_memberships_touch on public.company_memberships;
drop function if exists public.company_memberships_touch();
drop index if exists public.company_memberships_one_primary;
alter table public.company_memberships drop constraint if exists company_memberships_company_id_fkey;
alter table public.company_memberships add constraint company_memberships_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete cascade;
alter table public.company_memberships drop constraint if exists company_memberships_status_check;
alter table public.company_memberships add constraint company_memberships_status_check check (status = any (array['active'::text, 'suspended'::text]));
alter table public.company_memberships drop constraint if exists company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role = any (array['company_manager'::text, 'supervisor'::text, 'technician'::text, 'accountant'::text]));
alter table public.company_memberships
  drop column if exists full_name, drop column if exists email, drop column if exists job_title, drop column if exists specialty,
  drop column if exists is_primary, drop column if exists invited_by, drop column if exists removed_at, drop column if exists updated_at;

-- الشركات
drop trigger if exists companies_before_update on public.companies;
drop function if exists public.companies_before_update();
alter table public.companies drop constraint if exists companies_status_check;
update public.companies set status = 'waiting_list' where status = 'pending';
update public.companies set status = 'closed' where status in ('suspended', 'archived');
alter table public.companies add constraint companies_status_check
  check (status = any (array['active'::text, 'waiting_list'::text, 'closed'::text]));
alter table public.companies alter column status set default 'waiting_list'::text;
alter table public.companies drop constraint if exists companies_manager_email_chk;
drop index if exists public.companies_ref_no_key;
alter table public.companies alter column ref_no drop default;
alter table public.companies
  drop column if exists ref_no, drop column if exists commercial_registration, drop column if exists phone, drop column if exists city,
  drop column if exists manager_email, drop column if exists suspended_at, drop column if exists archived_at, drop column if exists created_by;
drop function if exists public.company_next_ref();
drop sequence if exists public.company_ref_seq;

-- السياسات والصلاحيات الأصلية
drop policy if exists companies_delete_platform_admin on public.companies;
create policy companies_delete_platform_admin on public.companies for delete to authenticated using ((select public.is_platform_admin()));
drop policy if exists companies_insert_platform_admin on public.companies;
create policy companies_insert_platform_admin on public.companies for insert to authenticated with check ((select public.is_platform_admin()));
drop policy if exists companies_update_platform_admin on public.companies;
create policy companies_update_platform_admin on public.companies for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
grant all on public.companies, public.company_memberships to anon, authenticated;

notify pgrst, 'reload schema';
