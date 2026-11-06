-- =====================================================================
-- عين السلامة — مقترح تقوية (مشروع cgwnusudjhhxkwnqjzfr) — لم يُطبَّق
--
-- 1) safety_is_owner(): صفة المالك من platform_admins فقط (إزالة البريد الثابت).
--    الأثر الحالي: لا تغيير للمالك الحالي (حسابه نفسه موجود في platform_admins، والتحقق تم بقراءة فقط).
--    الفائدة: إلغاء صفة المالك يصبح فعّالًا بحذف صفّه من platform_admins، ولا يرث أحد صفة المالك
--    لو أعيد إنشاء الحساب أو انتقل البريد مستقبلًا.
-- 2) safety_provision_company_manager(): إزالة البريد الثابت؛ فحص platform_admins الموجود في الدالة
--    نفسها يمنع تعيين أي حساب مالك منصة مديرًا لشركة. بقية منطق الدالة دون تغيير حرفيًا.
-- 3) رؤية العضويات بأقل صلاحية: المستخدم يرى عضويته فقط، ومدير الشركة يرى أعضاء شركته، ومالك المنصة يرى الكل.
--    (سابقًا: أي عضو نشط يرى جميع أعضاء شركته ببريدهم وبياناتهم.)
--
-- لا يمس بيانات أي جدول. الصلاحيات (GRANT) على الدالتين تبقى كما هي مع CREATE OR REPLACE.
-- =====================================================================

create or replace function public.safety_is_owner()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
 if auth.uid() is null then return false; end if;
 return exists(select 1 from public.platform_admins where user_id = auth.uid());
end $function$;

create or replace function public.safety_provision_company_manager(company uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare manager_email text;
begin
 select lower(trim(company_data->>'email')) into manager_email from public.safety_tenants where company_key=company for update;
 if coalesce(manager_email,'')='' or manager_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
  raise exception 'أدخل البريد الصحيح لصاحب الشركة في بيانات الشركة أولاً';
 end if;
 if exists(
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
create policy memberships_select_authorized on public.company_memberships for select to authenticated
  using (
    (select public.is_platform_admin())
    or user_id = (select auth.uid())
    or (select public.current_company_role(company_memberships.company_id)) = 'company_manager'
  );

notify pgrst, 'reload schema';
