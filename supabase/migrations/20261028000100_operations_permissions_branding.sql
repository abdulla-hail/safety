-- =====================================================================
-- عين السلامة — الترحيل 2 لمشروع cgwnusudjhhxkwnqjzfr
-- الوحدات التشغيلية + الصلاحيات التفصيلية + الهوية البصرية + الإشعارات + التخزين
--
-- * إضافي فقط: جداول ودوال وأعمدة جديدة. لا يحذف ولا يعدّل صفوفًا قائمة، ولا يمس safety_*.
-- * يبني على companies / company_memberships / company_audit_log القائمة (لا نظام موازٍ).
-- * الصلاحيات: مدير الشركة يملك كل صلاحيات شركته؛ بقية الأدوار صلاحيات افتراضية لكل دور،
--   ويمكن لمدير الشركة تخصيص صلاحيات عضو بعينه (company_memberships.permissions).
-- * Supabase يمنح anon/authenticated افتراضيًا كل الصلاحيات على الكائنات الجديدة؛ تُسحب صراحة هنا.
-- =====================================================================

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

-- ---------------------------------------------------------------------
-- 1) أدوات عامة
-- ---------------------------------------------------------------------
create or replace function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;

-- داخل دوال SECURITY DEFINER يصبح current_user مالك الدالة فتتجاوز الحراسات بأمان
create or replace function app_private.is_api_caller() returns boolean
language sql stable set search_path = '' as $$ select current_user in ('authenticated', 'anon') $$;

create table if not exists app_private.ref_counters (
  scope text not null,
  company_id uuid not null,
  last_value bigint not null default 0,
  primary key (scope, company_id)
);

create or replace function app_private.next_ref(p_scope text, p_company uuid, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into app_private.ref_counters as c (scope, company_id, last_value) values (p_scope, p_company, 1)
  on conflict (scope, company_id) do update set last_value = c.last_value + 1
  returning c.last_value into v;
  return p_prefix || '-' || case when length(v::text) >= 6 then v::text else lpad(v::text, 6, '0') end;
end $$;

-- رقم مرجعي تلقائي لكل شركة (TG_ARGV[0] = البادئة) لا يتغير بعد الإنشاء
create or replace function app_private.assign_ref() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object('ref_no',
      app_private.next_ref(tg_table_name, (to_jsonb(new) ->> 'company_id')::uuid, tg_argv[0])));
  elsif (to_jsonb(new) ->> 'ref_no') is distinct from (to_jsonb(old) ->> 'ref_no') then
    raise exception 'لا يمكن تعديل الرقم المرجعي' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function app_private.set_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app_private.is_api_caller() then
    new := jsonb_populate_record(new, jsonb_build_object('created_by', auth.uid()));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) الصلاحيات التفصيلية
-- ---------------------------------------------------------------------
create table if not exists public.permission_definitions (
  key text primary key,
  module text not null,
  label_ar text not null,
  sort_order integer not null default 0
);
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('customers.view', 'customers', 'عرض جميع العملاء', 100),
  ('customers.create', 'customers', 'إضافة عميل', 101),
  ('customers.update', 'customers', 'تعديل عميل', 102),
  ('customers.archive', 'customers', 'أرشفة واستعادة العملاء', 103),
  ('customers.delete', 'customers', 'حذف عميل نهائيًا', 104),
  ('sites.view', 'sites', 'عرض جميع المواقع', 110),
  ('sites.create', 'sites', 'إضافة موقع', 111),
  ('sites.update', 'sites', 'تعديل موقع', 112),
  ('sites.archive', 'sites', 'أرشفة واستعادة المواقع', 113),
  ('sites.delete', 'sites', 'حذف موقع نهائيًا', 114),
  ('technicians.view', 'technicians', 'عرض الفنيين', 120),
  ('technicians.create', 'technicians', 'إضافة فني', 121),
  ('technicians.update', 'technicians', 'تعديل فني', 122),
  ('technicians.archive', 'technicians', 'أرشفة واستعادة الفنيين', 123),
  ('technicians.delete', 'technicians', 'حذف فني نهائيًا', 124),
  ('assignments.manage', 'assignments', 'إسناد الفنيين والعملاء', 130),
  ('field.assigned', 'field', 'عرض بيانات العملاء المسندين إليّ فقط', 135),
  ('catalog.view', 'catalog', 'عرض كتالوج أجهزة السلامة', 140),
  ('catalog.manage', 'catalog', 'إدارة كتالوج أجهزة السلامة', 141),
  ('catalog.archive', 'catalog', 'أرشفة واستعادة عناصر الكتالوج', 142),
  ('catalog.delete', 'catalog', 'حذف عناصر الكتالوج نهائيًا', 143),
  ('devices.view', 'devices', 'عرض جميع الأجهزة', 150),
  ('devices.create', 'devices', 'تسجيل جهاز', 151),
  ('devices.update', 'devices', 'تعديل جهاز', 152),
  ('devices.archive', 'devices', 'أرشفة واستعادة الأجهزة', 153),
  ('devices.delete', 'devices', 'حذف جهاز نهائيًا', 154),
  ('devices.print', 'devices', 'طباعة ملصقات الأجهزة', 155),
  ('work_orders.view', 'work_orders', 'عرض جميع أوامر العمل', 160),
  ('work_orders.create', 'work_orders', 'إنشاء أمر عمل', 161),
  ('work_orders.update', 'work_orders', 'تعديل أمر عمل وحالته', 162),
  ('work_orders.archive', 'work_orders', 'أرشفة واستعادة أوامر العمل', 163),
  ('work_orders.delete', 'work_orders', 'حذف أمر عمل نهائيًا', 164),
  ('work_orders.assign', 'work_orders', 'تعيين فنيين لأوامر العمل', 165),
  ('work_orders.approve', 'work_orders', 'اعتماد أوامر العمل', 166),
  ('visits.view', 'visits', 'عرض جميع الزيارات', 170),
  ('visits.create', 'visits', 'جدولة زيارة', 171),
  ('visits.update', 'visits', 'تعديل زيارة وحالتها', 172),
  ('visits.archive', 'visits', 'أرشفة واستعادة الزيارات', 173),
  ('visits.delete', 'visits', 'حذف زيارة نهائيًا', 174),
  ('maintenance.view', 'maintenance', 'عرض جميع سجلات الصيانة', 180),
  ('maintenance.create', 'maintenance', 'تسجيل عملية صيانة', 181),
  ('reports.view', 'reports', 'الاطلاع على التقارير', 190),
  ('reports.export', 'reports', 'تصدير التقارير', 191),
  ('reports.print', 'reports', 'طباعة التقارير والمستندات', 192),
  ('settings.branding', 'settings', 'إدارة الهوية البصرية وبيانات التقارير', 211),
  ('audit.view', 'audit', 'الاطلاع على سجل التدقيق', 220)
on conflict (key) do update set module = excluded.module, label_ar = excluded.label_ar, sort_order = excluded.sort_order;

create table if not exists public.company_role_permissions (
  role text not null check (role in ('supervisor', 'technician', 'accountant', 'storekeeper')),
  permission_key text not null references public.permission_definitions(key) on delete cascade,
  primary key (role, permission_key)
);
insert into public.company_role_permissions (role, permission_key)
select r, k from (values
  ('supervisor', array['customers.view','sites.view','technicians.view','catalog.view','devices.view','work_orders.view','visits.view',
    'maintenance.view','customers.create','customers.update','sites.create','sites.update','assignments.manage','devices.create',
    'devices.update','devices.print','work_orders.create','work_orders.update','work_orders.assign','work_orders.approve',
    'visits.create','visits.update','maintenance.create','reports.view','reports.print','reports.export']),
  ('technician', array['field.assigned','catalog.view','maintenance.create','devices.print','visits.update']),
  ('accountant', array['customers.view','sites.view','technicians.view','catalog.view','devices.view','work_orders.view','visits.view',
    'maintenance.view','reports.view','reports.export','reports.print']),
  ('storekeeper', array['catalog.view','catalog.manage','devices.view','reports.view'])
) as v(r, keys), unnest(v.keys) as k
on conflict do nothing;

-- تخصيص صلاحيات عضو بعينه (null = الصلاحيات الافتراضية لدوره)
alter table public.company_memberships add column if not exists permissions text[];

create or replace function public.company_effective_permissions(p_role text, p_custom text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select case
    when p_role = 'company_manager' then array(select key from public.permission_definitions where key <> 'field.assigned' order by key)
    when p_custom is not null then array(select k from unnest(p_custom) k where exists (select 1 from public.permission_definitions d where d.key = k) order by k)
    else array(select permission_key from public.company_role_permissions where role = p_role order by permission_key)
  end
$$;

-- العضوية الفعّالة للمستخدم الحالي في شركة نشطة
create or replace function public.company_member_row(p_company uuid) returns public.company_memberships
language sql stable security definer set search_path = '' as $$
  select m.* from public.company_memberships m join public.companies c on c.id = m.company_id
  where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
  limit 1
$$;

create or replace function public.company_is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((public.company_member_row(p_company)).id is not null, false)
$$;

-- تعيد true/false دائمًا (لا NULL) حتى لا تُتجاوز شروط «if not ...» في الحراسات
create or replace function public.company_has_perm(p_company uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p_perm = any (public.company_effective_permissions(m.role, m.permissions))
    from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
    limit 1), false)
$$;

create or replace function public.company_has_any_perm(p_company uuid, p_perms text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select public.company_effective_permissions(m.role, m.permissions) && p_perms
    from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
    limit 1), false)
$$;

-- مدير الشركة يخصص صلاحيات عضو (لا المدير الأساسي ولا نفسه). null يعيد الافتراضي.
create or replace function public.company_set_member_permissions(p_membership uuid, p_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
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
end $$;

-- ---------------------------------------------------------------------
-- 3) هوية الشركة (تُدار من مدير الشركة؛ البيانات العامة يديرها مالك المنصة)
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists legal_name text,
  add column if not exists email text,
  add column if not exists website text,
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
  add column if not exists maintenance_alert_days integer not null default 14,
  add column if not exists last_alert_run_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_colors_chk') then
    alter table public.companies add constraint companies_colors_chk
      check (primary_color ~ '^#[0-9a-fA-F]{6}$' and secondary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_alert_days_chk') then
    alter table public.companies add constraint companies_alert_days_chk check (maintenance_alert_days between 1 and 180);
  end if;
end $$;

create table if not exists public.company_branding_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  snapshot jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists company_branding_history_idx on public.company_branding_history (company_id, created_at desc);

create or replace function public.company_branding_snapshot(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('legal_name', legal_name, 'email', email, 'website', website, 'address', address,
    'vat_number', vat_number, 'license_no', license_no, 'logo_path', logo_path, 'stamp_path', stamp_path,
    'primary_color', primary_color, 'secondary_color', secondary_color, 'header_text', header_text,
    'footer_text', footer_text, 'signature_name', signature_name, 'signature_title', signature_title,
    'show_logo_in_reports', show_logo_in_reports, 'show_contact_in_reports', show_contact_in_reports,
    'show_stamp_in_reports', show_stamp_in_reports, 'maintenance_alert_days', maintenance_alert_days)
  from public.companies where id = p_company
$$;

create or replace function public.company_update_branding(p_company uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  allowed text[] := array['legal_name','email','website','address','vat_number','license_no','logo_path','stamp_path',
    'primary_color','secondary_color','header_text','footer_text','signature_name','signature_title',
    'show_logo_in_reports','show_contact_in_reports','show_stamp_in_reports','maintenance_alert_days'];
begin
  if not public.company_has_perm(p_company, 'settings.branding') then
    raise exception 'ليست لديك صلاحية إدارة هوية الشركة' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_data) loop
    if not (k = any (allowed)) then raise exception 'حقل غير مسموح: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['logo_path', 'stamp_path'] loop
    if p_data ? k and p_data ->> k is not null and split_part(p_data ->> k, '/', 1) <> p_company::text then
      raise exception 'مسار الملف غير صالح' using errcode = '42501';
    end if;
  end loop;
  insert into public.company_branding_history (company_id, snapshot, changed_by)
  values (p_company, public.company_branding_snapshot(p_company), auth.uid());
  update public.companies c set
    legal_name = case when p_data ? 'legal_name' then nullif(btrim(p_data ->> 'legal_name'), '') else c.legal_name end,
    email = case when p_data ? 'email' then nullif(lower(btrim(p_data ->> 'email')), '') else c.email end,
    website = case when p_data ? 'website' then nullif(btrim(p_data ->> 'website'), '') else c.website end,
    address = case when p_data ? 'address' then nullif(btrim(p_data ->> 'address'), '') else c.address end,
    vat_number = case when p_data ? 'vat_number' then nullif(btrim(p_data ->> 'vat_number'), '') else c.vat_number end,
    license_no = case when p_data ? 'license_no' then nullif(btrim(p_data ->> 'license_no'), '') else c.license_no end,
    logo_path = case when p_data ? 'logo_path' then p_data ->> 'logo_path' else c.logo_path end,
    stamp_path = case when p_data ? 'stamp_path' then p_data ->> 'stamp_path' else c.stamp_path end,
    primary_color = coalesce(p_data ->> 'primary_color', c.primary_color),
    secondary_color = coalesce(p_data ->> 'secondary_color', c.secondary_color),
    header_text = case when p_data ? 'header_text' then nullif(btrim(p_data ->> 'header_text'), '') else c.header_text end,
    footer_text = case when p_data ? 'footer_text' then nullif(btrim(p_data ->> 'footer_text'), '') else c.footer_text end,
    signature_name = case when p_data ? 'signature_name' then nullif(btrim(p_data ->> 'signature_name'), '') else c.signature_name end,
    signature_title = case when p_data ? 'signature_title' then nullif(btrim(p_data ->> 'signature_title'), '') else c.signature_title end,
    show_logo_in_reports = coalesce((p_data ->> 'show_logo_in_reports')::boolean, c.show_logo_in_reports),
    show_contact_in_reports = coalesce((p_data ->> 'show_contact_in_reports')::boolean, c.show_contact_in_reports),
    show_stamp_in_reports = coalesce((p_data ->> 'show_stamp_in_reports')::boolean, c.show_stamp_in_reports),
    maintenance_alert_days = coalesce((p_data ->> 'maintenance_alert_days')::integer, c.maintenance_alert_days)
  where c.id = p_company;
  perform public.company_audit(p_company, 'branding_updated', 'company', p_company, jsonb_build_object('keys', (select jsonb_agg(x) from jsonb_object_keys(p_data) x)));
end $$;

create or replace function public.company_restore_branding(p_history uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.company_branding_history;
begin
  select * into h from public.company_branding_history where id = p_history;
  if h.id is null or not public.company_has_perm(h.company_id, 'settings.branding') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  perform public.company_update_branding(h.company_id, h.snapshot);
end $$;

-- ---------------------------------------------------------------------
-- 4) الجداول التشغيلية (كل سجل مرتبط بشركة؛ العلاقات بمفاتيح مركبة تضمن نفس الشركة)
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_id_key_for_fk') then
    -- id مفتاح أساسي أصلًا؛ هذا القيد يتيح مفاتيح مركبة (id, company) في الجداول التابعة
    null;
  end if;
end $$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  name text not null check (length(btrim(name)) between 2 and 200),
  customer_type text not null default 'company' check (customer_type in ('company', 'government', 'individual')),
  is_active boolean not null default true,
  contact_name text, phone text, email text, city text, address text,
  commercial_registration text, vat_number text, notes text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint customers_id_company_key unique (id, company_id)
);
create unique index if not exists customers_company_ref_key on public.customers (company_id, ref_no);
create index if not exists customers_company_name_idx on public.customers (company_id, name);

create table if not exists public.technicians (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  full_name text not null check (length(btrim(full_name)) between 2 and 200),
  phone text, email text, job_title text,
  user_id uuid references auth.users(id) on delete set null,
  specialties text[] not null default '{}',
  availability text not null default 'available' check (availability in ('available', 'busy', 'on_leave')),
  is_active boolean not null default true,
  hire_date date, notes text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint technicians_id_company_key unique (id, company_id)
);
create unique index if not exists technicians_company_ref_key on public.technicians (company_id, ref_no);
create unique index if not exists technicians_company_user_key on public.technicians (company_id, user_id) where user_id is not null;

create or replace function app_private.check_technician_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.company_memberships m where m.company_id = new.company_id and m.user_id = new.user_id and m.status <> 'removed') then
    raise exception 'الحساب المرتبط بالفني ليس عضوًا في الشركة' using errcode = '23514';
  end if;
  return new;
end $$;

create table if not exists public.customer_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null,
  ref_no text,
  name text not null check (length(btrim(name)) between 1 and 200),
  city text, district text, address text, contact_name text, contact_phone text, notes text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint customer_sites_id_company_key unique (id, company_id),
  constraint customer_sites_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict
);
create unique index if not exists customer_sites_company_ref_key on public.customer_sites (company_id, ref_no);
create index if not exists customer_sites_customer_idx on public.customer_sites (customer_id);

create table if not exists public.technician_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  technician_id uuid not null,
  customer_id uuid not null,
  is_primary boolean not null default false,
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  constraint technician_customers_unique unique (technician_id, customer_id),
  constraint technician_customers_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete cascade,
  constraint technician_customers_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create index if not exists technician_customers_customer_idx on public.technician_customers (customer_id);

create or replace function app_private.is_assigned_customer(p_company uuid, p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
    where tc.company_id = p_company and tc.customer_id = p_customer and t.user_id = auth.uid() and t.archived_at is null)
$$;

create or replace function public.company_can_view_customer(p_company uuid, p_customer uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.company_has_perm(p_company, p_module || '.view')
      or (public.company_has_perm(p_company, 'field.assigned') and app_private.is_assigned_customer(p_company, p_customer))
$$;

create table if not exists public.safety_systems (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  name text not null check (length(btrim(name)) between 2 and 150),
  description text,
  default_interval_days integer check (default_interval_days between 1 and 3650),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint safety_systems_id_company_key unique (id, company_id)
);
create unique index if not exists safety_systems_company_ref_key on public.safety_systems (company_id, ref_no);
create unique index if not exists safety_systems_company_name_key on public.safety_systems (company_id, lower(name));

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  system_id uuid not null,
  ref_no text,
  name text not null check (length(btrim(name)) between 2 and 200),
  manufacturer text, model text, device_type text, description text,
  specs jsonb not null default '{}'::jsonb,
  image_path text,
  default_interval_days integer check (default_interval_days between 1 and 3650),
  is_active boolean not null default true,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint catalog_items_id_company_key unique (id, company_id),
  constraint catalog_items_system_fk foreign key (system_id, company_id) references public.safety_systems (id, company_id) on delete restrict
);
create unique index if not exists catalog_items_company_ref_key on public.catalog_items (company_id, ref_no);
create index if not exists catalog_items_system_idx on public.catalog_items (system_id);

-- سجل دائم لكل رمز جهاز؛ لا يُحذف فلا يتكرر الرمز أبدًا
create table if not exists app_private.device_tokens (
  token text primary key,
  device_id uuid not null,
  company_id uuid not null,
  issued_at timestamptz not null default now()
);

create or replace function app_private.new_device_token() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; t text; i integer;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    t := '';
    for i in 0..11 loop t := t || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from app_private.device_tokens where token = t);
  end loop;
  return t;
end $$;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  qr_token text not null default app_private.new_device_token(),
  customer_id uuid not null,
  site_id uuid, system_id uuid, catalog_item_id uuid,
  name text not null check (length(btrim(name)) between 1 and 200),
  manufacturer text, model text, device_type text, serial_number text, location_detail text, capacity text,
  installed_at date, expires_at date,
  status text not null default 'operational'
    check (status in ('operational', 'needs_maintenance', 'under_repair', 'out_of_service', 'expired', 'decommissioned')),
  maintenance_interval_days integer check (maintenance_interval_days between 1 and 3650),
  last_maintenance_at date, next_maintenance_at date, notes text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint devices_id_company_key unique (id, company_id),
  constraint devices_qr_token_key unique (qr_token),
  constraint devices_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint devices_site_fk foreign key (site_id, company_id) references public.customer_sites (id, company_id) on delete restrict,
  constraint devices_system_fk foreign key (system_id, company_id) references public.safety_systems (id, company_id) on delete restrict,
  constraint devices_catalog_fk foreign key (catalog_item_id, company_id) references public.catalog_items (id, company_id) on delete restrict
);
create unique index if not exists devices_company_ref_key on public.devices (company_id, ref_no);
create index if not exists devices_customer_idx on public.devices (customer_id);
create index if not exists devices_site_idx on public.devices (site_id);
create index if not exists devices_next_due_idx on public.devices (company_id, next_maintenance_at) where archived_at is null;
create unique index if not exists devices_serial_key on public.devices
  (company_id, lower(coalesce(manufacturer, '')), lower(serial_number)) where serial_number is not null and archived_at is null;

create or replace function app_private.devices_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; s_customer uuid;
begin
  if tg_op = 'UPDATE' and new.qr_token is distinct from old.qr_token then
    raise exception 'لا يمكن تغيير رمز الجهاز' using errcode = 'P0001';
  end if;
  if new.site_id is not null then
    select customer_id into s_customer from public.customer_sites where id = new.site_id;
    if s_customer is distinct from new.customer_id then raise exception 'الموقع المحدد لا يتبع العميل نفسه' using errcode = '23514'; end if;
  end if;
  if tg_op = 'INSERT' then
    if new.catalog_item_id is not null then
      select * into c from public.catalog_items where id = new.catalog_item_id;
      new.system_id := coalesce(new.system_id, c.system_id);
      if new.system_id is distinct from c.system_id then raise exception 'تعريف الجهاز لا يتبع النظام المحدد' using errcode = '23514'; end if;
      new.name := coalesce(nullif(btrim(new.name), ''), c.name);
      new.manufacturer := coalesce(nullif(btrim(new.manufacturer), ''), c.manufacturer);
      new.model := coalesce(nullif(btrim(new.model), ''), c.model);
      new.device_type := coalesce(nullif(btrim(new.device_type), ''), c.device_type);
      new.maintenance_interval_days := coalesce(new.maintenance_interval_days, c.default_interval_days);
    end if;
    if new.maintenance_interval_days is null and new.system_id is not null then
      select default_interval_days into new.maintenance_interval_days from public.safety_systems where id = new.system_id;
    end if;
    if new.next_maintenance_at is null and new.maintenance_interval_days is not null then
      new.next_maintenance_at := coalesce(new.last_maintenance_at, new.installed_at, current_date) + new.maintenance_interval_days;
    end if;
    insert into app_private.device_tokens (token, device_id, company_id) values (new.qr_token, new.id, new.company_id);
  end if;
  return new;
end $$;

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  customer_id uuid not null, site_id uuid,
  title text not null check (length(btrim(title)) between 3 and 200),
  description text,
  order_type text not null default 'preventive' check (order_type in ('preventive', 'corrective', 'inspection', 'installation', 'emergency')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'new' check (status in ('new', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  scheduled_for timestamptz, due_at timestamptz, completed_at timestamptz,
  approved_at timestamptz, approved_by uuid,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint work_orders_id_company_key unique (id, company_id),
  constraint work_orders_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint work_orders_site_fk foreign key (site_id, company_id) references public.customer_sites (id, company_id) on delete restrict
);
create unique index if not exists work_orders_company_ref_key on public.work_orders (company_id, ref_no);
create index if not exists work_orders_customer_idx on public.work_orders (customer_id);
create index if not exists work_orders_status_idx on public.work_orders (company_id, status);

create table if not exists public.work_order_technicians (
  work_order_id uuid not null, technician_id uuid not null, company_id uuid not null,
  created_by uuid, created_at timestamptz not null default now(),
  primary key (work_order_id, technician_id),
  constraint wot_wo_fk foreign key (work_order_id, company_id) references public.work_orders (id, company_id) on delete cascade,
  constraint wot_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete restrict
);
create index if not exists work_order_technicians_tech_idx on public.work_order_technicians (technician_id);

create table if not exists public.work_order_devices (
  work_order_id uuid not null, device_id uuid not null, company_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (work_order_id, device_id),
  constraint wod_wo_fk foreign key (work_order_id, company_id) references public.work_orders (id, company_id) on delete cascade,
  constraint wod_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  customer_id uuid not null, site_id uuid, work_order_id uuid,
  scheduled_start timestamptz not null, scheduled_end timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'missed')),
  actual_start timestamptz, actual_end timestamptz, summary text, notes text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint visits_id_company_key unique (id, company_id),
  constraint visits_time_chk check (scheduled_end is null or scheduled_end >= scheduled_start),
  constraint visits_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint visits_site_fk foreign key (site_id, company_id) references public.customer_sites (id, company_id) on delete restrict,
  constraint visits_wo_fk foreign key (work_order_id, company_id) references public.work_orders (id, company_id) on delete restrict
);
create unique index if not exists visits_company_ref_key on public.visits (company_id, ref_no);
create index if not exists visits_customer_idx on public.visits (customer_id);
create index if not exists visits_schedule_idx on public.visits (company_id, scheduled_start);

create table if not exists public.visit_technicians (
  visit_id uuid not null, technician_id uuid not null, company_id uuid not null,
  created_by uuid, created_at timestamptz not null default now(),
  primary key (visit_id, technician_id),
  constraint vt_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete cascade,
  constraint vt_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete restrict
);
create index if not exists visit_technicians_tech_idx on public.visit_technicians (technician_id);

create or replace function app_private.check_customer_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if new.site_id is not null then
    select customer_id into v from public.customer_sites where id = new.site_id;
    if v is distinct from new.customer_id then raise exception 'الموقع المحدد لا يتبع العميل نفسه' using errcode = '23514'; end if;
  end if;
  if tg_table_name = 'visits' and (to_jsonb(new) ->> 'work_order_id') is not null then
    select customer_id into v from public.work_orders where id = (to_jsonb(new) ->> 'work_order_id')::uuid;
    if v is distinct from new.customer_id then raise exception 'أمر العمل المحدد لا يتبع العميل نفسه' using errcode = '23514'; end if;
  end if;
  return new;
end $$;

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  device_id uuid not null, customer_id uuid, site_id uuid, visit_id uuid, work_order_id uuid,
  performed_at timestamptz not null default now(),
  action text not null check (action in ('installation', 'inspection', 'test', 'cleaning', 'refill', 'part_replacement', 'repair', 'decommission')),
  result text not null check (result in ('pass', 'pass_with_notes', 'fail')),
  status_after text not null check (status_after in ('operational', 'needs_maintenance', 'under_repair', 'out_of_service', 'expired', 'decommissioned')),
  notes text, next_due_at date,
  device_ref_snapshot text, device_name_snapshot text, catalog_snapshot jsonb,
  created_by uuid, created_at timestamptz not null default now(),
  constraint maintenance_records_id_company_key unique (id, company_id),
  constraint mr_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict,
  constraint mr_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete restrict,
  constraint mr_wo_fk foreign key (work_order_id, company_id) references public.work_orders (id, company_id) on delete restrict
);
create unique index if not exists maintenance_records_company_ref_key on public.maintenance_records (company_id, ref_no);
create index if not exists maintenance_records_device_idx on public.maintenance_records (device_id, performed_at desc);
create index if not exists maintenance_records_customer_idx on public.maintenance_records (customer_id);

create table if not exists public.maintenance_record_technicians (
  record_id uuid not null, technician_id uuid not null, company_id uuid not null,
  primary key (record_id, technician_id),
  constraint mrt_record_fk foreign key (record_id, company_id) references public.maintenance_records (id, company_id) on delete restrict,
  constraint mrt_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete restrict
);

create or replace function app_private.maintenance_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select * into d from public.devices where id = new.device_id;
  new.customer_id := d.customer_id;
  new.site_id := d.site_id;
  new.device_ref_snapshot := d.ref_no;
  new.device_name_snapshot := d.name;
  new.catalog_snapshot := jsonb_build_object('catalog_item_id', d.catalog_item_id, 'system_id', d.system_id,
    'manufacturer', d.manufacturer, 'model', d.model, 'serial_number', d.serial_number);
  if new.next_due_at is null and d.maintenance_interval_days is not null and new.status_after <> 'decommissioned' then
    new.next_due_at := (new.performed_at at time zone 'Asia/Riyadh')::date + d.maintenance_interval_days;
  end if;
  return new;
end $$;

create or replace function app_private.maintenance_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.devices
     set last_maintenance_at = greatest(coalesce(last_maintenance_at, '-infinity'::date), (new.performed_at at time zone 'Asia/Riyadh')::date),
         next_maintenance_at = case when new.status_after = 'decommissioned' then null else new.next_due_at end,
         status = new.status_after
   where id = new.device_id
     and (last_maintenance_at is null or last_maintenance_at <= (new.performed_at at time zone 'Asia/Riyadh')::date);
  return new;
end $$;

create or replace function app_private.block_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'هذا السجل تاريخي ولا يمكن تعديله أو حذفه' using errcode = '42501'; end $$;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entity_type text not null check (entity_type in ('device', 'customer', 'site', 'work_order', 'visit', 'maintenance', 'catalog_item', 'technician')),
  entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null, mime_type text, size_bytes bigint,
  created_by uuid, created_at timestamptz not null default now(),
  archived_at timestamptz, archived_by uuid
);
create index if not exists attachments_entity_idx on public.attachments (entity_type, entity_id);

create or replace function app_private.attachment_module(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type when 'device' then 'devices' when 'customer' then 'customers' when 'site' then 'sites'
    when 'work_order' then 'work_orders' when 'visit' then 'visits' when 'maintenance' then 'maintenance'
    when 'catalog_item' then 'catalog' when 'technician' then 'technicians' end
$$;

-- حارس التعديل: لا نقل لشركة أخرى، والأرشفة والاعتماد صلاحيتان مستقلتان عن التعديل
create or replace function app_private.guard_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_module text := tg_argv[0];
  v_company uuid := (to_jsonb(old) ->> 'company_id')::uuid;
  v_skip text[] := array['archived_at', 'archived_by', 'updated_at', 'approved_at', 'approved_by'];
  v_update_perm text := case when v_module = 'catalog' then 'catalog.manage' else v_module || '.update' end;
begin
  if (to_jsonb(new) ->> 'company_id') is distinct from (to_jsonb(old) ->> 'company_id') then
    raise exception 'لا يمكن نقل السجل إلى شركة أخرى' using errcode = '42501';
  end if;
  if not app_private.is_api_caller() then return new; end if;
  if (to_jsonb(new) ->> 'archived_at') is distinct from (to_jsonb(old) ->> 'archived_at') then
    if not public.company_has_perm(v_company, v_module || '.archive') then
      raise exception 'ليست لديك صلاحية الأرشفة أو الاستعادة' using errcode = '42501';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('archived_by', case when (to_jsonb(new) ->> 'archived_at') is null then null else auth.uid() end));
  end if;
  if (to_jsonb(new) ->> 'approved_at') is distinct from (to_jsonb(old) ->> 'approved_at') then
    if not public.company_has_perm(v_company, v_module || '.approve') then
      raise exception 'ليست لديك صلاحية الاعتماد' using errcode = '42501';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('approved_by', case when (to_jsonb(new) ->> 'approved_at') is null then null else auth.uid() end));
  elsif (to_jsonb(new) ->> 'approved_by') is distinct from (to_jsonb(old) ->> 'approved_by') then
    raise exception 'لا يمكن تعديل بيانات الاعتماد مباشرة' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) and not public.company_has_perm(v_company, v_update_perm) then
    raise exception 'ليست لديك صلاحية التعديل' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5) سجل التدقيق التشغيلي (يُكتب في company_audit_log القائم)
-- ---------------------------------------------------------------------
create or replace function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text; v_changes jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'INSERT' then v_action := 'create';
  elsif tg_op = 'DELETE' then v_action := 'delete'; v_changes := v_old - array['updated_at', 'created_at'];
  else
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
    v_action := case when v_changes ? 'archived_at' then case when (v_new ->> 'archived_at') is null then 'restore' else 'archive' end
                     when v_changes ? 'status' then 'status_change' else 'update' end;
  end if;
  perform public.company_audit((v_row ->> 'company_id')::uuid, v_action, tg_argv[0],
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    jsonb_build_object('ref_no', v_row ->> 'ref_no',
      'name', coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', v_row ->> 'device_name_snapshot'),
      'changes', v_changes));
  return null;
end $$;

create or replace function app_private.audit_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  perform public.company_audit((v ->> 'company_id')::uuid, case when tg_op = 'INSERT' then 'assign' else 'unassign' end,
    tg_argv[0], null, v - array['created_at']);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 6) الإشعارات الداخلية
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text check (link is null or link ~ '^/[A-Za-z0-9/_\-?=&.%]*$'),
  entity_type text, entity_id uuid, dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_user_id) where read_at is null;
create unique index if not exists notifications_dedupe_key on public.notifications (recipient_user_id, dedupe_key) where dedupe_key is not null;

create or replace function app_private.notifications_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app_private.is_api_caller() and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'لا يمكن تعديل محتوى الإشعار' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app_private.notify(p_company uuid, p_user uuid, p_kind text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if p_dedupe is null and p_user = auth.uid() then return; end if;
  insert into public.notifications (company_id, recipient_user_id, kind, title, body, link, entity_type, entity_id, dedupe_key)
  values (p_company, p_user, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe)
  on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;

create or replace function app_private.notify_technician_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_customer text;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select name into v_customer from public.customers where id = new.customer_id;
  perform app_private.notify(new.company_id, v_user, 'assignment', 'تم إسناد عميل إليك', 'العميل: ' || coalesce(v_customer, ''),
    '/customers/' || new.customer_id, 'customer', new.customer_id);
  return null;
end $$;

create or replace function app_private.notify_work_order_technician() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; w record;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select ref_no, title into w from public.work_orders where id = new.work_order_id;
  perform app_private.notify(new.company_id, v_user, 'work_order_assigned', 'تم تعيينك لأمر عمل ' || coalesce(w.ref_no, ''), w.title,
    '/work-orders/' || new.work_order_id, 'work_order', new.work_order_id);
  return null;
end $$;

create or replace function app_private.notify_work_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status is not distinct from old.status then return null; end if;
  for r in select new.created_by as user_id union
           select t.user_id from public.work_order_technicians wt join public.technicians t on t.id = wt.technician_id
           where wt.work_order_id = new.id and t.user_id is not null loop
    perform app_private.notify(new.company_id, r.user_id, 'work_order_status', 'تغيّرت حالة أمر العمل ' || coalesce(new.ref_no, ''),
      new.title, '/work-orders/' || new.id, 'work_order', new.id);
  end loop;
  return null;
end $$;

create or replace function app_private.notify_visit_technician() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v record;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select ref_no, scheduled_start into v from public.visits where id = new.visit_id;
  perform app_private.notify(new.company_id, v_user, 'visit_scheduled', 'زيارة جديدة ' || coalesce(v.ref_no, ''),
    'الموعد: ' || to_char(v.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), '/visits/' || new.visit_id, 'visit', new.visit_id);
  return null;
end $$;

create or replace function app_private.notify_visit_reschedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.scheduled_start is not distinct from old.scheduled_start then return null; end if;
  for r in select t.user_id from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id
           where vt.visit_id = new.id and t.user_id is not null loop
    perform app_private.notify(new.company_id, r.user_id, 'visit_rescheduled', 'تعديل موعد الزيارة ' || coalesce(new.ref_no, ''),
      'الموعد الجديد: ' || to_char(new.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), '/visits/' || new.id, 'visit', new.id);
  end loop;
  return null;
end $$;

-- تنبيهات مواعيد الصيانة (آمنة للتكرار بمفتاح منع التكرار)
create or replace function app_private.run_maintenance_alerts_for(p_company uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare d record; r record; v_days integer; v_today date := (now() at time zone 'Asia/Riyadh')::date; n integer := 0;
begin
  select maintenance_alert_days into v_days from public.companies where id = p_company and status = 'active';
  if v_days is null then return 0; end if;
  for d in select id, ref_no, name, customer_id, next_maintenance_at from public.devices
           where company_id = p_company and archived_at is null and status <> 'decommissioned'
             and next_maintenance_at is not null and next_maintenance_at <= v_today + v_days loop
    for r in select m.user_id from public.company_memberships m
             where m.company_id = p_company and m.status = 'active'
               and 'devices.view' = any (public.company_effective_permissions(m.role, m.permissions))
             union
             select t.user_id from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
             where tc.customer_id = d.customer_id and t.user_id is not null and t.archived_at is null loop
      if d.next_maintenance_at < v_today then
        perform app_private.notify(p_company, r.user_id, 'maintenance_overdue', 'صيانة متأخرة: ' || d.name || ' (' || d.ref_no || ')',
          'كان موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'), '/devices/' || d.id, 'device', d.id,
          'overdue:' || d.id || ':' || d.next_maintenance_at);
      else
        perform app_private.notify(p_company, r.user_id, 'maintenance_due', 'صيانة قادمة: ' || d.name || ' (' || d.ref_no || ')',
          'موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'), '/devices/' || d.id, 'device', d.id,
          'due:' || d.id || ':' || d.next_maintenance_at);
      end if;
      n := n + 1;
    end loop;
  end loop;
  update public.companies set last_alert_run_at = now() where id = p_company;
  return n;
end $$;

create or replace function public.run_maintenance_alerts(p_company uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  if not public.company_is_member(p_company) then return 0; end if;
  select last_alert_run_at into v_last from public.companies where id = p_company;
  if v_last is not null and v_last > now() - interval '1 hour' then return 0; end if;
  return app_private.run_maintenance_alerts_for(p_company);
end $$;

create or replace function app_private.run_all_maintenance_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare o record; n integer := 0;
begin
  for o in select id from public.companies where status = 'active' loop n := n + app_private.run_maintenance_alerts_for(o.id); end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7) الكتالوج الافتراضي (يُضاف مرة لكل شركة عند تفعيلها، قابل للتعديل والأرشفة)
-- ---------------------------------------------------------------------
create or replace function app_private.seed_default_catalog(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.safety_systems where company_id = p_company) then return; end if;
  insert into public.safety_systems (company_id, name, description, default_interval_days, sort_order) values
    (p_company, 'أنظمة الإنذار', 'لوحات الإنذار والكواشف ونقاط الكسر والصافرات', 180, 1),
    (p_company, 'طفايات الحريق', 'الطفايات اليدوية والمتنقلة بأنواعها', 365, 2),
    (p_company, 'أنظمة الرش الآلي', 'الرشاشات والصمامات وشبكات المياه', 180, 3),
    (p_company, 'مضخات الحريق', 'المضخات الرئيسية والاحتياطية ومضخات الجوكي', 90, 4),
    (p_company, 'إنارة الطوارئ', 'وحدات إنارة الطوارئ ولوحات المخارج', 180, 5),
    (p_company, 'أنظمة الإطفاء بالغاز', 'FM-200 وCO2 والغازات النظيفة', 180, 6),
    (p_company, 'الخراطيم وبكرات الحريق', 'بكرات الخراطيم وصناديق الحريق', 365, 7);
end $$;

create or replace function app_private.companies_seed_on_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform app_private.seed_default_catalog(new.id);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 8) سياق المستخدم في طلب واحد + تحويل رمز QR
-- ---------------------------------------------------------------------
create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'unread_notifications', (select count(*) from public.notifications where recipient_user_id = auth.uid() and read_at is null),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'company_id', c.id, 'company_name', c.name, 'company_ref', c.ref_no, 'company_status', c.status,
        'role', m.role, 'status', m.status, 'is_primary', m.is_primary,
        'permissions', to_jsonb(public.company_effective_permissions(m.role, m.permissions)),
        'primary_color', c.primary_color, 'secondary_color', c.secondary_color, 'logo_path', c.logo_path
      ) order by m.created_at)
      from public.company_memberships m join public.companies c on c.id = m.company_id
      where m.user_id = auth.uid() and m.status <> 'removed'), '[]'::jsonb))
$$;

create or replace function public.resolve_device_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d record; v_token text := upper(btrim(p_token));
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthenticated'); end if;
  if v_token !~ '^[A-Z0-9]{8,32}$' then return jsonb_build_object('status', 'invalid'); end if;
  select id, company_id, customer_id, archived_at into d from public.devices where qr_token = v_token;
  if d.id is null then
    if exists (select 1 from app_private.device_tokens where token = v_token) then return jsonb_build_object('status', 'removed'); end if;
    return jsonb_build_object('status', 'not_found');
  end if;
  if not public.company_can_view_customer(d.company_id, d.customer_id, 'devices') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'device_id', d.id, 'organization_id', d.company_id, 'archived', d.archived_at is not null);
end $$;

-- ---------------------------------------------------------------------
-- 9) المشغّلات
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select * from (values
      ('customers', 'CUS', 'customers', 'customer'), ('technicians', 'TEC', 'technicians', 'technician'),
      ('customer_sites', 'SIT', 'sites', 'site'), ('safety_systems', 'SYS', 'catalog', 'safety_system'),
      ('catalog_items', 'CAT', 'catalog', 'catalog_item'), ('devices', 'DEV', 'devices', 'device'),
      ('work_orders', 'WO', 'work_orders', 'work_order'), ('visits', 'VIS', 'visits', 'visit'),
      ('maintenance_records', 'MNT', null, 'maintenance')) as v(tbl, prefix, module, entity)
  loop
    execute format('drop trigger if exists trg_%1$s_ref on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_ref before insert or update on public.%1$I for each row execute function app_private.assign_ref(%2$L)', t.tbl, t.prefix);
    execute format('drop trigger if exists trg_%1$s_created_by on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_created_by before insert on public.%1$I for each row execute function app_private.set_created_by()', t.tbl);
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function app_private.audit_row(%2$L)', t.tbl, t.entity);
    if t.module is not null then
      execute format('drop trigger if exists trg_%1$s_touch on public.%1$I', t.tbl);
      execute format('create trigger trg_%1$s_touch before update on public.%1$I for each row execute function app_private.touch_updated_at()', t.tbl);
      execute format('drop trigger if exists trg_%1$s_guard on public.%1$I', t.tbl);
      execute format('create trigger trg_%1$s_guard before update on public.%1$I for each row execute function app_private.guard_update(%2$L)', t.tbl, t.module);
    end if;
  end loop;
  for t in select * from (values ('technician_customers', 'technician_customer'), ('work_order_technicians', 'work_order_technician'),
      ('visit_technicians', 'visit_technician'), ('work_order_devices', 'work_order_device')) as v(tbl, entity)
  loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_audit after insert or delete on public.%1$I for each row execute function app_private.audit_link(%2$L)', t.tbl, t.entity);
  end loop;
  for t in select * from (values ('attachments'), ('technician_customers'), ('work_order_technicians'), ('visit_technicians')) as v(tbl) loop
    execute format('drop trigger if exists trg_%1$s_created_by on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_created_by before insert on public.%1$I for each row execute function app_private.set_created_by()', t.tbl);
  end loop;
end $$;

drop trigger if exists trg_technicians_user_chk on public.technicians;
create trigger trg_technicians_user_chk before insert or update of user_id on public.technicians for each row execute function app_private.check_technician_user();
drop trigger if exists trg_devices_before_write on public.devices;
create trigger trg_devices_before_write before insert or update on public.devices for each row execute function app_private.devices_before_write();
drop trigger if exists trg_work_orders_links on public.work_orders;
create trigger trg_work_orders_links before insert or update of customer_id, site_id on public.work_orders for each row execute function app_private.check_customer_links();
drop trigger if exists trg_visits_links on public.visits;
create trigger trg_visits_links before insert or update of customer_id, site_id, work_order_id on public.visits for each row execute function app_private.check_customer_links();
drop trigger if exists trg_maintenance_before on public.maintenance_records;
create trigger trg_maintenance_before before insert on public.maintenance_records for each row execute function app_private.maintenance_before_insert();
drop trigger if exists trg_maintenance_after on public.maintenance_records;
create trigger trg_maintenance_after after insert on public.maintenance_records for each row execute function app_private.maintenance_after_insert();
drop trigger if exists trg_maintenance_block on public.maintenance_records;
create trigger trg_maintenance_block before update or delete on public.maintenance_records for each row execute function app_private.block_change();
drop trigger if exists trg_maintenance_tech_block on public.maintenance_record_technicians;
create trigger trg_maintenance_tech_block before update or delete on public.maintenance_record_technicians for each row execute function app_private.block_change();
drop trigger if exists trg_notifications_guard on public.notifications;
create trigger trg_notifications_guard before update on public.notifications for each row execute function app_private.notifications_guard();
drop trigger if exists trg_technician_customers_notify on public.technician_customers;
create trigger trg_technician_customers_notify after insert on public.technician_customers for each row execute function app_private.notify_technician_customer();
drop trigger if exists trg_work_order_technicians_notify on public.work_order_technicians;
create trigger trg_work_order_technicians_notify after insert on public.work_order_technicians for each row execute function app_private.notify_work_order_technician();
drop trigger if exists trg_work_orders_notify_status on public.work_orders;
create trigger trg_work_orders_notify_status after update of status on public.work_orders for each row execute function app_private.notify_work_order_status();
drop trigger if exists trg_visit_technicians_notify on public.visit_technicians;
create trigger trg_visit_technicians_notify after insert on public.visit_technicians for each row execute function app_private.notify_visit_technician();
drop trigger if exists trg_visits_notify_reschedule on public.visits;
create trigger trg_visits_notify_reschedule after update of scheduled_start on public.visits for each row execute function app_private.notify_visit_reschedule();
drop trigger if exists trg_companies_seed_catalog on public.companies;
create trigger trg_companies_seed_catalog after insert or update of status on public.companies for each row execute function app_private.companies_seed_on_active();

-- الكتالوج الافتراضي للشركات النشطة القائمة (مرة واحدة)
do $$ declare o record; begin
  for o in select id from public.companies where status = 'active' loop perform app_private.seed_default_catalog(o.id); end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10) الصلاحيات وRLS
-- ---------------------------------------------------------------------
-- الدوال: الداخلية لا تُستدعى من الواجهة؛ العامة للمسجلين فقط
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_api_caller(), app_private.is_assigned_customer(uuid, uuid),
  app_private.attachment_module(text), app_private.new_device_token() to authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'public.company_effective_permissions(text, text[])', 'public.company_member_row(uuid)', 'public.company_is_member(uuid)',
    'public.company_has_perm(uuid, text)', 'public.company_has_any_perm(uuid, text[])', 'public.company_can_view_customer(uuid, uuid, text)',
    'public.company_set_member_permissions(uuid, text[])', 'public.company_branding_snapshot(uuid)', 'public.company_update_branding(uuid, jsonb)',
    'public.company_restore_branding(uuid)', 'public.run_maintenance_alerts(uuid)', 'public.get_my_context()', 'public.resolve_device_token(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.company_branding_snapshot(uuid) from authenticated;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- الجداول الجديدة: لا شيء لـ anon، والوصول للمسجلين عبر RLS
do $$ declare t text; begin
  foreach t in array array['permission_definitions', 'company_role_permissions', 'company_branding_history', 'customers', 'technicians',
    'customer_sites', 'technician_customers', 'safety_systems', 'catalog_items', 'devices', 'work_orders', 'work_order_technicians',
    'work_order_devices', 'visits', 'visit_technicians', 'maintenance_records', 'maintenance_record_technicians', 'attachments', 'notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);
  end loop;
end $$;
revoke insert, update, delete on public.permission_definitions, public.company_role_permissions, public.company_branding_history from authenticated;
revoke update, delete on public.maintenance_records, public.maintenance_record_technicians from authenticated;
revoke insert, delete on public.notifications from authenticated;

create or replace function app_private.reset_policy(p_table text, p_name text, p_cmd text, p_using text, p_check text)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  if p_cmd = 'INSERT' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', p_name, p_table, p_check);
  elsif p_cmd = 'UPDATE' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', p_name, p_table, p_using, coalesce(p_check, p_using));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)', p_name, p_table, p_cmd, p_using);
  end if;
end $$;

select app_private.reset_policy('permission_definitions', 'ays_perm_defs_select', 'SELECT', 'true', null);
select app_private.reset_policy('company_role_permissions', 'ays_role_perms_select', 'SELECT', 'true', null);
select app_private.reset_policy('company_branding_history', 'ays_branding_history_select', 'SELECT', 'public.company_has_perm(company_id, ''settings.branding'')', null);

-- نمط موحد: عرض / إضافة / تعديل أو أرشفة / حذف لكل وحدة
do $$
declare t record;
begin
  for t in select * from (values
      ('customers', 'customers', 'public.company_can_view_customer(company_id, id, ''customers'')'),
      ('customer_sites', 'sites', 'public.company_can_view_customer(company_id, customer_id, ''sites'')'),
      ('devices', 'devices', 'public.company_can_view_customer(company_id, customer_id, ''devices'')')
    ) as v(tbl, module, sel)
  loop
    perform app_private.reset_policy(t.tbl, 'ays_' || t.tbl || '_select', 'SELECT', t.sel, null);
    perform app_private.reset_policy(t.tbl, 'ays_' || t.tbl || '_insert', 'INSERT', null, format('public.company_has_perm(company_id, %L)', t.module || '.create'));
    perform app_private.reset_policy(t.tbl, 'ays_' || t.tbl || '_update', 'UPDATE', format('public.company_has_any_perm(company_id, array[%L, %L])', t.module || '.update', t.module || '.archive'), null);
    perform app_private.reset_policy(t.tbl, 'ays_' || t.tbl || '_delete', 'DELETE', format('public.company_has_perm(company_id, %L)', t.module || '.delete'), null);
  end loop;
end $$;

select app_private.reset_policy('technicians', 'ays_technicians_select', 'SELECT',
  'public.company_has_any_perm(company_id, array[''technicians.view'', ''assignments.manage'', ''work_orders.assign'', ''visits.create'', ''visits.update'', ''maintenance.create'']) or (user_id = (select auth.uid()) and public.company_is_member(company_id))', null);
select app_private.reset_policy('technicians', 'ays_technicians_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''technicians.create'')');
select app_private.reset_policy('technicians', 'ays_technicians_update', 'UPDATE', 'public.company_has_any_perm(company_id, array[''technicians.update'', ''technicians.archive''])', null);
select app_private.reset_policy('technicians', 'ays_technicians_delete', 'DELETE', 'public.company_has_perm(company_id, ''technicians.delete'')', null);

select app_private.reset_policy('technician_customers', 'ays_tc_select', 'SELECT',
  'public.company_has_any_perm(company_id, array[''assignments.manage'', ''customers.view'', ''technicians.view'']) or app_private.is_assigned_customer(company_id, customer_id)', null);
select app_private.reset_policy('technician_customers', 'ays_tc_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''assignments.manage'')');
select app_private.reset_policy('technician_customers', 'ays_tc_update', 'UPDATE', 'public.company_has_perm(company_id, ''assignments.manage'')', null);
select app_private.reset_policy('technician_customers', 'ays_tc_delete', 'DELETE', 'public.company_has_perm(company_id, ''assignments.manage'')', null);

do $$ declare t text; begin
  foreach t in array array['safety_systems', 'catalog_items'] loop
    perform app_private.reset_policy(t, 'ays_' || t || '_select', 'SELECT', 'public.company_has_any_perm(company_id, array[''catalog.view'', ''catalog.manage'', ''devices.create'', ''devices.update''])', null);
    perform app_private.reset_policy(t, 'ays_' || t || '_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''catalog.manage'')');
    perform app_private.reset_policy(t, 'ays_' || t || '_update', 'UPDATE', 'public.company_has_any_perm(company_id, array[''catalog.manage'', ''catalog.archive''])', null);
    perform app_private.reset_policy(t, 'ays_' || t || '_delete', 'DELETE', 'public.company_has_perm(company_id, ''catalog.delete'')', null);
  end loop;
end $$;

create or replace function app_private.is_assigned_work_order(p_wo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_order_technicians wt join public.technicians t on t.id = wt.technician_id
                 where wt.work_order_id = p_wo and t.user_id = auth.uid())
$$;
create or replace function app_private.is_assigned_visit(p_visit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id
                 where vt.visit_id = p_visit and t.user_id = auth.uid())
$$;
revoke all on function app_private.is_assigned_work_order(uuid), app_private.is_assigned_visit(uuid) from public, anon;
grant execute on function app_private.is_assigned_work_order(uuid), app_private.is_assigned_visit(uuid) to authenticated;

select app_private.reset_policy('work_orders', 'ays_wo_select', 'SELECT',
  'public.company_can_view_customer(company_id, customer_id, ''work_orders'') or (public.company_is_member(company_id) and app_private.is_assigned_work_order(id))', null);
select app_private.reset_policy('work_orders', 'ays_wo_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''work_orders.create'')');
select app_private.reset_policy('work_orders', 'ays_wo_update', 'UPDATE', 'public.company_has_any_perm(company_id, array[''work_orders.update'', ''work_orders.archive'', ''work_orders.approve''])', null);
select app_private.reset_policy('work_orders', 'ays_wo_delete', 'DELETE', 'public.company_has_perm(company_id, ''work_orders.delete'')', null);
select app_private.reset_policy('work_order_technicians', 'ays_wot_select', 'SELECT', 'exists (select 1 from public.work_orders w where w.id = work_order_technicians.work_order_id)', null);
select app_private.reset_policy('work_order_technicians', 'ays_wot_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''work_orders.assign'')');
select app_private.reset_policy('work_order_technicians', 'ays_wot_delete', 'DELETE', 'public.company_has_perm(company_id, ''work_orders.assign'')', null);
select app_private.reset_policy('work_order_devices', 'ays_wod_select', 'SELECT', 'exists (select 1 from public.work_orders w where w.id = work_order_devices.work_order_id)', null);
select app_private.reset_policy('work_order_devices', 'ays_wod_insert', 'INSERT', null, 'public.company_has_any_perm(company_id, array[''work_orders.create'', ''work_orders.update''])');
select app_private.reset_policy('work_order_devices', 'ays_wod_delete', 'DELETE', 'public.company_has_perm(company_id, ''work_orders.update'')', null);

select app_private.reset_policy('visits', 'ays_visits_select', 'SELECT',
  'public.company_can_view_customer(company_id, customer_id, ''visits'') or (public.company_is_member(company_id) and app_private.is_assigned_visit(id))', null);
select app_private.reset_policy('visits', 'ays_visits_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''visits.create'')');
select app_private.reset_policy('visits', 'ays_visits_update', 'UPDATE', 'public.company_has_any_perm(company_id, array[''visits.update'', ''visits.archive''])', null);
select app_private.reset_policy('visits', 'ays_visits_delete', 'DELETE', 'public.company_has_perm(company_id, ''visits.delete'')', null);
select app_private.reset_policy('visit_technicians', 'ays_vt_select', 'SELECT', 'exists (select 1 from public.visits v where v.id = visit_technicians.visit_id)', null);
select app_private.reset_policy('visit_technicians', 'ays_vt_insert', 'INSERT', null, 'public.company_has_any_perm(company_id, array[''visits.create'', ''visits.update''])');
select app_private.reset_policy('visit_technicians', 'ays_vt_delete', 'DELETE', 'public.company_has_perm(company_id, ''visits.update'')', null);

select app_private.reset_policy('maintenance_records', 'ays_mr_select', 'SELECT', 'public.company_can_view_customer(company_id, customer_id, ''maintenance'')', null);
select app_private.reset_policy('maintenance_records', 'ays_mr_insert', 'INSERT', null,
  'public.company_has_perm(company_id, ''maintenance.create'') and exists (select 1 from public.devices d where d.id = maintenance_records.device_id)');
select app_private.reset_policy('maintenance_record_technicians', 'ays_mrt_select', 'SELECT', 'exists (select 1 from public.maintenance_records r where r.id = maintenance_record_technicians.record_id)', null);
select app_private.reset_policy('maintenance_record_technicians', 'ays_mrt_insert', 'INSERT', null, 'public.company_has_perm(company_id, ''maintenance.create'')');

select app_private.reset_policy('attachments', 'ays_attachments_select', 'SELECT',
  'public.company_has_any_perm(company_id, array[app_private.attachment_module(entity_type) || ''.view'', ''field.assigned''])', null);
select app_private.reset_policy('attachments', 'ays_attachments_insert', 'INSERT', null,
  'public.company_has_any_perm(company_id, array[app_private.attachment_module(entity_type) || ''.update'', app_private.attachment_module(entity_type) || ''.create'', ''catalog.manage''])');
select app_private.reset_policy('attachments', 'ays_attachments_update', 'UPDATE', 'public.company_has_perm(company_id, app_private.attachment_module(entity_type) || ''.archive'')', null);
select app_private.reset_policy('attachments', 'ays_attachments_delete', 'DELETE', 'public.company_has_perm(company_id, app_private.attachment_module(entity_type) || ''.delete'')', null);

select app_private.reset_policy('notifications', 'ays_notifications_select', 'SELECT', 'recipient_user_id = (select auth.uid())', null);
select app_private.reset_policy('notifications', 'ays_notifications_update', 'UPDATE', 'recipient_user_id = (select auth.uid())', null);

drop function app_private.reset_policy(text, text, text, text, text);

-- ---------------------------------------------------------------------
-- 11) التخزين: حاويتان خاصتان، والمسار يبدأ بمعرّف الشركة
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-branding', 'org-branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-files', 'org-files', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function app_private.storage_company(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return split_part(p_name, '/', 1)::uuid; exception when others then return null; end $$;
grant execute on function app_private.storage_company(text) to authenticated;

drop policy if exists ays_branding_read on storage.objects;
create policy ays_branding_read on storage.objects for select to authenticated
  using (bucket_id = 'org-branding' and (public.company_is_member(app_private.storage_company(name)) or public.is_platform_admin()));
drop policy if exists ays_branding_write on storage.objects;
create policy ays_branding_write on storage.objects for insert to authenticated
  with check (bucket_id = 'org-branding' and public.company_has_perm(app_private.storage_company(name), 'settings.branding'));
drop policy if exists ays_branding_delete on storage.objects;
create policy ays_branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-branding' and public.company_has_perm(app_private.storage_company(name), 'settings.branding'));
drop policy if exists ays_files_read on storage.objects;
create policy ays_files_read on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and exists (select 1 from public.attachments a where a.storage_path = name));
drop policy if exists ays_files_write on storage.objects;
create policy ays_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'org-files' and public.company_has_any_perm(app_private.storage_company(name),
    array['devices.update', 'devices.create', 'customers.update', 'sites.update', 'work_orders.update', 'visits.update',
          'maintenance.create', 'catalog.manage', 'technicians.update']));

-- ---------------------------------------------------------------------
-- 12) عروض التقارير (تخضع لـ RLS المستخدم)
-- ---------------------------------------------------------------------
create or replace view public.report_devices_by_system with (security_invoker = on) as
select d.company_id, d.system_id, coalesce(s.name, 'غير مصنف') as system_name, d.status,
       count(*)::int as device_count,
       count(*) filter (where d.next_maintenance_at < (now() at time zone 'Asia/Riyadh')::date)::int as overdue_count
from public.devices d left join public.safety_systems s on s.id = d.system_id
where d.archived_at is null
group by d.company_id, d.system_id, s.name, d.status;

create or replace view public.report_customer_summary with (security_invoker = on) as
select c.company_id, c.id as customer_id, c.ref_no, c.name, c.city, c.customer_type, c.is_active, c.archived_at,
  (select count(*) from public.customer_sites s where s.customer_id = c.id and s.archived_at is null)::int as site_count,
  (select count(*) from public.devices d where d.customer_id = c.id and d.archived_at is null)::int as device_count,
  (select count(*) from public.devices d where d.customer_id = c.id and d.archived_at is null
     and d.next_maintenance_at < (now() at time zone 'Asia/Riyadh')::date)::int as overdue_count,
  (select count(*) from public.technician_customers tc where tc.customer_id = c.id)::int as technician_count
from public.customers c;

revoke all on public.report_devices_by_system, public.report_customer_summary from anon, authenticated;
grant select on public.report_devices_by_system, public.report_customer_summary to authenticated;

-- ---------------------------------------------------------------------
-- 13) سحب نهائي لصلاحيات دوال app_private (Supabase يمنح التنفيذ افتراضيًا لكل دالة جديدة)
--     ثم منح المسجلين فقط ما تحتاجه السياسات والمشغّلات وقيم الأعمدة الافتراضية
-- ---------------------------------------------------------------------
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_api_caller(), app_private.is_assigned_customer(uuid, uuid), app_private.attachment_module(text),
  app_private.new_device_token(), app_private.is_assigned_work_order(uuid), app_private.is_assigned_visit(uuid),
  app_private.storage_company(text) to authenticated;

notify pgrst, 'reload schema';
