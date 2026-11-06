-- =====================================================================
-- عين السلامة — م5: سجل الزيارة والجهاز، الصور، البلاغات والأعطال، والتصحيح الموثق (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) الزيارة: نوعها (دورية/طارئة/إصلاح/إعادة فحص/تركيب/أخرى)، نتيجتها، التوصيات، وحالة المتابعة.
--    الأجهزة المفحوصة فعليًا = سجلات الصيانة المرتبطة بالزيارة (كما هو قائم)، ويُضاف لكل سجل: حالة الجهاز عند الفحص،
--    القراءات (jsonb)، الإجراءات المنفذة، والتوصيات. سجل الصيانة يبقى غير قابل للتعديل.
-- 2) التصحيح الموثق: maintenance_corrections (الحقل، القيمة السابقة والجديدة، السبب، المنفّذ) بصلاحية maintenance.correct؛
--    السجل الأصلي لا يتغير ويُعرض مع تصحيحاته.
-- 3) الصور: attachments.photo_stage (قبل/بعد/عامة) وattachments.device_id لربط صورة الزيارة بالجهاز. لا تُستبدل صورة سابقة.
-- 4) البلاغات والأعطال device_faults: بلاغ لجهاز ← أمر عمل مستقل اختياري ← إصلاح ← تحقق لاحق؛ لا يغيّر مواعيد الصيانة
--    الدورية لأي جهاز، ولا يغيّر حالة الجهاز إلا باختيار صريح. صلاحيات: faults.view/create/update.
-- 5) حالات الجهاز: إضافة «معطل» (faulty) و«مستبدل» (replaced) مع devices.replaced_by_device_id؛ المؤرشف = archived_at.
--
-- لا يحذف ولا يعدّل أي صف قائم (إلا إضافة أعمدة). لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) الصلاحيات الجديدة
-- ---------------------------------------------------------------------
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('faults.view', 'faults', 'عرض جميع البلاغات والأعطال', 230),
  ('faults.create', 'faults', 'تسجيل بلاغ عطل', 231),
  ('faults.update', 'faults', 'إدارة البلاغات وإغلاقها', 232),
  ('maintenance.correct', 'maintenance', 'تصحيح سجل صيانة معتمد (بسبب موثق)', 182)
on conflict (key) do nothing;
insert into public.company_role_permissions (role, permission_key) values
  ('supervisor', 'faults.view'), ('supervisor', 'faults.create'), ('supervisor', 'faults.update'),
  ('technician', 'faults.create'), ('accountant', 'faults.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1) حالات الجهاز
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conrelid::regclass::text t, conname from pg_constraint
           where contype = 'c' and conrelid in ('public.devices'::regclass, 'public.maintenance_records'::regclass)
             and pg_get_constraintdef(oid) like '%decommissioned%' loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $$;
alter table public.devices add constraint devices_status_check check (status in
  ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service', 'expired', 'replaced', 'decommissioned'));
alter table public.maintenance_records add constraint maintenance_records_status_after_check check (status_after in
  ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service', 'expired', 'replaced', 'decommissioned'));
alter table public.devices add column if not exists replaced_by_device_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'devices_replaced_by_fk') then
    alter table public.devices add constraint devices_replaced_by_fk foreign key (replaced_by_device_id, company_id)
      references public.devices (id, company_id) on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) الزيارة وسجل الفحص
-- ---------------------------------------------------------------------
alter table public.visits add column if not exists visit_type text not null default 'periodic'
  check (visit_type in ('periodic', 'emergency', 'repair', 'reinspection', 'installation', 'other'));
alter table public.visits add column if not exists outcome text
  check (outcome in ('completed', 'completed_with_issues', 'incomplete', 'follow_up_required'));
alter table public.visits add column if not exists recommendations text;
alter table public.visits add column if not exists follow_up_status text not null default 'none'
  check (follow_up_status in ('none', 'required', 'scheduled', 'done'));

alter table public.maintenance_records add column if not exists condition_before text
  check (condition_before in ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service', 'expired', 'replaced', 'decommissioned'));
alter table public.maintenance_records add column if not exists readings jsonb not null default '{}'::jsonb;
alter table public.maintenance_records add column if not exists actions_taken text;
alter table public.maintenance_records add column if not exists recommendations text;
alter table public.maintenance_records add column if not exists fault_id uuid;

-- حالة الجهاز عند الفحص تُلتقط تلقائيًا إن لم تُرسل؛ الزيارة يجب أن تكون للعميل نفسه
create or replace function app_private.maintenance_capture_condition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid;
begin
  if new.condition_before is null then select status into new.condition_before from public.devices where id = new.device_id; end if;
  if jsonb_typeof(new.readings) <> 'object' then raise exception 'القراءات يجب أن تكون حقولًا وقيمًا' using errcode = '22023'; end if;
  if new.visit_id is not null then
    select customer_id into v_customer from public.visits where id = new.visit_id;
    if v_customer is distinct from (select customer_id from public.devices where id = new.device_id) then
      raise exception 'الزيارة المحددة لعميل آخر' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_maintenance_condition on public.maintenance_records;
create trigger trg_maintenance_condition before insert on public.maintenance_records
  for each row execute function app_private.maintenance_capture_condition();

-- ---------------------------------------------------------------------
-- 3) التصحيح الموثق
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  record_id uuid not null,
  field text not null check (field in ('result', 'notes', 'actions_taken', 'recommendations', 'readings', 'performed_at', 'status_after')),
  old_value jsonb, new_value jsonb,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  corrected_by uuid references auth.users(id) on delete set null,
  corrected_at timestamptz not null default now(),
  constraint mc_record_fk foreign key (record_id, company_id) references public.maintenance_records (id, company_id) on delete restrict
);
create index if not exists maintenance_corrections_record_idx on public.maintenance_corrections (record_id, corrected_at);
drop trigger if exists trg_maintenance_corrections_block on public.maintenance_corrections;
create trigger trg_maintenance_corrections_block before update or delete on public.maintenance_corrections
  for each row execute function app_private.block_change();

create or replace function public.maintenance_correct(p_record uuid, p_field text, p_new_value jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.maintenance_records; v_old jsonb; v_id uuid;
begin
  select * into r from public.maintenance_records where id = p_record;
  if r.id is null then raise exception 'السجل غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(r.company_id, 'maintenance.correct') then raise exception 'ليست لديك صلاحية تصحيح السجلات' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'اذكر سبب التصحيح' using errcode = '22023'; end if;
  if p_field not in ('result', 'notes', 'actions_taken', 'recommendations', 'readings', 'performed_at', 'status_after') then
    raise exception 'لا يمكن تصحيح هذا الحقل' using errcode = '22023';
  end if;
  if p_field = 'result' and (p_new_value #>> '{}') not in ('pass', 'pass_with_notes', 'fail') then raise exception 'نتيجة غير صالحة' using errcode = '22023'; end if;
  -- القيمة الحالية = آخر تصحيح للحقل أو الأصل
  select coalesce((select new_value from public.maintenance_corrections where record_id = p_record and field = p_field order by corrected_at desc limit 1),
                  to_jsonb(r) -> p_field) into v_old;
  insert into public.maintenance_corrections (company_id, record_id, field, old_value, new_value, reason, corrected_by)
  values (r.company_id, p_record, p_field, v_old, p_new_value, btrim(p_reason), auth.uid()) returning id into v_id;
  return v_id;
end $$;

alter table public.maintenance_corrections enable row level security;
drop policy if exists ays_mc_select on public.maintenance_corrections;
create policy ays_mc_select on public.maintenance_corrections for select to authenticated using (
  exists (select 1 from public.maintenance_records m where m.id = record_id));
revoke all on public.maintenance_corrections from anon;
revoke insert, update, delete, truncate, references, trigger on public.maintenance_corrections from authenticated;
grant select on public.maintenance_corrections to authenticated;

-- ---------------------------------------------------------------------
-- 4) الصور
-- ---------------------------------------------------------------------
alter table public.attachments add column if not exists photo_stage text check (photo_stage in ('before', 'after', 'general'));
alter table public.attachments add column if not exists device_id uuid;
create index if not exists attachments_device_idx on public.attachments (device_id) where device_id is not null;
alter table public.attachments drop constraint if exists attachments_device_fk;
alter table public.attachments add constraint attachments_device_fk foreign key (device_id, company_id)
  references public.devices (id, company_id) on delete restrict;
create or replace function app_private.attachments_check_device() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid;
begin
  if new.device_id is null then return new; end if;
  if not exists (select 1 from public.devices where id = new.device_id and company_id = new.company_id) then
    raise exception 'الجهاز غير موجود' using errcode = '23514';
  end if;
  if new.entity_type = 'visit' then
    select customer_id into v_customer from public.visits where id = new.entity_id;
    if v_customer is distinct from (select customer_id from public.devices where id = new.device_id) then
      raise exception 'الجهاز لا يتبع عميل الزيارة' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_attachments_device on public.attachments;
create trigger trg_attachments_device before insert or update of device_id on public.attachments
  for each row execute function app_private.attachments_check_device();

-- ---------------------------------------------------------------------
-- 5) البلاغات والأعطال
-- ---------------------------------------------------------------------
create table if not exists public.device_faults (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  device_id uuid not null,
  customer_id uuid not null, site_id uuid,
  source text not null default 'technician' check (source in ('technician', 'customer', 'inspection', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  description text not null check (length(btrim(description)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'awaiting_verification', 'closed', 'cancelled')),
  reported_at timestamptz not null default now(),
  reported_by uuid,
  work_order_id uuid,
  resolution text, resolved_at timestamptz, resolved_by uuid,
  verification_result text check (verification_result in ('passed', 'failed')),
  verified_at timestamptz, verified_by uuid,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint device_faults_id_company_key unique (id, company_id),
  constraint df_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict,
  constraint df_wo_fk foreign key (work_order_id, company_id) references public.work_orders (id, company_id) on delete restrict
);
create unique index if not exists device_faults_company_ref_key on public.device_faults (company_id, ref_no);
create index if not exists device_faults_device_idx on public.device_faults (device_id, reported_at desc);
create index if not exists device_faults_open_idx on public.device_faults (company_id, status) where status not in ('closed', 'cancelled');

create table if not exists public.device_fault_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  fault_id uuid not null,
  from_status text, to_status text not null,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint dfe_fault_fk foreign key (fault_id, company_id) references public.device_faults (id, company_id) on delete restrict
);
create index if not exists device_fault_events_fault_idx on public.device_fault_events (fault_id, occurred_at);
drop trigger if exists trg_device_fault_events_block on public.device_fault_events;
create trigger trg_device_fault_events_block before update or delete on public.device_fault_events
  for each row execute function app_private.block_change();

alter table public.maintenance_records drop constraint if exists mr_fault_fk;
alter table public.maintenance_records add constraint mr_fault_fk foreign key (fault_id, company_id)
  references public.device_faults (id, company_id) on delete restrict;

-- لقطة العميل والموقع من الجهاز، والرقم المرجعي، ومن أبلغ
create or replace function app_private.faults_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record; w uuid;
begin
  select customer_id, site_id into d from public.devices where id = new.device_id and company_id = new.company_id;
  if d.customer_id is null then raise exception 'الجهاز غير موجود' using errcode = '23514'; end if;
  new.customer_id := d.customer_id; new.site_id := d.site_id;
  new.reported_by := coalesce(new.reported_by, auth.uid());
  new.status := 'open';
  if new.work_order_id is not null then
    select customer_id into w from public.work_orders where id = new.work_order_id;
    if w is distinct from d.customer_id then raise exception 'أمر العمل لعميل آخر' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_device_faults_before_insert on public.device_faults;
create trigger trg_device_faults_before_insert before insert on public.device_faults
  for each row execute function app_private.faults_before_insert();
drop trigger if exists trg_device_faults_ref on public.device_faults;
create trigger trg_device_faults_ref before insert or update on public.device_faults
  for each row execute function app_private.assign_ref('FLT');
drop trigger if exists trg_device_faults_touch on public.device_faults;
create trigger trg_device_faults_touch before update on public.device_faults
  for each row execute function app_private.touch_updated_at();
drop trigger if exists trg_device_faults_audit on public.device_faults;
create trigger trg_device_faults_audit after insert or update or delete on public.device_faults
  for each row execute function app_private.audit_row('fault');

create or replace function app_private.faults_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  insert into public.device_fault_events (company_id, fault_id, to_status, note, actor_id)
  values (new.company_id, new.id, 'open', left(new.description, 300), auth.uid());
  -- إشعار فنيي نطاق الجهاز والإدارة
  for r in select u.user_id from app_private.device_responsible_users(new.device_id) u
           union select m.user_id from public.company_memberships m where m.company_id = new.company_id and m.status = 'active'
             and 'faults.update' = any (public.company_effective_permissions(m.role, m.permissions)) loop
    continue when r.user_id = auth.uid();
    perform app_private.notify(new.company_id, r.user_id, 'fault_reported', 'بلاغ عطل ' || coalesce(new.ref_no, ''),
      left(new.description, 200), '/faults/' || new.id, 'fault', new.id, 'fault:' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_device_faults_after_insert on public.device_faults;
create trigger trg_device_faults_after_insert after insert on public.device_faults
  for each row execute function app_private.faults_after_insert();

-- تغيير حالة البلاغ: بالإجراء فقط، مع سجل وتحقق لاحق؛ لا يمس مواعيد الصيانة
create or replace function public.fault_transition(p_fault uuid, p_status text, p_note text default null,
  p_work_order uuid default null, p_verification text default null, p_device_status text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.device_faults; w uuid;
begin
  select * into f from public.device_faults where id = p_fault for update;
  if f.id is null then raise exception 'البلاغ غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(f.company_id, 'faults.update') then raise exception 'ليست لديك صلاحية إدارة البلاغات' using errcode = '42501'; end if;
  if f.archived_at is not null then raise exception 'البلاغ مؤرشف' using errcode = 'P0001'; end if;
  if not (
    (f.status = 'open' and p_status in ('in_progress', 'awaiting_verification', 'closed', 'cancelled')) or
    (f.status = 'in_progress' and p_status in ('awaiting_verification', 'closed', 'cancelled', 'open')) or
    (f.status = 'awaiting_verification' and p_status in ('closed', 'in_progress')) or
    (f.status in ('closed', 'cancelled') and p_status = 'open') or
    (p_status = f.status and p_work_order is not null and f.status not in ('closed', 'cancelled')) -- ربط أمر عمل دون تغيير الحالة
  ) then raise exception 'انتقال غير مسموح من «%» إلى «%»', f.status, p_status using errcode = 'P0001'; end if;
  if p_status in ('awaiting_verification', 'closed') and length(btrim(coalesce(p_note, f.resolution, ''))) < 3 then
    raise exception 'اذكر ما تم من إصلاح أو سبب الإغلاق' using errcode = '22023';
  end if;
  if f.status = 'awaiting_verification' and p_status = 'closed' and p_verification is distinct from 'passed' then
    raise exception 'الإغلاق بعد التحقق يتطلب نتيجة تحقق ناجحة' using errcode = '22023';
  end if;
  if p_status = 'in_progress' and f.status = 'awaiting_verification' and p_verification is distinct from 'failed' then
    raise exception 'إعادة البلاغ للعمل تتطلب تحققًا فاشلًا' using errcode = '22023';
  end if;
  if p_work_order is not null then
    select customer_id into w from public.work_orders where id = p_work_order and company_id = f.company_id;
    if w is distinct from f.customer_id then raise exception 'أمر العمل لعميل آخر' using errcode = '23514'; end if;
  end if;
  if p_device_status is not null and p_device_status not in ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service') then
    raise exception 'حالة جهاز غير صالحة' using errcode = '22023';
  end if;

  update public.device_faults set status = p_status,
    work_order_id = coalesce(p_work_order, work_order_id),
    resolution = case when p_status in ('awaiting_verification', 'closed') then coalesce(nullif(btrim(p_note), ''), resolution) else resolution end,
    resolved_at = case when p_status in ('awaiting_verification', 'closed') and resolved_at is null then now() when p_status = 'open' then null else resolved_at end,
    resolved_by = case when p_status in ('awaiting_verification', 'closed') and resolved_by is null then auth.uid() when p_status = 'open' then null else resolved_by end,
    verification_result = case when p_verification is not null then p_verification when p_status = 'open' then null else verification_result end,
    verified_at = case when p_verification is not null then now() when p_status = 'open' then null else verified_at end,
    verified_by = case when p_verification is not null then auth.uid() when p_status = 'open' then null else verified_by end
  where id = p_fault;
  insert into public.device_fault_events (company_id, fault_id, from_status, to_status, note, actor_id)
  values (f.company_id, f.id, f.status, p_status, nullif(btrim(coalesce(p_note, '') || case when p_verification is not null then ' [تحقق: ' || p_verification || ']' else '' end), ''), auth.uid());
  -- حالة الجهاز تتغير فقط باختيار صريح، ولا تمس موعد صيانته
  if p_device_status is not null then
    update public.devices set status = p_device_status where id = f.device_id;
  end if;
end $$;

alter table public.device_faults enable row level security;
alter table public.device_fault_events enable row level security;
drop policy if exists ays_df_select on public.device_faults;
create policy ays_df_select on public.device_faults for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'faults')
         or (public.company_is_member(company_id) and work_order_id is not null and app_private.is_assigned_work_order(work_order_id)));
drop policy if exists ays_df_insert on public.device_faults;
create policy ays_df_insert on public.device_faults for insert to authenticated with check (
  public.company_has_perm(company_id, 'faults.create')
  and exists (select 1 from public.devices d where d.id = device_id)); -- الجهاز مرئي للمبلّغ (RLS)
drop policy if exists ays_df_update on public.device_faults;
create policy ays_df_update on public.device_faults for update to authenticated
  using (public.company_has_perm(company_id, 'faults.update')) with check (public.company_has_perm(company_id, 'faults.update'));
drop policy if exists ays_dfe_select on public.device_fault_events;
create policy ays_dfe_select on public.device_fault_events for select to authenticated
  using (exists (select 1 from public.device_faults f where f.id = fault_id));
revoke all on public.device_faults, public.device_fault_events from anon;
revoke all on public.device_faults, public.device_fault_events from authenticated;
grant select on public.device_fault_events to authenticated;
-- الإنشاء بأعمدة البلاغ فقط؛ التعديل المباشر مقصور على الوصف والخطورة والأرشفة؛ الحالة بإجراء fault_transition فقط
grant select on public.device_faults to authenticated;
grant insert (company_id, device_id, source, severity, description, work_order_id) on public.device_faults to authenticated;
grant update (description, severity, archived_at) on public.device_faults to authenticated;

-- مرفقات البلاغات
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.attachments'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%entity_type%' loop
    execute format('alter table public.attachments drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.attachments add constraint attachments_entity_type_check check (entity_type in
  ('device', 'customer', 'site', 'work_order', 'visit', 'maintenance', 'catalog_item', 'technician', 'fault'));
create or replace function app_private.attachment_module(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type when 'device' then 'devices' when 'customer' then 'customers' when 'site' then 'sites'
    when 'work_order' then 'work_orders' when 'visit' then 'visits' when 'maintenance' then 'maintenance'
    when 'catalog_item' then 'catalog' when 'technician' then 'technicians' when 'fault' then 'faults' end
$$;
create or replace function app_private.attachment_entity_visible(p_type text, p_id uuid) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
begin
  return case p_type
    when 'device' then exists (select 1 from public.devices where id = p_id)
    when 'customer' then exists (select 1 from public.customers where id = p_id)
    when 'site' then exists (select 1 from public.customer_sites where id = p_id)
    when 'work_order' then exists (select 1 from public.work_orders where id = p_id)
    when 'visit' then exists (select 1 from public.visits where id = p_id)
    when 'maintenance' then exists (select 1 from public.maintenance_records where id = p_id)
    when 'catalog_item' then exists (select 1 from public.catalog_items where id = p_id)
    when 'technician' then exists (select 1 from public.technicians where id = p_id)
    when 'fault' then exists (select 1 from public.device_faults where id = p_id)
    else false end;
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function app_private.maintenance_capture_condition(), app_private.attachments_check_device(),
  app_private.faults_before_insert(), app_private.faults_after_insert() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.maintenance_correct(uuid, text, jsonb, text)',
    'public.fault_transition(uuid, text, text, uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
