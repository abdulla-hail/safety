-- =====================================================================
-- عين السلامة — م8: دوران فقط (مدير / فني) مع حماية المدير الأساسي، ونص الموقع كما أدخله المستخدم. (مشروع cgwnusudjhhxkwnqjzfr)
-- لا يحذف أي صف قائم. لا يمس safety_*. لا يغيّر عضوية قائمة.
--
-- 1) الأدوار: مدير (company_manager) وفني (technician) فقط للدعوات وتغيير الأدوار الجديدة.
--    - المدير الأساسي (is_primary): كل الصلاحيات دائمًا، ولا يُعدَّل دوره ولا حالته ولا صلاحياته ولا يُزال من إدارة الفريق.
--    - مديرون إضافيون: يعيّنهم المدير الأساسي وحده (دعوة أو ترقية)، بكل الصلاحيات افتراضيًا أو بصلاحيات يحددها لهم.
--    - إدارة الفريق صلاحية جديدة team.manage: من يملكها من المديرين يدير الفنيين ودعواتهم؛ إدارة المديرين للمدير الأساسي فقط،
--      ولا يمنح أحد صلاحية لا يملكها هو (عدا المدير الأساسي).
--    - الفني: صلاحياته التشغيلية فقط؛ صلاحيات الإدارة (team.manage, settings.branding, audit.view) لا تُحسب له أبدًا.
--    - نقل الإدارة: المدير الأساسي السابق يبقى «مديرًا» (كان يصبح مشرفًا).
--    - الدعوات المعلّقة بأدوار قديمة (مشرف/محاسب/أمين مستودع) تتحول إلى «مدير» بنفس صلاحياتها الفعلية المقصودة،
--      فلا يتغير ما سيحصل عليه المدعو، ولا تظهر أدوار إضافية. القيم الأصلية تُحفظ للتراجع.
-- 2) customer_sites.location_text: نص الموقع كما أدخله المستخدم (رابط مختصر، إحداثيات، عنوان وطني...) يُحفظ دائمًا،
--    وتحويله إلى إحداثيات منفصل (latitude/longitude) ولا يمنع الحفظ.
-- =====================================================================

do $$ begin
  if to_regclass('public.brands') is null then raise exception 'طبّق 20261111000100 أولًا'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) صلاحية إدارة الفريق
-- ---------------------------------------------------------------------
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('team.manage', 'team', 'إدارة الفريق والدعوات (الفنيون)', 50)
on conflict (key) do nothing;

-- صلاحيات الإدارة التي لا تُحسب للفني مطلقًا
create or replace function app_private.management_permissions() returns text[]
language sql immutable set search_path = '' as $$ select array['team.manage', 'settings.branding', 'audit.view']::text[] $$;

-- المدير: كل الصلاحيات (أو المحددة له إن خُصصت، للمدير غير الأساسي). الفني وغيره: المخصصة أو افتراضيات الدور، بلا صلاحيات الإدارة.
create or replace function public.company_effective_permissions(p_role text, p_custom text[])
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when p_role = 'company_manager' and p_custom is null
      then array(select key from public.permission_definitions where key <> 'field.assigned' order by key)
    when p_role = 'company_manager'
      then array(select k from unnest(p_custom) k where k <> 'field.assigned' and exists (select 1 from public.permission_definitions d where d.key = k) order by k)
    when p_custom is not null
      then array(select k from unnest(p_custom) k where k <> all (app_private.management_permissions())
                 and exists (select 1 from public.permission_definitions d where d.key = k) order by k)
    else array(select permission_key from public.company_role_permissions where role = p_role
               and permission_key <> all (app_private.management_permissions()) order by permission_key)
  end
$$;

create or replace function app_private.is_primary_manager(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = (select auth.uid()) and m.is_primary and m.role = 'company_manager'
      and m.status = 'active' and c.status = 'active')
$$;

create or replace function app_private.can_manage_team(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_company_role(p_company), '') = 'company_manager' and public.company_has_perm(p_company, 'team.manage')
$$;

create or replace function app_private.require_team_manager(p_company uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.can_manage_team(p_company) then
    raise exception 'إدارة الفريق لمن يملك صلاحيتها من مديري الشركة' using errcode = '42501';
  end if;
end $$;

-- صلاحيات يمنحها المنفّذ: يجب أن تكون معروفة، وغير المدير الأساسي لا يمنح ما لا يملكه
create or replace function app_private.check_grantable(p_company uuid, p_role text, p_permissions text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_mine text[];
begin
  if p_permissions is null then return; end if;
  if exists (select 1 from unnest(p_permissions) k where not exists (select 1 from public.permission_definitions d where d.key = k)) then
    raise exception 'صلاحية غير معروفة' using errcode = '22023';
  end if;
  if p_role <> 'company_manager' and p_permissions && app_private.management_permissions() then
    raise exception 'صلاحيات إدارة الشركة والفريق للمديرين فقط' using errcode = '22023';
  end if;
  if not app_private.is_primary_manager(p_company) then
    select public.company_effective_permissions(m.role, m.permissions) into v_mine from public.company_memberships m
     where m.company_id = p_company and m.user_id = (select auth.uid()) and m.status = 'active';
    if not (p_permissions <@ coalesce(v_mine, '{}')) then
      raise exception 'لا يمكنك منح صلاحية لا تملكها' using errcode = '42501';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) إدارة الأعضاء
-- ---------------------------------------------------------------------
create or replace function public.company_member_guard(p_membership uuid)
returns public.company_memberships language plpgsql stable security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform app_private.require_team_manager(m.company_id);
  if m.is_primary then raise exception 'المدير الأساسي محمي؛ لا يُعدَّل دوره أو حالته أو صلاحياته (استخدم نقل الإدارة)' using errcode = '42501'; end if;
  if m.user_id = auth.uid() then raise exception 'لا يمكنك تعديل عضويتك بنفسك' using errcode = '42501'; end if;
  if m.role = 'company_manager' and not app_private.is_primary_manager(m.company_id) then
    raise exception 'إدارة المديرين للمدير الأساسي فقط' using errcode = '42501';
  end if;
  return m;
end $$;

create or replace function public.company_set_member_role(p_membership uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  m := public.company_member_guard(p_membership);
  if p_role not in ('company_manager', 'technician') then
    raise exception 'الأدوار المتاحة: مدير أو فني' using errcode = '22023';
  end if;
  if p_role = 'company_manager' and not app_private.is_primary_manager(m.company_id) then
    raise exception 'تعيين المديرين للمدير الأساسي فقط' using errcode = '42501';
  end if;
  if p_role = m.role then return; end if;
  -- تغيير الدور يعيد الصلاحيات إلى افتراضيات الدور الجديد (المدير: كل الصلاحيات)
  update public.company_memberships set role = p_role, permissions = null where id = p_membership;
  perform public.company_audit(m.company_id, 'member_role', 'membership', m.id,
    jsonb_build_object('from', m.role, 'to', p_role, 'permissions_from', m.permissions));
  perform app_private.notify(m.company_id, m.user_id, 'permissions_changed',
    case when p_role = 'company_manager' then 'أصبحت مديرًا في الشركة' else 'تم تغيير دورك إلى فني' end, null, '/dashboard', 'membership', m.id, null);
end $$;

create or replace function public.company_set_member_permissions(p_membership uuid, p_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships; v_perms text[];
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform app_private.require_team_manager(m.company_id);
  if m.is_primary then raise exception 'المدير الأساسي يملك كل الصلاحيات دائمًا' using errcode = 'P0001'; end if;
  if m.user_id = auth.uid() then raise exception 'لا يمكنك تعديل صلاحياتك بنفسك' using errcode = '42501'; end if;
  if m.role = 'company_manager' and not app_private.is_primary_manager(m.company_id) then
    raise exception 'صلاحيات المديرين يحددها المدير الأساسي فقط' using errcode = '42501';
  end if;
  v_perms := case when p_permissions is null then null else array(select distinct k from unnest(p_permissions) k order by k) end;
  perform app_private.check_grantable(m.company_id, m.role, v_perms);
  update public.company_memberships set permissions = v_perms where id = p_membership;
  perform public.company_audit(m.company_id, 'member_permissions', 'membership', m.id,
    jsonb_build_object('from', m.permissions, 'to', v_perms));
  perform app_private.notify(m.company_id, m.user_id, 'permissions_changed', 'تم تحديث صلاحياتك', null, '/dashboard', 'membership', m.id, null);
end $$;

create or replace function public.company_update_member(p_membership uuid, p_full_name text, p_job_title text, p_specialty text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform app_private.require_team_manager(m.company_id);
  -- بيانات المديرين (ومنهم الأساسي) يعدّلها المدير الأساسي، أو المدير نفسه لبياناته
  if m.role = 'company_manager' and m.user_id <> auth.uid() and not app_private.is_primary_manager(m.company_id) then
    raise exception 'بيانات المديرين يعدّلها المدير الأساسي فقط' using errcode = '42501';
  end if;
  update public.company_memberships set full_name = nullif(btrim(p_full_name), ''), job_title = nullif(btrim(p_job_title), ''),
    specialty = nullif(btrim(p_specialty), '') where id = p_membership;
  perform public.company_audit(m.company_id, 'member_updated', 'membership', m.id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 2) الدعوات
-- ---------------------------------------------------------------------
create or replace function public.company_invite_member(p_company uuid, p_email text, p_role text, p_full_name text default null,
  p_job_title text default null, p_specialty text default null, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email));
begin
  perform app_private.require_team_manager(p_company);
  if p_role not in ('company_manager', 'technician') then
    raise exception 'الأدوار المتاحة: مدير أو فني' using errcode = '22023';
  end if;
  if p_role = 'company_manager' and not app_private.is_primary_manager(p_company) then
    raise exception 'دعوة المديرين للمدير الأساسي فقط' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_memberships m join auth.users u on u.id = m.user_id
             where m.company_id = p_company and m.status <> 'removed' and lower(u.email) = v_email) then
    raise exception 'لهذا البريد عضوية قائمة في الشركة' using errcode = '23505';
  end if;
  return public.company_create_invitation(p_company, 'member', v_email, p_role, p_full_name, p_job_title, p_specialty, null, p_expires_hours);
end $$;

create or replace function public.company_can_manage_invitation(p_inv public.company_invitations)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_inv.kind in ('manager', 'manager_transfer')
              then public.platform_has_perm('platform.companies.invitations')
                   or (p_inv.kind = 'manager_transfer' and app_private.is_primary_manager(p_inv.company_id))
              else app_private.can_manage_team(p_inv.company_id)
                   and (p_inv.role <> 'company_manager' or app_private.is_primary_manager(p_inv.company_id)) end
$$;

create or replace function public.company_set_invitation_permissions(p_invitation uuid, p_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v public.company_invitations; v_perms text[];
begin
  select * into v from public.company_invitations where id = p_invitation for update;
  if v.id is null then raise exception 'الدعوة غير موجودة' using errcode = 'P0002'; end if;
  if not public.company_can_manage_invitation(v) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v.kind <> 'member' or v.status <> 'pending' then raise exception 'يمكن تخصيص صلاحيات دعوة عضو معلّقة فقط' using errcode = 'P0001'; end if;
  v_perms := case when p_permissions is null then null else array(select distinct k from unnest(p_permissions) k order by k) end;
  perform app_private.check_grantable(v.company_id, v.role, v_perms);
  update public.company_invitations set permissions = v_perms where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_permissions', 'invitation', v.id, jsonb_build_object('permissions', to_jsonb(v_perms)));
end $$;

-- القبول: الصلاحيات المخصصة في الدعوة تُطبق على العضوية الناتجة (ما عدا المدير الأساسي)
create or replace function app_private.invitation_permissions_flow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.kind = 'member' and new.permissions is not null then
    update public.company_memberships set permissions = new.permissions
     where company_id = new.company_id and user_id = new.accepted_by and not is_primary;
  end if;
  -- إعادة الإرسال: الدعوة البديلة ترث الصلاحيات
  if new.replaced_by is not null and old.replaced_by is null and new.permissions is not null then
    update public.company_invitations set permissions = new.permissions where id = new.replaced_by and permissions is null;
  end if;
  return null;
end $$;

-- قبول الدعوة (من التعريف الحي مع ثلاثة تعديلات فقط): نقل الإدارة يُبقي السابق «مديرًا»، وإعادة الانضمام تبدأ بصلاحيات الدور
-- (ثم تُطبق صلاحيات الدعوة المخصصة إن وُجدت)، والمدير الأساسي الجديد بلا صلاحيات مخصصة.
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
    on conflict (company_id, user_id) do update set role = excluded.role, status = 'active', removed_at = null, permissions = null, is_primary = false,
      full_name = excluded.full_name, email = excluded.email, job_title = excluded.job_title, specialty = excluded.specialty
    returning id into v_id;

  else -- manager / manager_transfer
    if v.kind = 'manager' and exists (select 1 from public.company_memberships where company_id = v.company_id and is_primary) then
      raise exception 'للشركة مدير أساسي بالفعل' using errcode = 'P0001';
    end if;
    if v.kind = 'manager_transfer' then
      -- المدير الأساسي السابق يبقى «مديرًا» بكل الصلاحيات (لا يُحذف ولا تضيع سجلاته)
      update public.company_memberships set is_primary = false, role = 'company_manager', permissions = null
       where company_id = v.company_id and is_primary and user_id <> v_uid;
    end if;
    insert into public.company_memberships (company_id, user_id, role, status, is_primary, full_name, email, job_title, invited_by)
    values (v.company_id, v_uid, 'company_manager', 'active', true, coalesce(v.full_name, v_name), v_email, 'مدير الشركة', v.invited_by)
    on conflict (company_id, user_id) do update set role = 'company_manager', status = 'active', is_primary = true, removed_at = null, permissions = null, email = excluded.email
    returning id into v_id;
    update public.companies set manager_email = v_email,
      status = case when status = 'pending' then 'active' else status end
     where id = v.company_id;
  end if;

  update public.company_invitations set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_accepted', 'membership', v_id,
    jsonb_build_object('kind', v.kind, 'role', v.role, 'email', v_email, 'invitation_id', v.id));
  return jsonb_build_object('company_id', v.company_id, 'membership_id', v_id, 'kind', v.kind);
end $function$
;

-- ---------------------------------------------------------------------
-- 3) السياسات: الدعوات لمن يدير الفريق، وسجل التدقيق للمدير الأساسي ولمن يملك audit.view
-- ---------------------------------------------------------------------
drop policy if exists company_invitations_select on public.company_invitations;
create policy company_invitations_select on public.company_invitations for select to authenticated
  using ((select public.is_platform_admin()) or (select app_private.can_manage_team(company_id)));
drop policy if exists company_audit_log_select on public.company_audit_log;
create policy company_audit_log_select on public.company_audit_log for select to authenticated
  using ((select public.is_platform_admin()) or (select app_private.is_primary_manager(company_id))
         or (select public.company_has_perm(company_id, 'audit.view')));

-- ---------------------------------------------------------------------
-- 4) الدعوات المعلّقة بأدوار قديمة ← «مدير» بنفس الصلاحيات الفعلية المقصودة (مع حفظ الأصل للتراجع)
-- @expect-change company_invitations(role, permissions): تحويل الدعوات المعلّقة بأدوار قديمة إلى «مدير» بنفس صلاحياتها
-- ---------------------------------------------------------------------
create table if not exists app_private.migration_0112_invitations (
  invitation_id uuid primary key,
  role text not null,
  permissions text[],
  migrated_permissions text[] not null
);
revoke all on table app_private.migration_0112_invitations from public, anon, authenticated;
insert into app_private.migration_0112_invitations (invitation_id, role, permissions, migrated_permissions)
select i.id, i.role, i.permissions,
       coalesce(i.permissions, array(select permission_key from public.company_role_permissions r where r.role = i.role order by permission_key))
from public.company_invitations i
where i.status = 'pending' and i.kind = 'member' and i.role not in ('company_manager', 'technician')
on conflict (invitation_id) do nothing;
update public.company_invitations i set role = 'company_manager', permissions = b.migrated_permissions
from app_private.migration_0112_invitations b
where i.id = b.invitation_id and i.status = 'pending' and i.role = b.role;

-- ---------------------------------------------------------------------
-- 5) نص الموقع كما أدخله المستخدم
-- ---------------------------------------------------------------------
alter table public.customer_sites add column if not exists location_text text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_sites_location_text_len') then
    alter table public.customer_sites add constraint customer_sites_location_text_len check (location_text is null or char_length(location_text) <= 2000);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.management_permissions(), app_private.is_primary_manager(uuid), app_private.can_manage_team(uuid),
  app_private.require_team_manager(uuid), app_private.check_grantable(uuid, text, text[]), app_private.invitation_permissions_flow() from public, anon;
grant execute on function app_private.management_permissions(), app_private.is_primary_manager(uuid), app_private.can_manage_team(uuid)
  to authenticated;

notify pgrst, 'reload schema';
