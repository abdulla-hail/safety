-- =====================================================================
-- عين السلامة — م5ب: تنفيذ الزيارة جهازًا جهازًا (دورية/طارئة)، المسودات، الإغلاق، المتابعات، وسجل تغيير المواعيد
-- (مشروع cgwnusudjhhxkwnqjzfr) — **مقترح، لم يُطبّق**. يتطلب تطبيق 20261105000100 أولًا.
--
-- نموذج البيانات: شركة ← عميل ← موقع ← جهاز ← خطة (فترة + بداية) ← استحقاق (device_maintenance_cycles)
--   ← زيارة (visits) ← بند فحص لكل جهاز (visit_devices: مسودة قابلة للاستئناف ما دامت الزيارة مفتوحة)
--   ← عند الإغلاق: سجل صيانة غير قابل للتعديل لكل جهاز فُحص فعلًا (maintenance_records.id = visit_devices.id)
--   ← بلاغ/متابعة (device_faults) بمسؤول وتاريخ ← إصلاح ← تحقق.
--
-- القواعد:
-- 1) نتيجة الفحص (result) منفصلة عن الحالة التشغيلية بعد الفحص (status_after)؛ البند غير المفحوص لا يُنشئ سجل صيانة
--    ولا يُتم الاستحقاق (يبقى مستحقًا/متأخرًا). «تعذر الفحص» و«غير موجود في الموقع» يتطلبان سببًا.
-- 2) زيارة دورية مفتوحة واحدة لكل موقع؛ بدء زيارة دورية لموقع له زيارة مفتوحة يستأنفها. مفتاح العميل (client_key) يمنع
--    التكرار عند إعادة الإرسال؛ الإغلاق متكرر الأمان (معرّف السجل = معرّف البند).
-- 3) الإغلاق كمكتملة يتطلب نتيجة لكل جهاز؛ غير ذلك بمسار استثناء بصلاحية visits.close_exception وسبب موثق.
-- 4) الزيارة الطارئة تُنشئ سجلات تصحيحية/متابعة لا تمس الموعد الدوري؛ تغيير الموعد بإجراء صريح فقط.
-- 5) الموعد القادم يُحسب في القاعدة من تاريخ التنفيذ الفعلي وفترة الخطة (compute_next_due القائمة)؛ التعديل اليدوي
--    بصلاحية maintenance.reschedule وسبب، ويُحفظ القديم والجديد والمنفّذ في device_due_changes. أي تغيير مباشر للموعد مرفوض.
-- 6) بعد الإغلاق لا يُعدَّل البند ولا الزيارة ولا تُضاف صور لها؛ التصحيح عبر maintenance_correct القائمة.
--    سجل الصيانة من الواجهة لا يُنشأ إلا بإغلاق زيارة (كل نتيجة مرتبطة بجهاز وزيارة وتقرير).
-- 7) النطاق: الفني يعمل على مواقع إسناده فقط (RLS + فحص داخل الدوال)؛ تضييق تعديل الزيارات ومرفقاتها على ما يراه المستخدم.
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

do $$ begin
  if to_regclass('public.device_faults') is null then
    raise exception 'طبّق ترحيل المرحلة الخامسة 20261105000100 أولًا';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) الصلاحيات
-- ---------------------------------------------------------------------
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('visits.close_exception', 'visits', 'إغلاق زيارة غير مكتملة باستثناء موثق', 176),
  ('maintenance.reschedule', 'maintenance', 'تعديل موعد الصيانة القادمة يدويًا بسبب موثق', 183)
on conflict (key) do nothing;
insert into public.company_role_permissions (role, permission_key) values
  ('supervisor', 'visits.close_exception'), ('supervisor', 'maintenance.reschedule')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1) الزيارة
-- ---------------------------------------------------------------------
alter table public.visits add column if not exists client_key uuid;
alter table public.visits add column if not exists urgent_reason text
  check (urgent_reason in ('fault', 'customer_report', 'repair', 'reinspection', 'follow_up', 'other'));
alter table public.visits add column if not exists closed_at timestamptz;
alter table public.visits add column if not exists closed_by uuid;
alter table public.visits add column if not exists close_exception_reason text;
create unique index if not exists visits_client_key on public.visits (company_id, client_key) where client_key is not null;
-- زيارة دورية مفتوحة واحدة لكل موقع (يمنع ازدواج الزيارة للفترة نفسها)
create unique index if not exists visits_one_open_periodic on public.visits (site_id)
  where visit_type = 'periodic' and closed_at is null and status in ('scheduled', 'in_progress') and archived_at is null and site_id is not null;

alter table public.maintenance_records add column if not exists findings text;
alter table public.maintenance_records add column if not exists parts jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_parts_array') then
    alter table public.maintenance_records add constraint maintenance_records_parts_array check (jsonb_typeof(parts) = 'array');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) بنود الزيارة (جهاز لكل بند)
-- ---------------------------------------------------------------------
create table if not exists public.visit_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  visit_id uuid not null,
  device_id uuid not null,
  customer_id uuid not null, site_id uuid,
  cycle_id uuid,                -- الاستحقاق المفتوح عند بدء الزيارة (للدورية)
  due_date date,                -- موعد الجهاز عند بدء الزيارة
  condition_before text,        -- الحالة التشغيلية عند بدء الزيارة
  inspection_status text not null default 'pending' check (inspection_status in ('pending', 'inspected', 'unable', 'not_found')),
  skip_reason text,
  action text not null default 'inspection' check (action in ('installation', 'inspection', 'test', 'cleaning', 'refill', 'part_replacement', 'repair', 'decommission')),
  result text check (result in ('pass', 'pass_with_notes', 'fail')),
  status_after text check (status_after in ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service', 'expired', 'replaced', 'decommissioned')),
  findings text, actions_taken text, recommendations text, notes text,
  readings jsonb not null default '{}'::jsonb,
  parts jsonb not null default '[]'::jsonb,
  resolved boolean,
  follow_up_needed boolean not null default false,
  follow_up_technician_id uuid, follow_up_due date, follow_up_note text,
  next_due_override date, next_due_reason text,
  inspected_at timestamptz, inspected_by uuid, technician_id uuid,
  record_id uuid, fault_id uuid,
  version integer not null default 1,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  constraint visit_devices_unique unique (visit_id, device_id),
  constraint visit_devices_id_company_key unique (id, company_id),
  constraint vd_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete restrict,
  constraint vd_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict,
  constraint vd_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete restrict,
  constraint vd_followup_tech_fk foreign key (follow_up_technician_id, company_id) references public.technicians (id, company_id) on delete restrict,
  constraint vd_fault_fk foreign key (fault_id, company_id) references public.device_faults (id, company_id) on delete restrict,
  constraint vd_skip_reason check (inspection_status not in ('unable', 'not_found') or length(btrim(coalesce(skip_reason, ''))) >= 3),
  constraint vd_inspected_complete check (inspection_status <> 'inspected' or (result is not null and status_after is not null and inspected_at is not null)),
  constraint vd_followup_complete check (not follow_up_needed or (follow_up_technician_id is not null and follow_up_due is not null)),
  constraint vd_override_reason check (next_due_override is null or length(btrim(coalesce(next_due_reason, ''))) >= 5),
  constraint vd_readings_object check (jsonb_typeof(readings) = 'object'),
  constraint vd_parts_array check (jsonb_typeof(parts) = 'array' and jsonb_array_length(parts) <= 50)
);
create index if not exists visit_devices_device_idx on public.visit_devices (device_id, created_at desc);
create index if not exists visit_devices_visit_idx on public.visit_devices (visit_id);

alter table public.device_faults add column if not exists kind text not null default 'fault' check (kind in ('fault', 'follow_up', 'repair_request'));
alter table public.device_faults add column if not exists assigned_technician_id uuid;
alter table public.device_faults add column if not exists follow_up_due date;
alter table public.device_faults add column if not exists visit_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'df_assignee_fk') then
    alter table public.device_faults add constraint df_assignee_fk foreign key (assigned_technician_id, company_id) references public.technicians (id, company_id) on delete restrict;
    alter table public.device_faults add constraint df_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete restrict;
  end if;
end $$;
grant insert (kind, assigned_technician_id, follow_up_due) on public.device_faults to authenticated;
grant update (assigned_technician_id, follow_up_due) on public.device_faults to authenticated;

-- ---------------------------------------------------------------------
-- 3) سجل تغيير الموعد القادم (دائم)
-- ---------------------------------------------------------------------
create table if not exists public.device_due_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  device_id uuid not null,
  old_date date, new_date date,
  source text not null check (source in ('manual', 'visit_override', 'schedule', 'maintenance', 'system')),
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint ddc_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict
);
create index if not exists device_due_changes_device_idx on public.device_due_changes (device_id, changed_at desc);
drop trigger if exists trg_device_due_changes_block on public.device_due_changes;
create trigger trg_device_due_changes_block before update or delete on public.device_due_changes
  for each row execute function app_private.block_change();

-- الموعد لا يتغير مباشرة من الواجهة: فقط بالصيانة (cycle_managed) أو بإجراء موثق (due_source)
create or replace function app_private.devices_due_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.next_maintenance_at is distinct from old.next_maintenance_at and app_private.is_client_request()
     and coalesce(current_setting('app.due_source', true), '') = '' and coalesce(current_setting('app.cycle_managed', true), '') = '' then
    raise exception 'تغيير موعد الصيانة القادمة يتم بإجراء «تعديل الموعد» مع ذكر السبب' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_devices_due_guard on public.devices;
create trigger trg_devices_due_guard before update of next_maintenance_at on public.devices
  for each row execute function app_private.devices_due_guard();

create or replace function app_private.devices_due_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.next_maintenance_at is distinct from old.next_maintenance_at then
    insert into public.device_due_changes (company_id, device_id, old_date, new_date, source, reason, changed_by)
    values (new.company_id, new.id, old.next_maintenance_at, new.next_maintenance_at,
      coalesce(nullif(current_setting('app.due_source', true), ''),
               case when coalesce(current_setting('app.cycle_managed', true), '') <> '' then 'maintenance' else 'system' end),
      nullif(current_setting('app.due_reason', true), ''), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists trg_devices_due_log on public.devices;
create trigger trg_devices_due_log after update of next_maintenance_at on public.devices
  for each row execute function app_private.devices_due_log();

-- تعديل يدوي موثق للموعد القادم
create or replace function public.device_set_next_due(p_device uuid, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  select id, company_id, next_maintenance_at, archived_at, status into d from public.devices where id = p_device for update;
  if d.id is null then raise exception 'الجهاز غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(d.company_id, 'maintenance.reschedule') then
    raise exception 'ليست لديك صلاحية تعديل موعد الصيانة' using errcode = '42501';
  end if;
  if d.archived_at is not null or d.status = 'decommissioned' then raise exception 'الجهاز مؤرشف أو مستبعد' using errcode = 'P0001'; end if;
  if p_date is null then raise exception 'حدد الموعد الجديد' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'اذكر سبب تعديل الموعد' using errcode = '22023'; end if;
  if p_date is not distinct from d.next_maintenance_at then raise exception 'الموعد الجديد مطابق للحالي' using errcode = '22023'; end if;
  perform set_config('app.due_source', 'manual', true);
  perform set_config('app.due_reason', left(btrim(p_reason), 1000), true);
  update public.devices set next_maintenance_at = p_date where id = p_device;
  perform set_config('app.due_source', '', true);
  perform set_config('app.due_reason', '', true);
  perform public.company_audit(d.company_id, 'device_due_changed', 'device', d.id,
    jsonb_build_object('from', d.next_maintenance_at, 'to', p_date, 'reason', left(btrim(p_reason), 1000)));
end $$;

-- تطبيق جدول جديد (القائم) يمر عبر المصدر «schedule» حتى يُسجَّل تغيير الموعد
create or replace function public.devices_set_schedule(p_devices uuid[], p_months integer, p_start date default null,
  p_recalculate boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_policy text; n integer := 0; d record;
begin
  if p_months is null or p_months not between 1 and 60 then raise exception 'فترة الصيانة بين شهر و60 شهرًا' using errcode = '22023'; end if;
  if coalesce(array_length(p_devices, 1), 0) = 0 or array_length(p_devices, 1) > 2000 then raise exception 'حدد الأجهزة (حتى 2000)' using errcode = '22023'; end if;
  select distinct company_id into v_company from public.devices where id = any (p_devices);
  if v_company is null or (select count(distinct company_id) from public.devices where id = any (p_devices)) <> 1 then
    raise exception 'الأجهزة غير موجودة' using errcode = 'P0002';
  end if;
  if not public.company_has_perm(v_company, 'devices.update') then raise exception 'ليست لديك صلاحية تعديل الأجهزة' using errcode = '42501'; end if;
  select schedule_policy into v_policy from public.companies where id = v_company;
  perform set_config('app.due_source', 'schedule', true);
  perform set_config('app.due_reason', 'تطبيق فترة صيانة ' || p_months || ' شهر', true);
  for d in select * from public.devices where id = any (p_devices) and archived_at is null for update loop
    update public.devices set maintenance_interval_months = p_months,
      schedule_start_date = coalesce(p_start, schedule_start_date, installed_at, (now() at time zone 'Asia/Riyadh')::date),
      next_maintenance_at = case when p_recalculate and status <> 'decommissioned' then
        app_private.compute_next_due(coalesce(p_start, schedule_start_date, installed_at, (now() at time zone 'Asia/Riyadh')::date),
          p_months, null, v_policy, last_maintenance_at, null) else next_maintenance_at end
    where id = d.id;
    n := n + 1;
  end loop;
  perform set_config('app.due_source', '', true);
  perform set_config('app.due_reason', '', true);
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 4) الحماية بعد الإغلاق
-- ---------------------------------------------------------------------
create or replace function app_private.visit_devices_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.visit_work', true), '') = '' then
    raise exception 'بنود الزيارة تُحفظ عبر إجراءات الزيارة فقط' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_visit_devices_guard on public.visit_devices;
create trigger trg_visit_devices_guard before insert or update or delete on public.visit_devices
  for each row execute function app_private.visit_devices_guard();

create or replace function app_private.visits_closed_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.closed_at is not null and coalesce(current_setting('app.visit_work', true), '') = ''
     and (to_jsonb(new) - array['archived_at', 'archived_by', 'updated_at', 'follow_up_status'])
         is distinct from (to_jsonb(old) - array['archived_at', 'archived_by', 'updated_at', 'follow_up_status']) then
    raise exception 'الزيارة مغلقة؛ نتائجها سجل تاريخي لا يُعدَّل (استخدم التصحيح الموثق)' using errcode = 'P0001';
  end if;
  if old.closed_at is null and new.closed_at is not null and coalesce(current_setting('app.visit_work', true), '') = '' then
    raise exception 'إغلاق الزيارة يتم بإجراء «إغلاق الزيارة» فقط' using errcode = 'P0001';
  end if;
  if old.closed_at is null and coalesce(current_setting('app.visit_work', true), '') = '' and new.status = 'completed' and old.status <> 'completed'
     and exists (select 1 from public.visit_devices where visit_id = old.id) then
    raise exception 'أكمل الزيارة من شاشة التنفيذ حتى تُراجع نتائج الأجهزة' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_visits_closed_guard on public.visits;
create trigger trg_visits_closed_guard before update on public.visits
  for each row execute function app_private.visits_closed_guard();

-- كل نتيجة فحص من الواجهة مرتبطة بزيارة: سجل الصيانة يُنشأ عند إغلاق الزيارة فقط (لا إدخال مباشر بلا زيارة)
create or replace function app_private.maintenance_via_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app_private.is_client_request() and coalesce(current_setting('app.visit_work', true), '') = '' then
    raise exception 'تُسجَّل نتائج الفحص والصيانة من خلال زيارة (دورية أو طارئة) حتى ترتبط بالزيارة وتقريرها' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_maintenance_via_visit on public.maintenance_records;
create trigger trg_maintenance_via_visit before insert on public.maintenance_records
  for each row execute function app_private.maintenance_via_visit();

create or replace function app_private.attachments_visit_open() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_type = 'visit' and exists (select 1 from public.visits where id = new.entity_id and closed_at is not null) then
    raise exception 'الزيارة مغلقة؛ لا تُضاف إليها صور أو مرفقات' using errcode = 'P0001';
  end if;
  if new.entity_type = 'visit' and new.device_id is not null
     and not exists (select 1 from public.visit_devices where visit_id = new.entity_id and device_id = new.device_id)
     and exists (select 1 from public.visit_devices where visit_id = new.entity_id) then
    raise exception 'الجهاز ليس ضمن هذه الزيارة' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_attachments_visit_open on public.attachments;
create trigger trg_attachments_visit_open before insert on public.attachments
  for each row execute function app_private.attachments_visit_open();

-- ---------------------------------------------------------------------
-- 5) الوصول
-- ---------------------------------------------------------------------
-- يعمل على الزيارة: من يملك تعديل الزيارات ويرى موقعها، أو الفني المعيَّن لها
create or replace function app_private.visit_can_work(p_visit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visits v where v.id = p_visit and v.archived_at is null
    and public.company_has_perm(v.company_id, 'visits.update')
    and (public.company_can_view_site(v.company_id, v.customer_id, v.site_id, 'visits') or app_private.is_assigned_visit(v.id)))
$$;

create or replace function app_private.my_technician(p_company uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.technicians where company_id = p_company and user_id = auth.uid() and archived_at is null order by created_at limit 1
$$;

drop policy if exists ays_visits_update on public.visits;
create policy ays_visits_update on public.visits for update to authenticated
  using (public.company_has_any_perm(company_id, array['visits.update', 'visits.archive'])
         and (public.company_can_view_site(company_id, customer_id, site_id, 'visits') or app_private.is_assigned_visit(id)))
  with check (public.company_has_any_perm(company_id, array['visits.update', 'visits.archive'])
         and (public.company_can_view_site(company_id, customer_id, site_id, 'visits') or app_private.is_assigned_visit(id)));
drop policy if exists ays_vt_insert on public.visit_technicians;
create policy ays_vt_insert on public.visit_technicians for insert to authenticated
  with check (public.company_has_any_perm(company_id, array['visits.create', 'visits.update'])
              and exists (select 1 from public.visits v where v.id = visit_id));
drop policy if exists ays_attachments_insert on public.attachments;
create policy ays_attachments_insert on public.attachments for insert to authenticated
  with check (public.company_has_any_perm(company_id, array[app_private.attachment_module(entity_type) || '.update',
                app_private.attachment_module(entity_type) || '.create', 'catalog.manage'])
              and app_private.attachment_entity_visible(entity_type, entity_id));

alter table public.visit_devices enable row level security;
alter table public.device_due_changes enable row level security;
drop policy if exists ays_vd_select on public.visit_devices;
create policy ays_vd_select on public.visit_devices for select to authenticated
  using (exists (select 1 from public.visits v where v.id = visit_id));
drop policy if exists ays_ddc_select on public.device_due_changes;
create policy ays_ddc_select on public.device_due_changes for select to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id));
revoke all on public.visit_devices, public.device_due_changes from anon;
revoke insert, update, delete, truncate, references, trigger on public.visit_devices, public.device_due_changes from authenticated;
grant select on public.visit_devices, public.device_due_changes to authenticated;

-- ---------------------------------------------------------------------
-- 6) إجراءات الزيارة
-- ---------------------------------------------------------------------
-- يضيف كل الأجهزة النشطة في موقع الزيارة الدورية (مع الاستحقاق المفتوح والحالة الحالية لكل جهاز)
create or replace function app_private.visit_fill_periodic(p_visit uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform set_config('app.visit_work', '1', true);
  insert into public.visit_devices (company_id, visit_id, device_id, customer_id, site_id, cycle_id, due_date, condition_before, action, created_by, updated_by)
  select d.company_id, v.id, d.id, d.customer_id, d.site_id, c.id, d.next_maintenance_at, d.status, 'inspection', auth.uid(), auth.uid()
  from public.visits v join public.devices d on d.site_id = v.site_id and d.company_id = v.company_id
  left join public.device_maintenance_cycles c on c.device_id = d.id and c.status = 'open'
  where v.id = p_visit and d.archived_at is null and d.status not in ('decommissioned', 'replaced')
  on conflict (visit_id, device_id) do nothing;
  get diagnostics n = row_count;
  perform set_config('app.visit_work', '', true);
  return n;
end $$;

create or replace function app_private.visit_add_items(p_visit uuid, p_devices uuid[], p_action text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v record; n integer; k integer;
begin
  select id, company_id, site_id into v from public.visits where id = p_visit;
  k := (select count(distinct x) from unnest(p_devices) x);
  if k = 0 or k > 200 then raise exception 'حدد الأجهزة (حتى 200)' using errcode = '22023'; end if;
  if (select count(*) from public.devices d where d.id = any (p_devices) and d.company_id = v.company_id and d.site_id = v.site_id
        and d.archived_at is null and d.status not in ('decommissioned', 'replaced')) <> k then
    raise exception 'بعض الأجهزة المختارة ليست أجهزة نشطة في موقع الزيارة' using errcode = '23514';
  end if;
  perform set_config('app.visit_work', '1', true);
  insert into public.visit_devices (company_id, visit_id, device_id, customer_id, site_id, cycle_id, due_date, condition_before, action, created_by, updated_by)
  select d.company_id, v.id, d.id, d.customer_id, d.site_id, c.id, d.next_maintenance_at, d.status, coalesce(p_action, 'inspection'), auth.uid(), auth.uid()
  from public.devices d left join public.device_maintenance_cycles c on c.device_id = d.id and c.status = 'open'
  where d.id = any (p_devices)
  on conflict (visit_id, device_id) do nothing;
  get diagnostics n = row_count;
  perform set_config('app.visit_work', '', true);
  return n;
end $$;

-- بدء زيارة (أو استئنافها). دورية: كل أجهزة الموقع؛ طارئة: الأجهزة المختارة بسبب محدد.
create or replace function public.visit_start(p_client_key uuid, p_site uuid, p_type text, p_reason text default null,
  p_devices uuid[] default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s record; v_id uuid; v_tech uuid;
begin
  select id, company_id, customer_id into s from public.customer_sites where id = p_site and archived_at is null;
  if s.id is null then raise exception 'الموقع غير موجود أو مؤرشف' using errcode = 'P0002'; end if;
  if not (public.company_has_perm(s.company_id, 'visits.create')
          or (public.company_has_perm(s.company_id, 'field.assigned') and public.company_has_perm(s.company_id, 'visits.update')
              and app_private.is_assigned_site(s.company_id, s.customer_id, s.id))) then
    raise exception 'هذا الموقع خارج نطاق صلاحيتك' using errcode = '42501';
  end if;
  if p_type not in ('periodic', 'emergency', 'repair', 'reinspection', 'other') then raise exception 'نوع زيارة غير صالح' using errcode = '22023'; end if;
  if p_client_key is not null then
    select id into v_id from public.visits where company_id = s.company_id and client_key = p_client_key;
    if v_id is not null then return v_id; end if;
  end if;
  v_tech := app_private.my_technician(s.company_id);
  perform set_config('app.visit_work', '1', true);

  if p_type = 'periodic' then
    select id into v_id from public.visits where site_id = s.id and visit_type = 'periodic' and closed_at is null
      and status in ('scheduled', 'in_progress') and archived_at is null for update;
    if v_id is null then
      begin
        insert into public.visits (company_id, customer_id, site_id, scheduled_start, status, actual_start, visit_type, client_key, notes, created_by)
        values (s.company_id, s.customer_id, s.id, now(), 'in_progress', now(), 'periodic', p_client_key, left(nullif(btrim(p_notes), ''), 2000), auth.uid())
        returning id into v_id;
      exception when unique_violation then
        select id into v_id from public.visits where site_id = s.id and visit_type = 'periodic' and closed_at is null
          and status in ('scheduled', 'in_progress') and archived_at is null;
        if v_id is null then raise; end if;
      end;
    else
      update public.visits set status = 'in_progress', actual_start = coalesce(actual_start, now()) where id = v_id and status = 'scheduled';
    end if;
    perform app_private.visit_fill_periodic(v_id);
  else
    if p_reason is null or p_reason not in ('fault', 'customer_report', 'repair', 'reinspection', 'follow_up', 'other') then
      raise exception 'حدد سبب الزيارة الطارئة' using errcode = '22023';
    end if;
    if coalesce(array_length(p_devices, 1), 0) = 0 then raise exception 'اختر جهازًا واحدًا على الأقل' using errcode = '22023'; end if;
    insert into public.visits (company_id, customer_id, site_id, scheduled_start, status, actual_start, visit_type, urgent_reason, client_key, notes, created_by)
    values (s.company_id, s.customer_id, s.id, now(), 'in_progress', now(), p_type, p_reason, p_client_key, left(nullif(btrim(p_notes), ''), 2000), auth.uid())
    returning id into v_id;
    perform app_private.visit_add_items(v_id, p_devices, case when p_type = 'repair' or p_reason = 'repair' then 'repair' else 'inspection' end);
  end if;
  perform set_config('app.visit_work', '', true);
  if v_tech is not null then
    insert into public.visit_technicians (visit_id, technician_id, company_id, created_by) values (v_id, v_tech, s.company_id, auth.uid())
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- إضافة أجهزة لزيارة مفتوحة (طارئة غالبًا: جهاز إضافي في الموقع نفسه)
create or replace function public.visit_add_devices(p_visit uuid, p_devices uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select id, closed_at, status, visit_type, urgent_reason into v from public.visits where id = p_visit for update;
  if v.id is null or not app_private.visit_can_work(p_visit) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if v.closed_at is not null or v.status in ('completed', 'cancelled') then raise exception 'الزيارة مغلقة' using errcode = 'P0001'; end if;
  return app_private.visit_add_items(p_visit, p_devices, case when v.visit_type = 'repair' or v.urgent_reason = 'repair' then 'repair' else 'inspection' end);
end $$;

-- إزالة بند لم يُبدأ من زيارة طارئة مفتوحة (أُضيف بالخطأ)؛ الدورية تبقى بكل أجهزة الموقع
create or replace function public.visit_remove_device(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select vd.id, vd.visit_id, vd.inspection_status, v.closed_at, v.visit_type into r
  from public.visit_devices vd join public.visits v on v.id = vd.visit_id where vd.id = p_item for update of vd;
  if r.id is null or not app_private.visit_can_work(r.visit_id) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if r.closed_at is not null then raise exception 'الزيارة مغلقة' using errcode = 'P0001'; end if;
  if r.visit_type = 'periodic' then raise exception 'الزيارة الدورية تشمل كل أجهزة الموقع؛ سجّل «تعذر الفحص» أو «غير موجود» بسبب' using errcode = 'P0001'; end if;
  if r.inspection_status <> 'pending' then raise exception 'لا يُزال جهاز سُجلت نتيجته' using errcode = 'P0001'; end if;
  if (select count(*) from public.visit_devices where visit_id = r.visit_id) = 1 then raise exception 'الزيارة تحتاج جهازًا واحدًا على الأقل' using errcode = 'P0001'; end if;
  perform set_config('app.visit_work', '1', true);
  delete from public.visit_devices where id = p_item;
  perform set_config('app.visit_work', '', true);
end $$;

-- حفظ بند (مسودة أو نتيجة) مع حماية من الكتابة المتزامنة؛ يعيد الإصدار الجديد
create or replace function public.visit_save_item(p_item uuid, p_data jsonb, p_version integer default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_status text; v_result text; v_after text; v_action text; v_override date; v_fu boolean; v_fu_tech uuid; v_fu_due date;
  v_parts jsonb; v_readings jsonb; v_ver integer; v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  select vd.*, v.closed_at v_closed, v.status v_vstatus, v.visit_type v_type into r
  from public.visit_devices vd join public.visits v on v.id = vd.visit_id where vd.id = p_item for update of vd;
  if r.id is null then raise exception 'البند غير موجود' using errcode = 'P0002'; end if;
  if not app_private.visit_can_work(r.visit_id) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if r.v_closed is not null or r.v_vstatus in ('completed', 'cancelled') then raise exception 'الزيارة مغلقة؛ لا يمكن تعديل نتائجها' using errcode = 'P0001'; end if;
  if p_version is not null and p_version <> r.version then
    raise exception 'تغيّرت بيانات هذا الجهاز من جلسة أخرى؛ أعد تحميل الصفحة لمراجعتها' using errcode = '40001';
  end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'بيانات غير صالحة' using errcode = '22023'; end if;

  v_status := coalesce(nullif(p_data ->> 'inspection_status', ''), 'pending');
  if v_status not in ('pending', 'inspected', 'unable', 'not_found') then raise exception 'حالة فحص غير صالحة' using errcode = '22023'; end if;
  v_result := nullif(p_data ->> 'result', '');
  v_after := nullif(p_data ->> 'status_after', '');
  v_action := coalesce(nullif(p_data ->> 'action', ''), r.action);
  if v_result is not null and v_result not in ('pass', 'pass_with_notes', 'fail') then raise exception 'نتيجة غير صالحة' using errcode = '22023'; end if;
  if v_after is not null and v_after not in ('operational', 'needs_maintenance', 'faulty', 'under_repair', 'out_of_service', 'expired', 'replaced', 'decommissioned') then
    raise exception 'حالة تشغيلية غير صالحة' using errcode = '22023';
  end if;
  if v_action not in ('installation', 'inspection', 'test', 'cleaning', 'refill', 'part_replacement', 'repair', 'decommission') then
    raise exception 'نوع عملية غير صالح' using errcode = '22023';
  end if;
  if v_status = 'inspected' and (v_result is null or v_after is null) then
    raise exception 'الجهاز المفحوص يحتاج نتيجة الفحص وحالته بعد الفحص' using errcode = '22023';
  end if;
  if v_status in ('unable', 'not_found') and length(btrim(coalesce(p_data ->> 'skip_reason', ''))) < 3 then
    raise exception 'اذكر سبب عدم الفحص' using errcode = '22023';
  end if;
  v_readings := coalesce(p_data -> 'readings', '{}'::jsonb);
  v_parts := coalesce(p_data -> 'parts', '[]'::jsonb);
  if jsonb_typeof(v_readings) <> 'object' or (select count(*) from jsonb_object_keys(v_readings)) > 30 then
    raise exception 'القراءات: حتى 30 قراءة بصيغة اسم وقيمة' using errcode = '22023';
  end if;
  if jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) > 50
     or exists (select 1 from jsonb_array_elements(v_parts) e where jsonb_typeof(e) <> 'object' or length(btrim(coalesce(e ->> 'name', ''))) = 0) then
    raise exception 'القطع والمواد: حتى 50 بندًا لكل منها اسم' using errcode = '22023';
  end if;

  v_override := nullif(p_data ->> 'next_due_override', '')::date;
  if v_override is not null then
    if r.v_type <> 'periodic' then raise exception 'الزيارة الطارئة لا تغيّر موعد الصيانة الدورية؛ استخدم «تعديل الموعد» في صفحة الجهاز' using errcode = 'P0001'; end if;
    if not public.company_has_perm(r.company_id, 'maintenance.reschedule') then raise exception 'ليست لديك صلاحية تعديل موعد الصيانة' using errcode = '42501'; end if;
    if length(btrim(coalesce(p_data ->> 'next_due_reason', ''))) < 5 then raise exception 'اذكر سبب تعديل الموعد القادم' using errcode = '22023'; end if;
    if v_override <= v_today then raise exception 'الموعد القادم يجب أن يكون بعد اليوم' using errcode = '22023'; end if;
  end if;

  v_fu := coalesce(nullif(p_data ->> 'follow_up_needed', '')::boolean, false);
  v_fu_tech := nullif(p_data ->> 'follow_up_technician_id', '')::uuid;
  v_fu_due := nullif(p_data ->> 'follow_up_due', '')::date;
  if v_fu then
    if v_fu_tech is null or v_fu_due is null then raise exception 'المتابعة تحتاج مسؤولًا وتاريخًا' using errcode = '22023'; end if;
    if not exists (select 1 from public.technicians where id = v_fu_tech and company_id = r.company_id and archived_at is null) then
      raise exception 'المسؤول عن المتابعة غير موجود' using errcode = '23514';
    end if;
    if v_fu_due < v_today then raise exception 'تاريخ المتابعة لا يكون في الماضي' using errcode = '22023'; end if;
  end if;

  perform set_config('app.visit_work', '1', true);
  update public.visit_devices set
    inspection_status = v_status,
    skip_reason = case when v_status in ('unable', 'not_found') then left(btrim(p_data ->> 'skip_reason'), 500) end,
    action = v_action,
    result = case when v_status = 'inspected' or v_status = 'pending' then v_result end,
    status_after = case when v_status = 'inspected' or v_status = 'pending' then v_after end,
    findings = left(nullif(btrim(p_data ->> 'findings'), ''), 2000),
    actions_taken = left(nullif(btrim(p_data ->> 'actions_taken'), ''), 2000),
    recommendations = left(nullif(btrim(p_data ->> 'recommendations'), ''), 2000),
    notes = left(nullif(btrim(p_data ->> 'notes'), ''), 2000),
    readings = v_readings, parts = v_parts,
    resolved = nullif(p_data ->> 'resolved', '')::boolean,
    follow_up_needed = v_fu,
    follow_up_technician_id = case when v_fu then v_fu_tech end,
    follow_up_due = case when v_fu then v_fu_due end,
    follow_up_note = case when v_fu then left(nullif(btrim(p_data ->> 'follow_up_note'), ''), 1000) end,
    next_due_override = v_override,
    next_due_reason = case when v_override is not null then left(btrim(p_data ->> 'next_due_reason'), 1000) end,
    inspected_at = case when v_status = 'pending' then null else coalesce(inspected_at, now()) end,
    inspected_by = case when v_status = 'pending' then null else auth.uid() end,
    technician_id = case when v_status = 'pending' then technician_id else coalesce(app_private.my_technician(r.company_id), technician_id) end,
    version = version + 1, updated_by = auth.uid(), updated_at = now()
  where id = p_item returning version into v_ver;
  perform set_config('app.visit_work', '', true);
  return v_ver;
end $$;

-- إغلاق الزيارة: ينشئ سجلات الصيانة للأجهزة المفحوصة فقط، والمتابعات، ويحفظ النتيجة. متكرر الأمان.
create or replace function public.visit_close(p_visit uuid, p_exception_reason text default null, p_summary text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v record; r record; c record; v_kind text; v_item_kind text; v_fault uuid; v_user uuid; v_outcome text; v_followups integer := 0;
begin
  select * into v from public.visits where id = p_visit for update;
  if v.id is null or not app_private.visit_can_work(p_visit) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if v.closed_at is not null then return jsonb_build_object('already_closed', true, 'outcome', v.outcome); end if;
  if v.status = 'cancelled' then raise exception 'الزيارة ملغاة' using errcode = 'P0001'; end if;
  select count(*) total,
         count(*) filter (where inspection_status = 'pending') pending,
         count(*) filter (where inspection_status = 'inspected') inspected,
         count(*) filter (where inspection_status in ('unable', 'not_found')) skipped,
         count(*) filter (where inspection_status = 'inspected' and result <> 'pass') issues,
         count(*) filter (where follow_up_needed) followups
    into c from public.visit_devices where visit_id = p_visit;
  if c.total = 0 then raise exception 'لا توجد أجهزة في الزيارة' using errcode = 'P0001'; end if;
  if c.pending > 0 then
    if length(btrim(coalesce(p_exception_reason, ''))) < 5 then
      raise exception 'لا يمكن الإغلاق كمكتملة: % جهاز بلا نتيجة. سجّل نتيجة كل جهاز أو أغلق باستثناء موثق', c.pending using errcode = 'P0001';
    end if;
    if not public.company_has_perm(v.company_id, 'visits.close_exception') then
      raise exception 'الإغلاق باستثناء يتطلب صلاحية «إغلاق زيارة غير مكتملة»' using errcode = '42501';
    end if;
  end if;

  v_kind := case when v.visit_type = 'periodic' then 'periodic'
                 when v.urgent_reason in ('reinspection', 'follow_up') or v.visit_type = 'reinspection' then 'follow_up'
                 else 'corrective' end;
  perform set_config('app.visit_work', '1', true);
  for r in select * from public.visit_devices where visit_id = p_visit and inspection_status = 'inspected' and record_id is null order by inspected_at loop
    v_item_kind := v_kind;
    -- استحقاق الجهاز أُتم بطريق آخر بعد بدء الزيارة: لا يُتم استحقاقًا جديدًا مرتين
    if v_kind = 'periodic' and r.cycle_id is not null
       and not exists (select 1 from public.device_maintenance_cycles where id = r.cycle_id and status = 'open') then
      v_item_kind := 'follow_up';
    end if;
    if r.next_due_override is not null then
      perform set_config('app.due_source', 'visit_override', true);
      perform set_config('app.due_reason', r.next_due_reason, true);
    end if;
    insert into public.maintenance_records (id, company_id, device_id, visit_id, performed_at, action, result, status_after, kind,
      notes, next_due_at, readings, actions_taken, recommendations, findings, parts, condition_before, created_by)
    values (r.id, r.company_id, r.device_id, p_visit, r.inspected_at, r.action, r.result, r.status_after, v_item_kind,
      r.notes, case when v_item_kind = 'periodic' then r.next_due_override end, r.readings, r.actions_taken, r.recommendations,
      r.findings, r.parts, r.condition_before, coalesce(r.inspected_by, auth.uid()))
    on conflict (id) do nothing;
    perform set_config('app.due_source', '', true);
    perform set_config('app.due_reason', '', true);
    if r.technician_id is not null then
      insert into public.maintenance_record_technicians (record_id, technician_id, company_id) values (r.id, r.technician_id, r.company_id)
      on conflict do nothing;
    end if;
    update public.visit_devices set record_id = r.id where id = r.id;
  end loop;

  for r in select * from public.visit_devices where visit_id = p_visit and follow_up_needed and fault_id is null loop
    insert into public.device_faults (company_id, device_id, source, severity, description, kind, assigned_technician_id, follow_up_due, visit_id, reported_by, created_by)
    values (r.company_id, r.device_id, 'inspection', case when r.result = 'fail' or r.status_after in ('faulty', 'out_of_service') then 'high' else 'medium' end,
      left(coalesce(nullif(btrim(r.follow_up_note), ''), nullif(btrim(r.findings), ''), nullif(btrim(r.recommendations), ''), 'متابعة مطلوبة من الزيارة ' || coalesce(v.ref_no, '')), 2000),
      case when r.resolved is false then 'repair_request' else 'follow_up' end, r.follow_up_technician_id, r.follow_up_due, p_visit, auth.uid(), auth.uid())
    returning id into v_fault;
    update public.visit_devices set fault_id = v_fault where id = r.id;
    v_followups := v_followups + 1;
    select user_id into v_user from public.technicians where id = r.follow_up_technician_id;
    if v_user is not null and v_user is distinct from auth.uid() then
      perform app_private.notify(r.company_id, v_user, 'follow_up_assigned', 'متابعة مسندة إليك',
        'موعد المتابعة: ' || to_char(r.follow_up_due, 'YYYY-MM-DD'), '/faults/' || v_fault, 'fault', v_fault, 'followup:' || v_fault);
    end if;
  end loop;

  v_outcome := case when c.pending > 0 then 'incomplete'
                    when c.followups > 0 then 'follow_up_required'
                    when c.skipped > 0 or c.issues > 0 then 'completed_with_issues'
                    else 'completed' end;
  update public.visits set status = 'completed', actual_end = now(), closed_at = now(), closed_by = auth.uid(),
    close_exception_reason = case when c.pending > 0 then left(btrim(p_exception_reason), 1000) end,
    outcome = v_outcome, follow_up_status = case when c.followups > 0 then 'required' else follow_up_status end,
    summary = coalesce(left(nullif(btrim(p_summary), ''), 4000), summary)
  where id = p_visit;
  perform set_config('app.visit_work', '', true);
  perform public.company_audit(v.company_id, 'visit_closed', 'visit', v.id, jsonb_build_object('ref_no', v.ref_no, 'outcome', v_outcome,
    'devices', c.total, 'inspected', c.inspected, 'skipped', c.skipped, 'pending', c.pending, 'followups', v_followups,
    'exception', case when c.pending > 0 then left(btrim(p_exception_reason), 1000) end));
  return jsonb_build_object('already_closed', false, 'outcome', v_outcome, 'devices', c.total, 'inspected', c.inspected,
    'skipped', c.skipped, 'pending', c.pending, 'followups', v_followups);
end $$;

-- ---------------------------------------------------------------------
-- 7) الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.devices_due_guard(), app_private.devices_due_log(), app_private.visit_devices_guard(),
  app_private.visits_closed_guard(), app_private.attachments_visit_open(), app_private.maintenance_via_visit(), app_private.visit_fill_periodic(uuid),
  app_private.visit_add_items(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function app_private.visit_can_work(uuid), app_private.my_technician(uuid) from public, anon;
grant execute on function app_private.visit_can_work(uuid), app_private.my_technician(uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.device_set_next_due(uuid, date, text)', 'public.devices_set_schedule(uuid[], integer, date, boolean)',
    'public.visit_start(uuid, uuid, text, text, uuid[], text)', 'public.visit_add_devices(uuid, uuid[])', 'public.visit_remove_device(uuid)',
    'public.visit_save_item(uuid, jsonb, integer)', 'public.visit_close(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
