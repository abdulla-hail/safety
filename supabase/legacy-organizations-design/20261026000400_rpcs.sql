-- =====================================================================
-- عين السلامة — الترحيل 4: الدوال الآمنة (RPC)
-- كل دالة تتحقق من هوية المستدعي وصلاحياته داخل قاعدة البيانات،
-- ولا تقبل company_id من الواجهة دون التحقق من العضوية.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) سياق المستخدم الحالي
-- ---------------------------------------------------------------------
create or replace function public.get_my_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_platform_admin', app_private.is_platform_admin(),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'organization_id', o.id,
        'organization_name', o.name,
        'organization_ref', o.ref_no,
        'organization_status', o.status,
        'member_status', m.status,
        'member_ref', m.ref_no,
        'is_owner', m.is_owner,
        'job_roles', m.job_roles,
        'expires_at', m.expires_at,
        'is_expired', (m.expires_at is not null and m.expires_at <= now()),
        'primary_color', o.primary_color,
        'secondary_color', o.secondary_color,
        'logo_path', o.logo_path,
        'permissions', coalesce((
          select jsonb_agg(mp.permission_key order by mp.permission_key)
          from public.member_permissions mp where mp.member_id = m.id), '[]'::jsonb)
      ) order by m.created_at)
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = auth.uid()), '[]'::jsonb)
  )
$$;
revoke all on function public.get_my_context() from public, anon;
grant execute on function public.get_my_context() to authenticated;

-- ---------------------------------------------------------------------
-- 2) قبول الدعوات تلقائيًا بعد تسجيل الدخول (بريد Google موثّق فقط)
-- ---------------------------------------------------------------------
create or replace function public.accept_my_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  inv record;
  v_member uuid;
  n integer := 0;
begin
  if v_uid is null then return 0; end if;
  select lower(email), coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name
  from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return 0; end if;

  update public.organization_invitations set status = 'expired'
   where email = v_email and status = 'pending' and expires_at <= now();

  for inv in
    select i.* from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id
    where i.email = v_email and i.status = 'pending' and i.expires_at > now()
      and o.status = 'approved'
  loop
    insert into public.organization_members (organization_id, user_id, status, role, full_name, email,
                                             job_roles, invited_by, approved_by, approved_at)
    values (inv.organization_id, v_uid, 'active', 'member', coalesce(inv.full_name, v_name), v_email,
            inv.job_roles, inv.invited_by, inv.invited_by, now())
    on conflict (organization_id, user_id) do update
      set status = 'active', job_roles = excluded.job_roles, approved_by = excluded.approved_by,
          approved_at = now(), email = excluded.email,
          full_name = coalesce(public.organization_members.full_name, excluded.full_name)
    returning id into v_member;

    delete from public.member_permissions where member_id = v_member;
    insert into public.member_permissions (member_id, permission_key, organization_id, granted_by)
    select v_member, p, inv.organization_id, inv.invited_by
    from unnest(inv.permissions) as p
    where exists (select 1 from public.permission_definitions d where d.key = p)
    on conflict do nothing;

    update public.organization_invitations
       set status = 'accepted', accepted_at = now(), accepted_by = v_uid
     where id = inv.id;

    perform app_private.log_audit(inv.organization_id, 'invitation_accepted', 'member', v_member, null,
      coalesce(inv.full_name, v_email), jsonb_build_object('permissions', inv.permissions));
    perform app_private.notify(inv.organization_id, inv.invited_by, 'invitation_accepted',
      'قبول دعوة', coalesce(inv.full_name, v_email) || ' انضم إلى الشركة', '/settings/users', 'member', v_member);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.accept_my_invitations() from public, anon;
grant execute on function public.accept_my_invitations() to authenticated;

-- ---------------------------------------------------------------------
-- 3) طلب تسجيل شركة جديدة (تبقى معلّقة حتى يعتمدها مالك المنصة)
-- ---------------------------------------------------------------------
create or replace function public.request_company(
  p_name text, p_commercial_registration text default null,
  p_phone text default null, p_city text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_email text;
  v_name text;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'اسم الشركة مطلوب' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.user_id = v_uid and o.status = 'pending') then
    raise exception 'لديك طلب شركة قيد المراجعة بالفعل' using errcode = 'P0001';
  end if;

  select email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name from auth.users where id = v_uid;

  insert into public.organizations (name, commercial_registration, phone, city, status, created_by)
  values (btrim(p_name), nullif(btrim(p_commercial_registration), ''), nullif(btrim(p_phone), ''),
          nullif(btrim(p_city), ''), 'pending', v_uid)
  returning id into v_org;

  -- عضوية مالك معلّقة: لا تمنح أي وصول حتى يعتمد مالك المنصة الشركة
  insert into public.organization_members (organization_id, user_id, status, role, is_owner, full_name, email, job_roles)
  values (v_org, v_uid, 'pending', 'owner', true, v_name, lower(v_email), array['manager']);

  return v_org;
end $$;
revoke all on function public.request_company(text, text, text, text) from public, anon;
grant execute on function public.request_company(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) طلب الانضمام لشركة قائمة برقمها المرجعي (ينتظر اعتماد مدير الشركة)
-- ---------------------------------------------------------------------
create or replace function public.request_membership(p_org_ref text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_member uuid;
  v_email text;
  v_name text;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '42501'; end if;
  select id into v_org from public.organizations where ref_no = upper(btrim(p_org_ref)) and status = 'approved';
  if v_org is null then raise exception 'لم يتم العثور على شركة معتمدة بهذا الرقم' using errcode = 'P0002'; end if;
  if exists (select 1 from public.organization_members where organization_id = v_org and user_id = v_uid) then
    raise exception 'لديك عضوية أو طلب سابق في هذه الشركة' using errcode = 'P0001';
  end if;
  select email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name from auth.users where id = v_uid;

  insert into public.organization_members (organization_id, user_id, status, role, full_name, email)
  values (v_org, v_uid, 'pending', 'member', v_name, lower(v_email))
  returning id into v_member;

  perform app_private.notify_perm_holders(v_org, 'users.invite', 'membership_request',
    'طلب انضمام جديد', coalesce(v_name, v_email) || ' يطلب الانضمام', '/settings/users', 'member', v_member);
  return v_member;
end $$;
revoke all on function public.request_membership(text) from public, anon;
grant execute on function public.request_membership(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) مالك المنصة: تغيير حالة الشركة (يفعّل عضوية المالك عند الاعتماد)
-- ---------------------------------------------------------------------
create or replace function public.platform_set_company_status(p_org uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  m record;
begin
  if not app_private.is_platform_admin() then
    raise exception 'هذه العملية لمالك المنصة فقط' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'حالة غير صالحة' using errcode = '22023';
  end if;
  select status into v_old from public.organizations where id = p_org for update;
  if v_old is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;

  update public.organizations
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end
   where id = p_org;

  if p_status = 'approved' then
    for m in select id, user_id from public.organization_members
             where organization_id = p_org and is_owner and status = 'pending' loop
      update public.organization_members set status = 'active', approved_by = auth.uid(), approved_at = now()
       where id = m.id;
      insert into public.member_permissions (member_id, permission_key, organization_id, granted_by)
      select m.id, d.key, p_org, auth.uid() from public.permission_definitions d
      where d.key <> 'field.assigned'
      on conflict do nothing;
      perform app_private.notify(p_org, m.user_id, 'company_approved', 'تم اعتماد شركتك',
        'يمكنك الآن إدارة شركتك على المنصة', '/dashboard', 'organization', p_org);
    end loop;
    perform app_private.seed_default_catalog(p_org);
  end if;
  return true;
end $$;
revoke all on function public.platform_set_company_status(uuid, text) from public, anon;
grant execute on function public.platform_set_company_status(uuid, text) to authenticated;

-- الأنظمة الافتراضية لكتالوج أجهزة السلامة (تُضاف مرة واحدة ويمكن تعديلها)
create or replace function app_private.seed_default_catalog(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.safety_systems where organization_id = p_org) then return; end if;
  insert into public.safety_systems (organization_id, name, description, default_interval_days, sort_order) values
    (p_org, 'أنظمة الإنذار', 'لوحات الإنذار والكواشف ونقاط الكسر والصافرات', 180, 1),
    (p_org, 'طفايات الحريق', 'الطفايات اليدوية والمتنقلة بأنواعها', 365, 2),
    (p_org, 'أنظمة الرش الآلي', 'الرشاشات والصمامات وشبكات المياه', 180, 3),
    (p_org, 'مضخات الحريق', 'المضخات الرئيسية والاحتياطية ومضخات الجوكي', 90, 4),
    (p_org, 'إنارة الطوارئ', 'وحدات إنارة الطوارئ ولوحات المخارج', 180, 5),
    (p_org, 'أنظمة الإطفاء بالغاز', 'FM-200 وCO2 والغازات النظيفة', 180, 6),
    (p_org, 'الخراطيم وبكرات الحريق', 'بكرات الخراطيم وصناديق الحريق', 365, 7);
end $$;
revoke all on function app_private.seed_default_catalog(uuid) from public;

-- ---------------------------------------------------------------------
-- 6) إدارة الأعضاء والصلاحيات (مدير الشركة)
-- ---------------------------------------------------------------------

-- قاعدة منع التصعيد: لا يمنح المستخدم صلاحية لا يملكها هو.
create or replace function app_private.assert_can_grant(p_org uuid, p_perms text[])
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_missing text;
begin
  if exists (select 1 from unnest(p_perms) p where not exists (select 1 from public.permission_definitions d where d.key = p)) then
    raise exception 'صلاحية غير معروفة' using errcode = '22023';
  end if;
  select p into v_missing from unnest(p_perms) p where not public.has_perm(p_org, p) and p <> 'field.assigned' limit 1;
  if v_missing is not null then
    raise exception 'لا يمكنك منح صلاحية لا تملكها: %', v_missing using errcode = '42501';
  end if;
end $$;

create or replace function public.invite_member(
  p_org uuid, p_email text, p_full_name text, p_permissions text[], p_job_roles text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not public.has_perm(p_org, 'users.invite') then
    raise exception 'ليست لديك صلاحية دعوة المستخدمين' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'البريد الإلكتروني غير صالح' using errcode = '22023';
  end if;
  if coalesce(array_length(p_permissions, 1), 0) > 0 and not public.has_perm(p_org, 'users.permissions') then
    raise exception 'ليست لديك صلاحية منح الصلاحيات' using errcode = '42501';
  end if;
  perform app_private.assert_can_grant(p_org, coalesce(p_permissions, '{}'));
  if exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email and m.status = 'active') then
    raise exception 'هذا المستخدم عضو نشط بالفعل' using errcode = 'P0001';
  end if;

  update public.organization_invitations set status = 'revoked'
   where organization_id = p_org and email = v_email and status = 'pending';

  insert into public.organization_invitations (organization_id, email, full_name, permissions, job_roles, invited_by)
  values (p_org, v_email, nullif(btrim(p_full_name), ''), coalesce(p_permissions, '{}'), coalesce(p_job_roles, '{}'), auth.uid())
  returning id into v_id;

  perform app_private.log_audit(p_org, 'invite', 'invitation', v_id, null, v_email,
    jsonb_build_object('permissions', p_permissions, 'job_roles', p_job_roles));
  return v_id;
end $$;
revoke all on function public.invite_member(uuid, text, text, text[], text[]) from public, anon;
grant execute on function public.invite_member(uuid, text, text, text[], text[]) to authenticated;

create or replace function public.revoke_invitation(p_invitation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.organization_invitations where id = p_invitation and status = 'pending';
  if v_org is null or not public.has_perm(v_org, 'users.invite') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  update public.organization_invitations set status = 'revoked' where id = p_invitation;
  perform app_private.log_audit(v_org, 'revoke_invitation', 'invitation', p_invitation, null, null, '{}');
  return true;
end $$;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- تعيين صلاحيات عضو (استبدال كامل للقائمة)
create or replace function public.set_member_permissions(
  p_member uuid, p_permissions text[], p_job_roles text[] default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  m record;
  v_old text[];
  v_added text[];
  v_removed text[];
begin
  select * into m from public.organization_members where id = p_member;
  if m.id is null or not public.has_perm(m.organization_id, 'users.permissions') then
    raise exception 'ليست لديك صلاحية إدارة الصلاحيات' using errcode = '42501';
  end if;
  if m.is_owner and not exists (
    select 1 from public.organization_members x where x.id = app_private.active_member_id(m.organization_id) and x.is_owner) then
    raise exception 'لا يمكن تعديل صلاحيات مالك الشركة' using errcode = '42501';
  end if;

  select coalesce(array_agg(permission_key), '{}') into v_old from public.member_permissions where member_id = p_member;
  v_added := array(select unnest(coalesce(p_permissions, '{}')) except select unnest(v_old));
  v_removed := array(select unnest(v_old) except select unnest(coalesce(p_permissions, '{}')));

  -- يمكن إزالة أي صلاحية، لكن الإضافة مقيدة بما يملكه المنفّذ
  perform app_private.assert_can_grant(m.organization_id, v_added);

  -- منع حرمان الشركة من آخر مدير للصلاحيات
  if 'users.permissions' = any (v_removed) and not exists (
    select 1 from public.member_permissions mp join public.organization_members x on x.id = mp.member_id
    where mp.organization_id = m.organization_id and mp.permission_key = 'users.permissions'
      and x.status = 'active' and x.id <> p_member) then
    raise exception 'لا يمكن إزالة صلاحية إدارة الصلاحيات من آخر مستخدم يملكها' using errcode = 'P0001';
  end if;

  delete from public.member_permissions where member_id = p_member and permission_key = any (v_removed);
  insert into public.member_permissions (member_id, permission_key, organization_id, granted_by)
  select p_member, p, m.organization_id, auth.uid() from unnest(v_added) p
  on conflict do nothing;

  if p_job_roles is not null then
    update public.organization_members set job_roles = p_job_roles where id = p_member;
  end if;

  if cardinality(v_added) + cardinality(v_removed) > 0 or p_job_roles is not null then
    perform app_private.log_audit(m.organization_id, 'permission_change', 'member', p_member, m.ref_no,
      m.full_name, jsonb_build_object('added', v_added, 'removed', v_removed, 'job_roles', p_job_roles));
    perform app_private.notify(m.organization_id, m.user_id, 'permissions_changed', 'تم تحديث صلاحياتك',
      'راجع صلاحياتك الحالية في الملف الشخصي', '/dashboard', 'member', p_member);
  end if;
  return true;
end $$;
revoke all on function public.set_member_permissions(uuid, text[], text[]) from public, anon;
grant execute on function public.set_member_permissions(uuid, text[], text[]) to authenticated;

-- اعتماد / إيقاف / إعادة تفعيل / رفض عضو، مع تاريخ انتهاء اختياري
create or replace function public.set_member_status(
  p_member uuid, p_status text, p_expires_at timestamptz default null, p_reason text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.organization_members where id = p_member;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  if p_status not in ('active', 'suspended', 'rejected') then
    raise exception 'حالة غير صالحة' using errcode = '22023';
  end if;
  if m.status = 'pending' then
    if not public.has_perm(m.organization_id, 'users.invite') then
      raise exception 'ليست لديك صلاحية اعتماد الطلبات' using errcode = '42501';
    end if;
  elsif not public.has_perm(m.organization_id, 'users.manage') then
    raise exception 'ليست لديك صلاحية إدارة المستخدمين' using errcode = '42501';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'لا يمكنك تغيير حالة عضويتك بنفسك' using errcode = 'P0001';
  end if;
  if m.is_owner then
    raise exception 'لا يمكن تغيير حالة مالك الشركة من هنا' using errcode = '42501';
  end if;

  update public.organization_members
     set status = p_status,
         expires_at = p_expires_at,
         suspended_reason = case when p_status = 'suspended' then p_reason end,
         approved_by = case when p_status = 'active' and m.status = 'pending' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'active' and m.status = 'pending' then now() else approved_at end
   where id = p_member;

  perform app_private.log_audit(m.organization_id, 'member_status', 'member', p_member, m.ref_no, m.full_name,
    jsonb_build_object('from', m.status, 'to', p_status, 'expires_at', p_expires_at, 'reason', p_reason));
  perform app_private.notify(m.organization_id, m.user_id, 'membership_status',
    case p_status when 'active' then 'تم تفعيل عضويتك' when 'suspended' then 'تم إيقاف عضويتك' else 'تم رفض طلب العضوية' end,
    p_reason, '/dashboard', 'member', p_member);
  return true;
end $$;
revoke all on function public.set_member_status(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.set_member_status(uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7) بيانات الشركة وهويتها البصرية (مع حفظ نسخة للاستعادة)
-- ---------------------------------------------------------------------
create or replace function app_private.branding_snapshot(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', name, 'legal_name', legal_name, 'phone', phone, 'email', email, 'website', website,
    'city', city, 'address', address, 'vat_number', vat_number, 'license_no', license_no,
    'commercial_registration', commercial_registration,
    'logo_path', logo_path, 'stamp_path', stamp_path, 'primary_color', primary_color,
    'secondary_color', secondary_color, 'header_text', header_text, 'footer_text', footer_text,
    'signature_name', signature_name, 'signature_title', signature_title,
    'show_logo_in_reports', show_logo_in_reports, 'show_contact_in_reports', show_contact_in_reports,
    'show_stamp_in_reports', show_stamp_in_reports, 'maintenance_alert_days', maintenance_alert_days)
  from public.organizations where id = p_org
$$;

create or replace function public.update_company_profile(p_org uuid, p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_company boolean := public.has_perm(p_org, 'settings.company');
  v_branding boolean := public.has_perm(p_org, 'settings.branding');
  v_company_keys text[] := array['name', 'legal_name', 'phone', 'email', 'website', 'city', 'address',
                                 'vat_number', 'license_no', 'commercial_registration', 'maintenance_alert_days'];
  v_brand_keys text[] := array['logo_path', 'stamp_path', 'primary_color', 'secondary_color', 'header_text',
                               'footer_text', 'signature_name', 'signature_title', 'show_logo_in_reports',
                               'show_contact_in_reports', 'show_stamp_in_reports'];
  k text;
begin
  if not (v_company or v_branding) then
    raise exception 'ليست لديك صلاحية تعديل بيانات الشركة' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_data) loop
    if k = any (v_company_keys) and not v_company then
      raise exception 'ليست لديك صلاحية تعديل بيانات الشركة' using errcode = '42501';
    elsif k = any (v_brand_keys) and not v_branding then
      raise exception 'ليست لديك صلاحية تعديل الهوية البصرية' using errcode = '42501';
    elsif not (k = any (v_company_keys || v_brand_keys)) then
      raise exception 'حقل غير مسموح: %', k using errcode = '22023';
    end if;
  end loop;
  -- مسارات الملفات يجب أن تكون داخل مجلد الشركة نفسها
  for k in select unnest(array['logo_path', 'stamp_path']) loop
    if p_data ? k and p_data ->> k is not null and split_part(p_data ->> k, '/', 1) <> p_org::text then
      raise exception 'مسار الملف غير صالح' using errcode = '42501';
    end if;
  end loop;

  insert into public.organization_branding_history (organization_id, snapshot, changed_by)
  values (p_org, app_private.branding_snapshot(p_org), auth.uid());

  update public.organizations o set
    name = coalesce(nullif(btrim(p_data ->> 'name'), ''), o.name),
    legal_name = case when p_data ? 'legal_name' then nullif(btrim(p_data ->> 'legal_name'), '') else o.legal_name end,
    phone = case when p_data ? 'phone' then nullif(btrim(p_data ->> 'phone'), '') else o.phone end,
    email = case when p_data ? 'email' then nullif(lower(btrim(p_data ->> 'email')), '') else o.email end,
    website = case when p_data ? 'website' then nullif(btrim(p_data ->> 'website'), '') else o.website end,
    city = case when p_data ? 'city' then nullif(btrim(p_data ->> 'city'), '') else o.city end,
    address = case when p_data ? 'address' then nullif(btrim(p_data ->> 'address'), '') else o.address end,
    vat_number = case when p_data ? 'vat_number' then nullif(btrim(p_data ->> 'vat_number'), '') else o.vat_number end,
    license_no = case when p_data ? 'license_no' then nullif(btrim(p_data ->> 'license_no'), '') else o.license_no end,
    commercial_registration = case when p_data ? 'commercial_registration' then nullif(btrim(p_data ->> 'commercial_registration'), '') else o.commercial_registration end,
    maintenance_alert_days = coalesce((p_data ->> 'maintenance_alert_days')::integer, o.maintenance_alert_days),
    logo_path = case when p_data ? 'logo_path' then p_data ->> 'logo_path' else o.logo_path end,
    stamp_path = case when p_data ? 'stamp_path' then p_data ->> 'stamp_path' else o.stamp_path end,
    primary_color = coalesce(p_data ->> 'primary_color', o.primary_color),
    secondary_color = coalesce(p_data ->> 'secondary_color', o.secondary_color),
    header_text = case when p_data ? 'header_text' then nullif(btrim(p_data ->> 'header_text'), '') else o.header_text end,
    footer_text = case when p_data ? 'footer_text' then nullif(btrim(p_data ->> 'footer_text'), '') else o.footer_text end,
    signature_name = case when p_data ? 'signature_name' then nullif(btrim(p_data ->> 'signature_name'), '') else o.signature_name end,
    signature_title = case when p_data ? 'signature_title' then nullif(btrim(p_data ->> 'signature_title'), '') else o.signature_title end,
    show_logo_in_reports = coalesce((p_data ->> 'show_logo_in_reports')::boolean, o.show_logo_in_reports),
    show_contact_in_reports = coalesce((p_data ->> 'show_contact_in_reports')::boolean, o.show_contact_in_reports),
    show_stamp_in_reports = coalesce((p_data ->> 'show_stamp_in_reports')::boolean, o.show_stamp_in_reports)
  where o.id = p_org;
  return true;
end $$;
revoke all on function public.update_company_profile(uuid, jsonb) from public, anon;
grant execute on function public.update_company_profile(uuid, jsonb) to authenticated;

create or replace function public.restore_company_branding(p_history uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h record; v_brand jsonb;
begin
  select * into h from public.organization_branding_history where id = p_history;
  if h.id is null or not public.has_perm(h.organization_id, 'settings.branding') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  -- تُستعاد عناصر الهوية البصرية فقط
  select jsonb_object_agg(key, value) into v_brand from jsonb_each(h.snapshot)
  where key in ('logo_path', 'stamp_path', 'primary_color', 'secondary_color', 'header_text', 'footer_text',
                'signature_name', 'signature_title', 'show_logo_in_reports', 'show_contact_in_reports', 'show_stamp_in_reports');
  return public.update_company_profile(h.organization_id, coalesce(v_brand, '{}'::jsonb));
end $$;
revoke all on function public.restore_company_branding(uuid) from public, anon;
grant execute on function public.restore_company_branding(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8) تحويل رمز QR إلى جهاز بعد التحقق من الصلاحية
-- ---------------------------------------------------------------------
create or replace function public.resolve_device_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d record; v_token text := upper(btrim(p_token));
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthenticated'); end if;
  if v_token !~ '^[A-Z0-9]{8,32}$' then return jsonb_build_object('status', 'invalid'); end if;
  select id, organization_id, customer_id, archived_at into d from public.devices where qr_token = v_token;
  if d.id is null then
    if exists (select 1 from app_private.device_tokens where token = v_token) then
      return jsonb_build_object('status', 'removed');
    end if;
    return jsonb_build_object('status', 'not_found');
  end if;
  if not public.can_view_customer_data(d.organization_id, d.customer_id, 'devices') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  return jsonb_build_object('status', 'ok', 'device_id', d.id, 'organization_id', d.organization_id,
                            'archived', d.archived_at is not null);
end $$;
revoke all on function public.resolve_device_token(text) from public, anon;
grant execute on function public.resolve_device_token(text) to authenticated;
