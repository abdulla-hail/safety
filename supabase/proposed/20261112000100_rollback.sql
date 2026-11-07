-- =====================================================================
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

drop policy if exists company_audit_log_select on public.company_audit_log;
create policy company_audit_log_select on public.company_audit_log for select to authenticated using ((( SELECT is_platform_admin() AS is_platform_admin) OR (( SELECT current_company_role(company_audit_log.company_id) AS current_company_role) = 'company_manager'::text)));
drop policy if exists company_invitations_select on public.company_invitations;
create policy company_invitations_select on public.company_invitations for select to authenticated using ((( SELECT is_platform_admin() AS is_platform_admin) OR (( SELECT current_company_role(company_invitations.company_id) AS current_company_role) = 'company_manager'::text)));

CREATE OR REPLACE FUNCTION public.company_effective_permissions(p_role text, p_custom text[])
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_role = 'company_manager' then array(select key from public.permission_definitions where key <> 'field.assigned' order by key)
    when p_custom is not null then array(select k from unnest(p_custom) k where exists (select 1 from public.permission_definitions d where d.key = k) order by k)
    else array(select permission_key from public.company_role_permissions where role = p_role order by permission_key)
  end
$function$;

CREATE OR REPLACE FUNCTION public.company_member_guard(p_membership uuid)
 RETURNS company_memberships
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform public.require_company_manager(m.company_id);
  if m.is_primary then raise exception 'المدير الأساسي محمي؛ استخدم إجراء نقل الإدارة' using errcode = '42501'; end if;
  if m.user_id = auth.uid() then raise exception 'لا يمكنك تعديل عضويتك بنفسك' using errcode = '42501'; end if;
  return m;
end $function$;

CREATE OR REPLACE FUNCTION public.company_set_member_role(p_membership uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.company_memberships;
begin
  m := public.company_member_guard(p_membership);
  if p_role not in ('supervisor', 'technician', 'accountant', 'storekeeper') then
    raise exception 'دور غير مسموح؛ تعيين مدير الشركة يتم بإجراء نقل الإدارة' using errcode = '22023';
  end if;
  update public.company_memberships set role = p_role where id = p_membership;
  perform public.company_audit(m.company_id, 'member_role', 'membership', m.id, jsonb_build_object('from', m.role, 'to', p_role));
end $function$;

CREATE OR REPLACE FUNCTION public.company_set_member_permissions(p_membership uuid, p_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  if coalesce(public.current_company_role(m.company_id), '') <> 'company_manager' then
    raise exception 'هذه العملية لمدير الشركة فقط' using errcode = '42501';
  end if;
  if m.role = 'company_manager' then raise exception 'مدير الشركة يملك كل الصلاحيات' using errcode = 'P0001'; end if;
  if m.user_id = auth.uid() then raise exception 'لا يمكنك تعديل صلاحياتك بنفسك' using errcode = '42501'; end if;
  if p_permissions is not null and exists (select 1 from unnest(p_permissions) k where not exists (select 1 from public.permission_definitions d where d.key = k)) then
    raise exception 'صلاحية غير معروفة' using errcode = '22023';
  end if;
  update public.company_memberships set permissions = p_permissions where id = p_membership;
  perform public.company_audit(m.company_id, 'member_permissions', 'membership', m.id,
    jsonb_build_object('from', m.permissions, 'to', p_permissions));
  perform app_private.notify(m.company_id, m.user_id, 'permissions_changed', 'تم تحديث صلاحياتك', null, '/dashboard', 'membership', m.id, null);
end $function$;

CREATE OR REPLACE FUNCTION public.company_update_member(p_membership uuid, p_full_name text, p_job_title text, p_specialty text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform public.require_company_manager(m.company_id);
  update public.company_memberships set full_name = nullif(btrim(p_full_name), ''), job_title = nullif(btrim(p_job_title), ''),
    specialty = nullif(btrim(p_specialty), '') where id = p_membership;
  perform public.company_audit(m.company_id, 'member_updated', 'membership', m.id, '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.company_invite_member(p_company uuid, p_email text, p_role text, p_full_name text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_specialty text DEFAULT NULL::text, p_expires_hours integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text := lower(btrim(p_email));
begin
  perform public.require_company_manager(p_company);
  if p_role not in ('supervisor', 'technician', 'accountant', 'storekeeper') then
    raise exception 'دور غير مسموح؛ تعيين مدير الشركة يتم بإجراء نقل الإدارة' using errcode = '22023';
  end if;
  if exists (select 1 from public.company_memberships m join auth.users u on u.id = m.user_id
             where m.company_id = p_company and m.status <> 'removed' and lower(u.email) = v_email) then
    raise exception 'لهذا البريد عضوية قائمة في الشركة' using errcode = '23505';
  end if;
  return public.company_create_invitation(p_company, 'member', v_email, p_role, p_full_name, p_job_title, p_specialty, null, p_expires_hours);
end $function$;

CREATE OR REPLACE FUNCTION public.company_can_manage_invitation(p_inv company_invitations)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_inv.kind in ('manager', 'manager_transfer')
              then public.platform_has_perm('platform.companies.invitations')
                   or (p_inv.kind = 'manager_transfer' and exists (select 1 from public.company_memberships m
                         where m.company_id = p_inv.company_id and m.user_id = auth.uid() and m.is_primary and m.status = 'active'))
              else coalesce(public.current_company_role(p_inv.company_id), '') = 'company_manager' end
$function$;

CREATE OR REPLACE FUNCTION public.company_set_invitation_permissions(p_invitation uuid, p_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.company_invitations;
begin
  select * into v from public.company_invitations where id = p_invitation for update;
  if v.id is null then raise exception 'الدعوة غير موجودة' using errcode = 'P0002'; end if;
  if coalesce(public.current_company_role(v.company_id), '') <> 'company_manager' then
    raise exception 'هذه العملية لمدير الشركة فقط' using errcode = '42501';
  end if;
  if v.kind <> 'member' or v.status <> 'pending' then raise exception 'يمكن تخصيص صلاحيات دعوة عضو معلّقة فقط' using errcode = 'P0001'; end if;
  if p_permissions is not null and exists (select 1 from unnest(p_permissions) k
       where not exists (select 1 from public.permission_definitions d where d.key = k)) then
    raise exception 'صلاحية غير معروفة' using errcode = '22023';
  end if;
  update public.company_invitations
     set permissions = case when p_permissions is null then null else array(select distinct k from unnest(p_permissions) k order by k) end
   where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_permissions', 'invitation', v.id,
    jsonb_build_object('permissions', to_jsonb(p_permissions)));
end $function$;

CREATE OR REPLACE FUNCTION app_private.invitation_permissions_flow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- القبول: تُطبق الصلاحيات المخصصة على العضوية الناتجة
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.kind = 'member' and new.permissions is not null then
    update public.company_memberships set permissions = new.permissions
     where company_id = new.company_id and user_id = new.accepted_by and role <> 'company_manager';
  end if;
  -- إعادة الإرسال: الدعوة البديلة ترث الصلاحيات
  if new.replaced_by is not null and old.replaced_by is null and new.permissions is not null then
    update public.company_invitations set permissions = new.permissions where id = new.replaced_by and permissions is null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.company_invitations;
  c public.companies;
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_member public.company_memberships;
  v_id uuid;
begin
  if v_uid is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  select * into v from public.company_invitations where token_hash = public.company_token_hash(coalesce(p_token, '')) for update;
  if v.id is null then raise exception 'رابط الدعوة غير صالح' using errcode = 'P0002'; end if;
  if v.status = 'accepted' then raise exception 'استُخدمت هذه الدعوة من قبل' using errcode = 'P0001'; end if;
  if v.status = 'revoked' then raise exception 'أُلغيت هذه الدعوة' using errcode = 'P0001'; end if;
  if v.status = 'expired' or v.expires_at <= now() then
    update public.company_invitations set status = 'expired' where id = v.id and status = 'pending';
    raise exception 'انتهت صلاحية هذه الدعوة؛ اطلب دعوة جديدة' using errcode = 'P0001';
  end if;
  if public.is_platform_admin() then raise exception 'حساب مالك المنصة لا يقبل دعوات الشركات' using errcode = '42501'; end if;

  select lower(email), coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null or v_email <> v.email then
    raise exception 'هذه الدعوة لبريد آخر؛ سجّل الدخول بالبريد المدعو' using errcode = '42501';
  end if;

  select * into c from public.companies where id = v.company_id for update;
  if c.status in ('suspended', 'archived') then raise exception 'الشركة غير متاحة حاليًا' using errcode = 'P0001'; end if;
  if v.kind in ('member', 'email_change') and c.status <> 'active' then raise exception 'الشركة لم تُفعّل بعد' using errcode = 'P0001'; end if;

  select * into v_member from public.company_memberships where company_id = v.company_id and user_id = v_uid for update;

  if v.kind = 'email_change' then
    if v_member.id is not null and v_member.id <> v.membership_id then
      raise exception 'لهذا الحساب عضوية أخرى في الشركة' using errcode = '23505';
    end if;
    update public.company_memberships set user_id = v_uid, email = v_email
     where id = v.membership_id and company_id = v.company_id and status <> 'removed'
     returning id into v_id;
    if v_id is null then raise exception 'العضوية المستهدفة غير متاحة' using errcode = 'P0001'; end if;
    if exists (select 1 from public.company_memberships where id = v_id and is_primary) then
      update public.companies set manager_email = v_email where id = v.company_id;
    end if;

  elsif v.kind = 'member' then
    if v_member.id is not null and v_member.status = 'active' then
      raise exception 'لديك عضوية نشطة في هذه الشركة بالفعل' using errcode = '23505';
    end if;
    insert into public.company_memberships (company_id, user_id, role, status, full_name, email, job_title, specialty, invited_by)
    values (v.company_id, v_uid, v.role, 'active', coalesce(v.full_name, v_name), v_email, v.job_title, v.specialty, v.invited_by)
    on conflict (company_id, user_id) do update set role = excluded.role, status = 'active', removed_at = null,
      full_name = excluded.full_name, email = excluded.email, job_title = excluded.job_title, specialty = excluded.specialty
    returning id into v_id;

  else -- manager / manager_transfer
    if v.kind = 'manager' and exists (select 1 from public.company_memberships where company_id = v.company_id and is_primary) then
      raise exception 'للشركة مدير أساسي بالفعل' using errcode = 'P0001';
    end if;
    if v.kind = 'manager_transfer' then
      -- المدير السابق يبقى عضوًا بدور مشرف (لا يُحذف ولا تضيع سجلاته)
      update public.company_memberships set is_primary = false, role = 'supervisor'
       where company_id = v.company_id and is_primary and user_id <> v_uid;
    end if;
    insert into public.company_memberships (company_id, user_id, role, status, is_primary, full_name, email, job_title, invited_by)
    values (v.company_id, v_uid, 'company_manager', 'active', true, coalesce(v.full_name, v_name), v_email, 'مدير الشركة', v.invited_by)
    on conflict (company_id, user_id) do update set role = 'company_manager', status = 'active', is_primary = true, removed_at = null, email = excluded.email
    returning id into v_id;
    update public.companies set manager_email = v_email,
      status = case when status = 'pending' then 'active' else status end
     where id = v.company_id;
  end if;

  update public.company_invitations set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_accepted', 'membership', v_id,
    jsonb_build_object('kind', v.kind, 'role', v.role, 'email', v_email, 'invitation_id', v.id));
  return jsonb_build_object('company_id', v.company_id, 'membership_id', v_id, 'kind', v.kind);
end $function$;

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
