-- =====================================================================
-- التراجع عن 20261027000200_owner_and_member_visibility.sql (مولَّد من تعريفات cgwn الحالية قبل أي تطبيق)
-- يعيد الدالتين حرفيًا وسياسة رؤية العضويات كما هي. لا يمس أي بيانات. صلاحيات التنفيذ لا تتغير مع CREATE OR REPLACE.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.safety_is_owner()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare existing_owner boolean := false;
begin
 if auth.uid() is null then return false; end if;
 if to_regclass('public.platform_admins') is not null then
  execute 'select exists(select 1 from public.platform_admins where user_id=$1)' into existing_owner using auth.uid();
 end if;
 return existing_owner or exists(select 1 from auth.users where id=auth.uid() and lower(email)='alhommaidi1999@gmail.com' and email_confirmed_at is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.safety_provision_company_manager(company uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare manager_email text;
begin
 select lower(trim(company_data->>'email')) into manager_email from public.safety_tenants where company_key=company for update;
 if coalesce(manager_email,'')='' or manager_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
  raise exception 'أدخل البريد الصحيح لصاحب الشركة في بيانات الشركة أولاً';
 end if;
 if manager_email='alhommaidi1999@gmail.com' or exists(
  select 1 from auth.users u where lower(u.email)=manager_email and u.id=auth.uid()
 ) then raise exception 'استخدم بريد صاحب الشركة وليس بريد مالك المنصة'; end if;
 if to_regclass('public.platform_admins') is not null then
  if exists(select 1 from auth.users u join public.platform_admins p on p.user_id=u.id where lower(u.email)=manager_email) then
   raise exception 'حسابات إدارة المنصة لا تصبح مديري شركات';
  end if;
 end if;
 update public.safety_company_access set revoked=true
 where company_key=company and role='manager' and email<>manager_email and not revoked;
 insert into public.safety_company_access(company_key,email,role)
 values(company,manager_email,'manager')
 on conflict(company_key,email) do update set role='manager',revoked=false,
 token=case when public.safety_company_access.revoked then gen_random_uuid() else public.safety_company_access.token end,
 account_id=case when public.safety_company_access.revoked then null else public.safety_company_access.account_id end,
 accepted_at=case when public.safety_company_access.revoked then null else public.safety_company_access.accepted_at end,
 expires_at=case when public.safety_company_access.revoked then now()+interval '7 days' else public.safety_company_access.expires_at end;
end $function$;

drop policy if exists memberships_select_authorized on public.company_memberships;
create policy memberships_select_authorized on public.company_memberships as permissive for select to "authenticated"
  using ((( SELECT is_platform_admin() AS is_platform_admin) OR ( SELECT is_active_company_member(company_memberships.company_id) AS is_active_company_member)));

notify pgrst, 'reload schema';
