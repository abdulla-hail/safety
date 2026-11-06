-- =====================================================================
-- عين السلامة — الترحيل 6: ترحيل العضويات القائمة إلى نظام الصلاحيات التفصيلية
-- يحافظ على وصول مالكي/مديري الشركات الحاليين حتى لا يُحرموا بعد تفعيل RLS الجديدة.
-- لا يحذف أي بيانات، ويُطبَّق مرة واحدة فقط على من لا يملك صلاحيات بعد.
-- =====================================================================

-- 1) تعليم مالك الشركة: الدور owner، أو منشئ سجل الشركة
update public.organization_members m
   set is_owner = true
 where not m.is_owner
   and (lower(coalesce(m.role, '')) = 'owner'
        or exists (select 1 from public.organizations o where o.id = m.organization_id and o.created_by = m.user_id));

-- 2) بيانات العرض (الاسم والبريد) من حساب الدخول إن كانت فارغة
update public.organization_members m
   set email = lower(u.email),
       full_name = coalesce(m.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  from auth.users u
 where u.id = m.user_id and (m.email is null or m.full_name is null);

-- 3) منح المالكين والمديرين الحاليين كامل صلاحيات شركتهم (عدا «المسندين فقط»)،
--    فقط لمن ليست لديه أي صلاحية بعد (لا يغيّر ما منحه المدير لاحقًا).
insert into public.member_permissions (member_id, permission_key, organization_id, granted_by)
select m.id, d.key, m.organization_id, null
from public.organization_members m
cross join public.permission_definitions d
where d.key <> 'field.assigned'
  and (m.is_owner or lower(coalesce(m.role, '')) in ('admin', 'company_admin', 'manager', 'org_admin', 'administrator'))
  and m.status in ('active', 'approved')
  and not exists (select 1 from public.member_permissions x where x.member_id = m.id)
on conflict do nothing;

-- 4) كتالوج افتراضي للشركات المعتمدة القائمة (مرة واحدة إن لم يوجد)
do $$
declare o record;
begin
  for o in select id from public.organizations where status = 'approved' loop
    perform app_private.seed_default_catalog(o.id);
  end loop;
end $$;

-- 5) تسجيل الترحيل في سجل التدقيق
insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, summary, changes)
select id, null, 'permission_change', 'organization', 'ترحيل العضويات القائمة إلى الصلاحيات التفصيلية', '{}'::jsonb
from public.organizations where status = 'approved';
