-- =====================================================================
-- عين السلامة — الترحيل 2: الوحدات التشغيلية
-- العملاء، الفنيون، المواقع، الإسناد، كتالوج أجهزة السلامة، الأجهزة، أوامر العمل،
-- الزيارات، سجلات الصيانة، المرفقات.
-- العلاقات بين السجلات تستخدم مفاتيح مركبة (id, organization_id) لضمان أن الطرفين
-- تابعان للشركة نفسها. الحذف المتسلسل يُستخدم فقط لجداول الربط.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) العملاء (جدول قائم: إضافة أعمدة فقط)
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists ref_no text,
  add column if not exists customer_type text not null default 'company',
  add column if not exists contact_name text,
  add column if not exists vat_number text,
  add column if not exists address text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customers_type_chk') then
    alter table public.customers add constraint customers_type_chk
      check (customer_type in ('company', 'government', 'individual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_id_org_key') then
    alter table public.customers add constraint customers_id_org_key unique (id, organization_id);
  end if;
end $$;

do $$
declare r record;
begin
  for r in select id, organization_id from public.customers where ref_no is null order by created_at, id loop
    update public.customers set ref_no = app_private.next_ref('customers', r.organization_id, 'CUS') where id = r.id;
  end loop;
end $$;
create unique index if not exists customers_org_ref_key on public.customers (organization_id, ref_no);
create index if not exists customers_org_name_idx on public.customers (organization_id, name);

-- ---------------------------------------------------------------------
-- 2) الفنيون (جدول قائم: إضافة أعمدة فقط)
-- ---------------------------------------------------------------------
alter table public.technicians
  add column if not exists ref_no text,
  add column if not exists email text,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists job_title text,
  add column if not exists specialties text[] not null default '{}',
  add column if not exists availability text not null default 'available',
  add column if not exists hire_date date,
  add column if not exists notes text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'technicians_availability_chk') then
    alter table public.technicians add constraint technicians_availability_chk
      check (availability in ('available', 'busy', 'on_leave'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'technicians_id_org_key') then
    alter table public.technicians add constraint technicians_id_org_key unique (id, organization_id);
  end if;
end $$;

do $$
declare r record;
begin
  for r in select id, organization_id from public.technicians where ref_no is null order by created_at, id loop
    update public.technicians set ref_no = app_private.next_ref('technicians', r.organization_id, 'TEC') where id = r.id;
  end loop;
end $$;
create unique index if not exists technicians_org_ref_key on public.technicians (organization_id, ref_no);
create unique index if not exists technicians_org_user_key on public.technicians (organization_id, user_id) where user_id is not null;

-- ربط حساب الفني يجب أن يكون لعضو في الشركة نفسها
create or replace function app_private.check_technician_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.user_id
  ) then
    raise exception 'الحساب المرتبط بالفني ليس عضوًا في الشركة' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) مواقع العملاء وفروعهم
-- ---------------------------------------------------------------------
create table if not exists public.customer_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null,
  ref_no text,
  name text not null check (length(btrim(name)) between 1 and 200),
  city text,
  district text,
  address text,
  contact_name text,
  contact_phone text,
  notes text,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_sites_id_org_key unique (id, organization_id),
  constraint customer_sites_customer_fk foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete restrict
);
create unique index if not exists customer_sites_org_ref_key on public.customer_sites (organization_id, ref_no);
create index if not exists customer_sites_customer_idx on public.customer_sites (customer_id);

-- ---------------------------------------------------------------------
-- 4) إسناد الفنيين ↔ العملاء (متعدد إلى متعدد)
-- ---------------------------------------------------------------------
create table if not exists public.technician_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  technician_id uuid not null,
  customer_id uuid not null,
  is_primary boolean not null default false,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint technician_customers_unique unique (technician_id, customer_id),
  constraint technician_customers_tech_fk foreign key (technician_id, organization_id)
    references public.technicians (id, organization_id) on delete cascade,
  constraint technician_customers_customer_fk foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete cascade
);
create index if not exists technician_customers_customer_idx on public.technician_customers (customer_id);

-- هل العميل مسند لفني مرتبط بالمستخدم الحالي؟
create or replace function app_private.is_assigned_customer(p_org uuid, p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.technician_customers tc
    join public.technicians t on t.id = tc.technician_id
    where tc.organization_id = p_org and tc.customer_id = p_customer
      and t.user_id = auth.uid() and t.archived_at is null
  )
$$;

-- عرض بيانات عميل ضمن وحدة: صلاحية العرض الكاملة، أو صلاحية «المسندين فقط» مع وجود إسناد.
create or replace function public.can_view_customer_data(p_org uuid, p_customer uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_perm(p_org, p_module || '.view')
      or (public.has_perm(p_org, 'field.assigned') and app_private.is_assigned_customer(p_org, p_customer))
$$;
revoke all on function public.can_view_customer_data(uuid, uuid, text) from public, anon;
grant execute on function public.can_view_customer_data(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) كتالوج أجهزة السلامة: الأنظمة ثم تعريفات الأجهزة والموديلات
-- ---------------------------------------------------------------------
create table if not exists public.safety_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ref_no text,
  name text not null check (length(btrim(name)) between 1 and 150),
  description text,
  default_interval_days integer check (default_interval_days between 1 and 3650),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_systems_id_org_key unique (id, organization_id)
);
create unique index if not exists safety_systems_org_ref_key on public.safety_systems (organization_id, ref_no);
create unique index if not exists safety_systems_org_name_key on public.safety_systems (organization_id, lower(name));

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  system_id uuid not null,
  ref_no text,
  name text not null check (length(btrim(name)) between 1 and 200),
  manufacturer text,
  model text,
  device_type text,
  description text,
  specs jsonb not null default '{}'::jsonb,
  image_path text,
  default_interval_days integer check (default_interval_days between 1 and 3650),
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_items_id_org_key unique (id, organization_id),
  constraint catalog_items_system_fk foreign key (system_id, organization_id)
    references public.safety_systems (id, organization_id) on delete restrict
);
create unique index if not exists catalog_items_org_ref_key on public.catalog_items (organization_id, ref_no);
create index if not exists catalog_items_system_idx on public.catalog_items (system_id);

-- ---------------------------------------------------------------------
-- 6) الأجهزة الفعلية لدى العملاء + رموز QR الفريدة غير القابلة لإعادة الاستخدام
-- ---------------------------------------------------------------------

-- سجل دائم لكل رمز صدر؛ لا يُحذف حتى لو حُذف الجهاز، فلا يتكرر الرمز أبدًا.
create table if not exists app_private.device_tokens (
  token text primary key,
  device_id uuid not null,
  organization_id uuid not null,
  issued_at timestamptz not null default now()
);

-- 12 حرفًا من أبجدية خالية من الأحرف الملتبسة (60 بت عشوائية)
create or replace function app_private.new_device_token()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  t text;
  i integer;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    t := '';
    for i in 0..11 loop
      t := t || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from app_private.device_tokens where token = t);
  end loop;
  return t;
end $$;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ref_no text,
  qr_token text not null default app_private.new_device_token(),
  customer_id uuid not null,
  site_id uuid,
  system_id uuid,
  catalog_item_id uuid,
  name text not null check (length(btrim(name)) between 1 and 200),
  manufacturer text,
  model text,
  device_type text,
  serial_number text,
  location_detail text,
  capacity text,
  installed_at date,
  expires_at date,
  status text not null default 'operational'
    check (status in ('operational', 'needs_maintenance', 'under_repair', 'out_of_service', 'expired', 'decommissioned')),
  maintenance_interval_days integer check (maintenance_interval_days between 1 and 3650),
  last_maintenance_at date,
  next_maintenance_at date,
  notes text,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_id_org_key unique (id, organization_id),
  constraint devices_qr_token_key unique (qr_token),
  constraint devices_customer_fk foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete restrict,
  constraint devices_site_fk foreign key (site_id, organization_id)
    references public.customer_sites (id, organization_id) on delete restrict,
  constraint devices_system_fk foreign key (system_id, organization_id)
    references public.safety_systems (id, organization_id) on delete restrict,
  constraint devices_catalog_fk foreign key (catalog_item_id, organization_id)
    references public.catalog_items (id, organization_id) on delete restrict
);
create unique index if not exists devices_org_ref_key on public.devices (organization_id, ref_no);
create index if not exists devices_customer_idx on public.devices (customer_id);
create index if not exists devices_site_idx on public.devices (site_id);
create index if not exists devices_next_due_idx on public.devices (organization_id, next_maintenance_at) where archived_at is null;
create unique index if not exists devices_serial_key on public.devices
  (organization_id, lower(coalesce(manufacturer, '')), lower(serial_number))
  where serial_number is not null and archived_at is null;

-- تسجيل الرمز، ومنع تغييره، وتعبئة بيانات الجهاز من الكتالوج عند الإنشاء فقط (لقطة ثابتة)
create or replace function app_private.devices_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c record;
  s_customer uuid;
begin
  if tg_op = 'UPDATE' and new.qr_token is distinct from old.qr_token then
    raise exception 'لا يمكن تغيير رمز الجهاز' using errcode = 'P0001';
  end if;

  if new.site_id is not null then
    select customer_id into s_customer from public.customer_sites where id = new.site_id;
    if s_customer is distinct from new.customer_id then
      raise exception 'الموقع المحدد لا يتبع العميل نفسه' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.catalog_item_id is not null then
      select * into c from public.catalog_items where id = new.catalog_item_id;
      new.system_id := coalesce(new.system_id, c.system_id);
      if new.system_id is distinct from c.system_id then
        raise exception 'تعريف الجهاز لا يتبع النظام المحدد' using errcode = '23514';
      end if;
      new.name := coalesce(nullif(btrim(new.name), ''), c.name);
      new.manufacturer := coalesce(nullif(btrim(new.manufacturer), ''), c.manufacturer);
      new.model := coalesce(nullif(btrim(new.model), ''), c.model);
      new.device_type := coalesce(nullif(btrim(new.device_type), ''), c.device_type);
      new.maintenance_interval_days := coalesce(new.maintenance_interval_days, c.default_interval_days);
    end if;
    if new.maintenance_interval_days is null and new.system_id is not null then
      select default_interval_days into new.maintenance_interval_days
      from public.safety_systems where id = new.system_id;
    end if;
    if new.next_maintenance_at is null and new.maintenance_interval_days is not null then
      new.next_maintenance_at := coalesce(new.last_maintenance_at, new.installed_at, current_date)
                                 + new.maintenance_interval_days;
    end if;
    insert into app_private.device_tokens (token, device_id, organization_id)
    values (new.qr_token, new.id, new.organization_id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7) أوامر العمل
-- ---------------------------------------------------------------------
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ref_no text,
  customer_id uuid not null,
  site_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text,
  order_type text not null default 'preventive'
    check (order_type in ('preventive', 'corrective', 'inspection', 'installation', 'emergency')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'new'
    check (status in ('new', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_id_org_key unique (id, organization_id),
  constraint work_orders_customer_fk foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete restrict,
  constraint work_orders_site_fk foreign key (site_id, organization_id)
    references public.customer_sites (id, organization_id) on delete restrict
);
create unique index if not exists work_orders_org_ref_key on public.work_orders (organization_id, ref_no);
create index if not exists work_orders_customer_idx on public.work_orders (customer_id);
create index if not exists work_orders_status_idx on public.work_orders (organization_id, status);

create table if not exists public.work_order_technicians (
  work_order_id uuid not null,
  technician_id uuid not null,
  organization_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (work_order_id, technician_id),
  constraint wot_wo_fk foreign key (work_order_id, organization_id)
    references public.work_orders (id, organization_id) on delete cascade,
  constraint wot_tech_fk foreign key (technician_id, organization_id)
    references public.technicians (id, organization_id) on delete restrict
);
create index if not exists work_order_technicians_tech_idx on public.work_order_technicians (technician_id);

create table if not exists public.work_order_devices (
  work_order_id uuid not null,
  device_id uuid not null,
  organization_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (work_order_id, device_id),
  constraint wod_wo_fk foreign key (work_order_id, organization_id)
    references public.work_orders (id, organization_id) on delete cascade,
  constraint wod_device_fk foreign key (device_id, organization_id)
    references public.devices (id, organization_id) on delete restrict
);

-- ---------------------------------------------------------------------
-- 8) الزيارات
-- ---------------------------------------------------------------------
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ref_no text,
  customer_id uuid not null,
  site_id uuid,
  work_order_id uuid,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'missed')),
  actual_start timestamptz,
  actual_end timestamptz,
  summary text,
  notes text,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_id_org_key unique (id, organization_id),
  constraint visits_time_chk check (scheduled_end is null or scheduled_end >= scheduled_start),
  constraint visits_customer_fk foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete restrict,
  constraint visits_site_fk foreign key (site_id, organization_id)
    references public.customer_sites (id, organization_id) on delete restrict,
  constraint visits_wo_fk foreign key (work_order_id, organization_id)
    references public.work_orders (id, organization_id) on delete restrict
);
create unique index if not exists visits_org_ref_key on public.visits (organization_id, ref_no);
create index if not exists visits_customer_idx on public.visits (customer_id);
create index if not exists visits_schedule_idx on public.visits (organization_id, scheduled_start);

create table if not exists public.visit_technicians (
  visit_id uuid not null,
  technician_id uuid not null,
  organization_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (visit_id, technician_id),
  constraint vt_visit_fk foreign key (visit_id, organization_id)
    references public.visits (id, organization_id) on delete cascade,
  constraint vt_tech_fk foreign key (technician_id, organization_id)
    references public.technicians (id, organization_id) on delete restrict
);
create index if not exists visit_technicians_tech_idx on public.visit_technicians (technician_id);

-- التحقق من أن الموقع/أمر العمل يتبعان العميل نفسه
create or replace function app_private.check_customer_links()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if new.site_id is not null then
    select customer_id into v from public.customer_sites where id = new.site_id;
    if v is distinct from new.customer_id then
      raise exception 'الموقع المحدد لا يتبع العميل نفسه' using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'visits' and (to_jsonb(new) ->> 'work_order_id') is not null then
    select customer_id into v from public.work_orders where id = (to_jsonb(new) ->> 'work_order_id')::uuid;
    if v is distinct from new.customer_id then
      raise exception 'أمر العمل المحدد لا يتبع العميل نفسه' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 9) سجلات الصيانة (إضافة فقط؛ لا تعديل ولا حذف)
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ref_no text,
  device_id uuid not null,
  customer_id uuid,
  site_id uuid,
  visit_id uuid,
  work_order_id uuid,
  performed_at timestamptz not null default now(),
  action text not null
    check (action in ('installation', 'inspection', 'test', 'cleaning', 'refill', 'part_replacement', 'repair', 'decommission')),
  result text not null check (result in ('pass', 'pass_with_notes', 'fail')),
  status_after text not null
    check (status_after in ('operational', 'needs_maintenance', 'under_repair', 'out_of_service', 'expired', 'decommissioned')),
  notes text,
  next_due_at date,
  device_ref_snapshot text,
  device_name_snapshot text,
  catalog_snapshot jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint maintenance_records_id_org_key unique (id, organization_id),
  constraint mr_device_fk foreign key (device_id, organization_id)
    references public.devices (id, organization_id) on delete restrict,
  constraint mr_visit_fk foreign key (visit_id, organization_id)
    references public.visits (id, organization_id) on delete restrict,
  constraint mr_wo_fk foreign key (work_order_id, organization_id)
    references public.work_orders (id, organization_id) on delete restrict
);
create unique index if not exists maintenance_records_org_ref_key on public.maintenance_records (organization_id, ref_no);
create index if not exists maintenance_records_device_idx on public.maintenance_records (device_id, performed_at desc);
create index if not exists maintenance_records_customer_idx on public.maintenance_records (customer_id);

create table if not exists public.maintenance_record_technicians (
  record_id uuid not null,
  technician_id uuid not null,
  organization_id uuid not null,
  primary key (record_id, technician_id),
  constraint mrt_record_fk foreign key (record_id, organization_id)
    references public.maintenance_records (id, organization_id) on delete restrict,
  constraint mrt_tech_fk foreign key (technician_id, organization_id)
    references public.technicians (id, organization_id) on delete restrict
);

-- لقطة الجهاز وتحديث حالته ومواعيده بعد كل عملية صيانة
create or replace function app_private.maintenance_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select * into d from public.devices where id = new.device_id;
  new.customer_id := d.customer_id;
  new.site_id := d.site_id;
  new.device_ref_snapshot := d.ref_no;
  new.device_name_snapshot := d.name;
  new.catalog_snapshot := jsonb_build_object(
    'catalog_item_id', d.catalog_item_id, 'system_id', d.system_id,
    'manufacturer', d.manufacturer, 'model', d.model, 'serial_number', d.serial_number);
  if new.next_due_at is null and d.maintenance_interval_days is not null and new.status_after <> 'decommissioned' then
    new.next_due_at := (new.performed_at at time zone 'Asia/Riyadh')::date + d.maintenance_interval_days;
  end if;
  return new;
end $$;

create or replace function app_private.maintenance_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.devices
     set last_maintenance_at = greatest(coalesce(last_maintenance_at, '-infinity'::date),
                                        (new.performed_at at time zone 'Asia/Riyadh')::date),
         next_maintenance_at = case when new.status_after = 'decommissioned' then null else new.next_due_at end,
         status = new.status_after
   where id = new.device_id
     and (last_maintenance_at is null or last_maintenance_at <= (new.performed_at at time zone 'Asia/Riyadh')::date);
  return new;
end $$;

create or replace function app_private.block_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'هذا السجل تاريخي ولا يمكن تعديله أو حذفه' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------
-- 10) المرفقات (ملفات في حاوية خاصة org-files/<org_id>/...)
-- ---------------------------------------------------------------------
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  entity_type text not null check (entity_type in ('device', 'customer', 'site', 'work_order', 'visit', 'maintenance', 'catalog_item', 'technician')),
  entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid
);
create index if not exists attachments_entity_idx on public.attachments (entity_type, entity_id);

create or replace function app_private.attachment_module(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'device' then 'devices' when 'customer' then 'customers' when 'site' then 'sites'
    when 'work_order' then 'work_orders' when 'visit' then 'visits' when 'maintenance' then 'maintenance'
    when 'catalog_item' then 'catalog' when 'technician' then 'technicians' end
$$;

-- ---------------------------------------------------------------------
-- 11) المشغّلات (Triggers)
-- ---------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select * from (values
      ('customers', 'CUS', 'customers'),
      ('technicians', 'TEC', 'technicians'),
      ('customer_sites', 'SIT', 'sites'),
      ('safety_systems', 'SYS', 'catalog'),
      ('catalog_items', 'CAT', 'catalog'),
      ('devices', 'DEV', 'devices'),
      ('work_orders', 'WO', 'work_orders'),
      ('visits', 'VIS', 'visits'),
      ('maintenance_records', 'MNT', null)
    ) as v(tbl, prefix, module)
  loop
    execute format('drop trigger if exists trg_%1$s_ref on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_ref before insert or update on public.%1$I
                    for each row execute function app_private.assign_ref(%2$L)', t.tbl, t.prefix);
    execute format('drop trigger if exists trg_%1$s_created_by on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_created_by before insert on public.%1$I
                    for each row execute function app_private.set_created_by()', t.tbl);
    if t.module is not null then
      execute format('drop trigger if exists trg_%1$s_touch on public.%1$I', t.tbl);
      execute format('create trigger trg_%1$s_touch before update on public.%1$I
                      for each row execute function app_private.touch_updated_at()', t.tbl);
      execute format('drop trigger if exists trg_%1$s_guard on public.%1$I', t.tbl);
      execute format('create trigger trg_%1$s_guard before update on public.%1$I
                      for each row execute function app_private.guard_update(%2$L)', t.tbl, t.module);
    end if;
  end loop;
end $$;

-- المرفقات وجداول الربط: تعيين المنشئ
drop trigger if exists trg_attachments_created_by on public.attachments;
create trigger trg_attachments_created_by before insert on public.attachments
  for each row execute function app_private.set_created_by();
drop trigger if exists trg_technician_customers_created_by on public.technician_customers;
create trigger trg_technician_customers_created_by before insert on public.technician_customers
  for each row execute function app_private.set_created_by();
drop trigger if exists trg_work_order_technicians_created_by on public.work_order_technicians;
create trigger trg_work_order_technicians_created_by before insert on public.work_order_technicians
  for each row execute function app_private.set_created_by();
drop trigger if exists trg_visit_technicians_created_by on public.visit_technicians;
create trigger trg_visit_technicians_created_by before insert on public.visit_technicians
  for each row execute function app_private.set_created_by();

drop trigger if exists trg_technicians_user_chk on public.technicians;
create trigger trg_technicians_user_chk before insert or update of user_id on public.technicians
  for each row execute function app_private.check_technician_user();

drop trigger if exists trg_devices_before_write on public.devices;
create trigger trg_devices_before_write before insert or update on public.devices
  for each row execute function app_private.devices_before_write();

drop trigger if exists trg_work_orders_links on public.work_orders;
create trigger trg_work_orders_links before insert or update of customer_id, site_id on public.work_orders
  for each row execute function app_private.check_customer_links();
drop trigger if exists trg_visits_links on public.visits;
create trigger trg_visits_links before insert or update of customer_id, site_id, work_order_id on public.visits
  for each row execute function app_private.check_customer_links();

drop trigger if exists trg_maintenance_before on public.maintenance_records;
create trigger trg_maintenance_before before insert on public.maintenance_records
  for each row execute function app_private.maintenance_before_insert();
drop trigger if exists trg_maintenance_after on public.maintenance_records;
create trigger trg_maintenance_after after insert on public.maintenance_records
  for each row execute function app_private.maintenance_after_insert();
drop trigger if exists trg_maintenance_block on public.maintenance_records;
create trigger trg_maintenance_block before update or delete on public.maintenance_records
  for each row execute function app_private.block_change();
drop trigger if exists trg_maintenance_tech_block on public.maintenance_record_technicians;
create trigger trg_maintenance_tech_block before update or delete on public.maintenance_record_technicians
  for each row execute function app_private.block_change();
