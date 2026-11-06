-- =====================================================================
-- عين السلامة — الترحيل 1: الأساس
-- الأرقام المرجعية، كتالوج الصلاحيات، العضويات، الدعوات، دوال التحقق.
-- ترحيل إضافي آمن: لا يحذف جداول ولا بيانات، ويمكن إعادة تشغيله.
-- =====================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1) أدوات عامة
-- ---------------------------------------------------------------------

-- تحديث updated_at تلقائيًا
create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- هل المستدعي دور واجهة برمجية (وليس دالة SECURITY DEFINER أو service_role)؟
-- داخل دوال SECURITY DEFINER يصبح current_user مالك الدالة، فتتجاوز الحراسات بأمان.
create or replace function app_private.is_api_caller()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------------
-- 2) الأرقام المرجعية (عدّاد ذري لكل نطاق وشركة؛ لا يعتمد على COUNT)
-- ---------------------------------------------------------------------

create table if not exists app_private.ref_counters (
  scope text not null,
  organization_id uuid not null,
  last_value bigint not null default 0,
  primary key (scope, organization_id)
);

create or replace function app_private.next_ref(p_scope text, p_org uuid, p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
  zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into app_private.ref_counters as c (scope, organization_id, last_value)
  values (p_scope, coalesce(p_org, zero), 1)
  on conflict (scope, organization_id)
  do update set last_value = c.last_value + 1
  returning c.last_value into v;
  return p_prefix || '-' || case when length(v::text) >= 6 then v::text else lpad(v::text, 6, '0') end;
end $$;
revoke all on function app_private.next_ref(text, uuid, text) from public;

-- مُشغّل عام: TG_ARGV[0] = البادئة، TG_ARGV[1] = 'global' للنطاق العام.
-- يولّد ref_no عند الإدراج، ويمنع تغييره بعد ذلك.
create or replace function app_private.assign_ref()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_ref text;
begin
  if tg_op = 'INSERT' then
    if tg_nargs > 1 and tg_argv[1] = 'global' then
      v_org := null;
    else
      v_org := (to_jsonb(new) ->> 'organization_id')::uuid;
    end if;
    v_ref := app_private.next_ref(tg_table_name, v_org, tg_argv[0]);
    new := jsonb_populate_record(new, jsonb_build_object('ref_no', v_ref));
    return new;
  end if;

  if (to_jsonb(old) ->> 'ref_no') is not null
     and (to_jsonb(new) ->> 'ref_no') is distinct from (to_jsonb(old) ->> 'ref_no') then
    raise exception 'لا يمكن تعديل الرقم المرجعي' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) ->> 'ref_no') is null and (to_jsonb(new) ->> 'ref_no') is null then
    v_org := case when tg_nargs > 1 and tg_argv[1] = 'global' then null
                  else (to_jsonb(new) ->> 'organization_id')::uuid end;
    new := jsonb_populate_record(new, jsonb_build_object('ref_no', app_private.next_ref(tg_table_name, v_org, tg_argv[0])));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) الشركات: الرقم المرجعي والهوية البصرية وبيانات الاتصال
-- ---------------------------------------------------------------------

alter table public.organizations
  add column if not exists ref_no text,
  add column if not exists legal_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists city text,
  add column if not exists address text,
  add column if not exists vat_number text,
  add column if not exists license_no text,
  add column if not exists logo_path text,
  add column if not exists stamp_path text,
  add column if not exists primary_color text not null default '#1e3a5f',
  add column if not exists secondary_color text not null default '#d98e04',
  add column if not exists header_text text,
  add column if not exists footer_text text,
  add column if not exists signature_name text,
  add column if not exists signature_title text,
  add column if not exists show_logo_in_reports boolean not null default true,
  add column if not exists show_contact_in_reports boolean not null default true,
  add column if not exists show_stamp_in_reports boolean not null default false,
  add column if not exists notification_settings jsonb not null default '{"email": false, "sms": false, "whatsapp": false}'::jsonb,
  add column if not exists maintenance_alert_days integer not null default 14,
  add column if not exists last_alert_run_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_colors_chk') then
    alter table public.organizations add constraint organizations_colors_chk
      check (primary_color ~ '^#[0-9a-fA-F]{6}$' and secondary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_alert_days_chk') then
    alter table public.organizations add constraint organizations_alert_days_chk
      check (maintenance_alert_days between 1 and 180);
  end if;
end $$;

-- ترقيم الشركات الموجودة حسب تاريخ الإنشاء (مرة واحدة فقط لمن ليس له رقم)
do $$
declare r record;
begin
  for r in select id from public.organizations where ref_no is null order by created_at, id loop
    update public.organizations set ref_no = app_private.next_ref('organizations', null, 'ORG') where id = r.id;
  end loop;
end $$;

create unique index if not exists organizations_ref_no_key on public.organizations (ref_no);

drop trigger if exists trg_organizations_ref on public.organizations;
create trigger trg_organizations_ref before insert or update on public.organizations
  for each row execute function app_private.assign_ref('ORG', 'global');

-- سجل نسخ الهوية البصرية للاستعادة
create table if not exists public.organization_branding_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  snapshot jsonb not null,
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists organization_branding_history_org_idx
  on public.organization_branding_history (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4) المنصة
-- ---------------------------------------------------------------------

create or replace function app_private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 5) كتالوج الصلاحيات التفصيلية
-- ---------------------------------------------------------------------

create table if not exists public.permission_definitions (
  key text primary key,
  module text not null,
  action text not null,
  label_ar text not null,
  sort_order integer not null default 0
);

insert into public.permission_definitions (key, module, action, label_ar, sort_order) values
  ('customers.view', 'customers', 'view', 'عرض جميع العملاء', 100),
  ('customers.create', 'customers', 'create', 'إضافة عميل', 101),
  ('customers.update', 'customers', 'update', 'تعديل عميل', 102),
  ('customers.archive', 'customers', 'archive', 'أرشفة واستعادة العملاء', 103),
  ('customers.delete', 'customers', 'delete', 'حذف عميل نهائيًا', 104),
  ('sites.view', 'sites', 'view', 'عرض جميع المواقع', 110),
  ('sites.create', 'sites', 'create', 'إضافة موقع', 111),
  ('sites.update', 'sites', 'update', 'تعديل موقع', 112),
  ('sites.archive', 'sites', 'archive', 'أرشفة واستعادة المواقع', 113),
  ('sites.delete', 'sites', 'delete', 'حذف موقع نهائيًا', 114),
  ('technicians.view', 'technicians', 'view', 'عرض الفنيين', 120),
  ('technicians.create', 'technicians', 'create', 'إضافة فني', 121),
  ('technicians.update', 'technicians', 'update', 'تعديل فني', 122),
  ('technicians.archive', 'technicians', 'archive', 'أرشفة واستعادة الفنيين', 123),
  ('technicians.delete', 'technicians', 'delete', 'حذف فني نهائيًا', 124),
  ('assignments.manage', 'assignments', 'assign', 'إسناد الفنيين والعملاء', 130),
  ('field.assigned', 'field', 'view', 'عرض بيانات العملاء المسندين إليّ فقط', 135),
  ('catalog.view', 'catalog', 'view', 'عرض كتالوج أجهزة السلامة', 140),
  ('catalog.manage', 'catalog', 'manage', 'إدارة كتالوج أجهزة السلامة', 141),
  ('catalog.archive', 'catalog', 'archive', 'أرشفة واستعادة عناصر الكتالوج', 142),
  ('catalog.delete', 'catalog', 'delete', 'حذف عناصر الكتالوج نهائيًا', 143),
  ('devices.view', 'devices', 'view', 'عرض جميع الأجهزة', 150),
  ('devices.create', 'devices', 'create', 'تسجيل جهاز', 151),
  ('devices.update', 'devices', 'update', 'تعديل جهاز', 152),
  ('devices.archive', 'devices', 'archive', 'أرشفة واستعادة الأجهزة', 153),
  ('devices.delete', 'devices', 'delete', 'حذف جهاز نهائيًا', 154),
  ('devices.print', 'devices', 'print', 'طباعة ملصقات الأجهزة', 155),
  ('work_orders.view', 'work_orders', 'view', 'عرض جميع أوامر العمل', 160),
  ('work_orders.create', 'work_orders', 'create', 'إنشاء أمر عمل', 161),
  ('work_orders.update', 'work_orders', 'update', 'تعديل أمر عمل وحالته', 162),
  ('work_orders.archive', 'work_orders', 'archive', 'أرشفة واستعادة أوامر العمل', 163),
  ('work_orders.delete', 'work_orders', 'delete', 'حذف أمر عمل نهائيًا', 164),
  ('work_orders.assign', 'work_orders', 'assign', 'تعيين فنيين لأوامر العمل', 165),
  ('work_orders.approve', 'work_orders', 'approve', 'اعتماد أوامر العمل', 166),
  ('visits.view', 'visits', 'view', 'عرض جميع الزيارات', 170),
  ('visits.create', 'visits', 'create', 'جدولة زيارة', 171),
  ('visits.update', 'visits', 'update', 'تعديل زيارة وحالتها', 172),
  ('visits.archive', 'visits', 'archive', 'أرشفة واستعادة الزيارات', 173),
  ('visits.delete', 'visits', 'delete', 'حذف زيارة نهائيًا', 174),
  ('maintenance.view', 'maintenance', 'view', 'عرض جميع سجلات الصيانة', 180),
  ('maintenance.create', 'maintenance', 'create', 'تسجيل عملية صيانة', 181),
  ('reports.view', 'reports', 'view', 'الاطلاع على التقارير', 190),
  ('reports.export', 'reports', 'export', 'تصدير التقارير', 191),
  ('reports.print', 'reports', 'print', 'طباعة التقارير والمستندات', 192),
  ('users.view', 'users', 'view', 'عرض المستخدمين', 200),
  ('users.invite', 'users', 'invite', 'دعوة المستخدمين واعتماد الطلبات', 201),
  ('users.manage', 'users', 'manage', 'إيقاف وتفعيل المستخدمين', 202),
  ('users.permissions', 'users', 'permissions', 'إدارة صلاحيات المستخدمين', 203),
  ('settings.company', 'settings', 'company', 'تعديل بيانات الشركة', 210),
  ('settings.branding', 'settings', 'branding', 'إدارة الهوية البصرية', 211),
  ('audit.view', 'audit', 'view', 'الاطلاع على سجل التدقيق', 220)
on conflict (key) do update set module = excluded.module, action = excluded.action,
  label_ar = excluded.label_ar, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- 6) العضويات
-- ---------------------------------------------------------------------

alter table public.organization_members
  add column if not exists ref_no text,
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists job_roles text[] not null default '{}',
  add column if not exists is_owner boolean not null default false,
  add column if not exists invited_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare r record;
begin
  for r in select id, organization_id from public.organization_members where ref_no is null order by created_at, id loop
    update public.organization_members
      set ref_no = app_private.next_ref('organization_members', r.organization_id, 'USR')
      where id = r.id;
  end loop;
end $$;

create unique index if not exists organization_members_org_ref_key
  on public.organization_members (organization_id, ref_no);
create unique index if not exists organization_members_org_user_key
  on public.organization_members (organization_id, user_id);

drop trigger if exists trg_organization_members_ref on public.organization_members;
create trigger trg_organization_members_ref before insert or update on public.organization_members
  for each row execute function app_private.assign_ref('USR');
drop trigger if exists trg_organization_members_touch on public.organization_members;
create trigger trg_organization_members_touch before update on public.organization_members
  for each row execute function app_private.touch_updated_at();

create table if not exists public.member_permissions (
  member_id uuid not null references public.organization_members(id) on delete cascade,
  permission_key text not null references public.permission_definitions(key) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (member_id, permission_key)
);
create index if not exists member_permissions_org_idx on public.member_permissions (organization_id);

-- الدعوات
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  full_name text,
  job_roles text[] not null default '{}',
  permissions text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid
);
create unique index if not exists organization_invitations_pending_key
  on public.organization_invitations (organization_id, email) where status = 'pending';

-- ---------------------------------------------------------------------
-- 7) دوال التحقق من العضوية والصلاحيات (أساس RLS)
-- ---------------------------------------------------------------------

-- العضوية الفعّالة للمستخدم الحالي في الشركة (شركة معتمدة، عضوية نشطة غير منتهية)
create or replace function app_private.active_member_id(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_org
    and m.user_id = auth.uid()
    and m.status in ('active', 'approved') -- 'approved' قيمة قديمة محتملة قبل الترحيل
    and o.status = 'approved'
    and (m.expires_at is null or m.expires_at > now())
  limit 1
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.active_member_id(p_org) is not null
$$;

create or replace function public.has_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_permissions mp
    where mp.member_id = app_private.active_member_id(p_org)
      and mp.permission_key = p_perm
  )
$$;

create or replace function public.has_any_perm(p_org uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_permissions mp
    where mp.member_id = app_private.active_member_id(p_org)
      and mp.permission_key = any (p_perms)
  )
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_perm(uuid, text) from public, anon;
revoke all on function public.has_any_perm(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_perm(uuid, text) to authenticated;
grant execute on function public.has_any_perm(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 8) حارس التعديل العام: يمنع نقل السجل لشركة أخرى، ويفصل صلاحية الأرشفة عن التعديل.
--    TG_ARGV[0] = اسم الوحدة (customers, devices, ...)
-- ---------------------------------------------------------------------

create or replace function app_private.guard_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_module text := tg_argv[0];
  v_org uuid := (to_jsonb(old) ->> 'organization_id')::uuid;
  v_new jsonb := to_jsonb(new) - array['archived_at', 'archived_by', 'updated_at', 'approved_at', 'approved_by'];
  v_old jsonb := to_jsonb(old) - array['archived_at', 'archived_by', 'updated_at', 'approved_at', 'approved_by'];
  v_update_perm text := case when v_module = 'catalog' then 'catalog.manage' else v_module || '.update' end;
begin
  if (to_jsonb(new) ->> 'organization_id') is distinct from (to_jsonb(old) ->> 'organization_id') then
    raise exception 'لا يمكن نقل السجل إلى شركة أخرى' using errcode = '42501';
  end if;
  if not app_private.is_api_caller() then
    return new;
  end if;
  if (to_jsonb(new) ->> 'archived_at') is distinct from (to_jsonb(old) ->> 'archived_at') then
    if not public.has_perm(v_org, v_module || '.archive') then
      raise exception 'ليست لديك صلاحية الأرشفة أو الاستعادة' using errcode = '42501';
    end if;
    if (to_jsonb(new) ->> 'archived_at') is not null then
      new := jsonb_populate_record(new, jsonb_build_object('archived_by', auth.uid()));
    else
      new := jsonb_populate_record(new, jsonb_build_object('archived_by', null));
    end if;
  end if;
  -- الاعتماد صلاحية مستقلة، ويُسجَّل المعتمِد من الجلسة دائمًا
  if (to_jsonb(new) ->> 'approved_at') is distinct from (to_jsonb(old) ->> 'approved_at') then
    if not public.has_perm(v_org, v_module || '.approve') then
      raise exception 'ليست لديك صلاحية الاعتماد' using errcode = '42501';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('approved_by',
      case when (to_jsonb(new) ->> 'approved_at') is null then null else auth.uid() end));
  elsif (to_jsonb(new) ->> 'approved_by') is distinct from (to_jsonb(old) ->> 'approved_by') then
    raise exception 'لا يمكن تعديل بيانات الاعتماد مباشرة' using errcode = '42501';
  end if;
  if v_new is distinct from v_old and not public.has_perm(v_org, v_update_perm) then
    raise exception 'ليست لديك صلاحية التعديل' using errcode = '42501';
  end if;
  return new;
end $$;

-- تعيين created_by من الجلسة دائمًا (لا يُقبل من الواجهة)
create or replace function app_private.set_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app_private.is_api_caller() then
    new := jsonb_populate_record(new, jsonb_build_object('created_by', auth.uid()));
  end if;
  return new;
end $$;
