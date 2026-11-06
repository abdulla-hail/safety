-- =====================================================================
-- عين السلامة — م4: جدولة الصيانة الدورية بالأشهر، دورات الاستحقاق، والتنبيهات الخلفية المجدولة (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) إعدادات الشركة: الفترة الافتراضية (3 أشهر)، سياسة الحساب (من تاريخ الإنجاز / ثابتة على تاريخ البداية)،
--    التنبيه المسبق (العمود القائم maintenance_alert_days بقيمته الحالية)، وأيام التصعيد الإداري (7).
-- 2) الجهاز: maintenance_interval_months (1–60) وschedule_start_date. الأجهزة القائمة تبقى على دورتها بالأيام
--    كما هي (لا يتغير أي موعد قائم)؛ الأجهزة الجديدة تأخذ فترة النموذج أو فترة النوع أو الافتراضي.
--    حساب الأشهر بتقويم ثابت (نهاية الشهر تُقصّ: 31 يناير + شهر = آخر فبراير)، والفترة الثابتة تُحسب من تاريخ البداية دائمًا فلا تنزاح.
-- 3) سجل الصيانة: نوع العملية kind (دورية/تصحيحية/متابعة/تركيب/أخرى). الدورية فقط تُتم الاستحقاق وتحسب الموعد القادم؛
--    الإصلاح لا يغيّر موعد الجهاز إلا إذا حُدد موعد جديد صراحة، ولا يمس بقية الأجهزة.
-- 4) device_maintenance_cycles: لكل استحقاق سجل (مفتوح/مكتمل/ملغى/مستبدل) بتاريخه وتاريخ إنجازه وأيام التأخير
--    وسجل الصيانة الذي عالجه؛ الاستحقاق المتأخر لا يُحذف.
-- 5) التنبيهات: مسبق، يوم الاستحقاق، تأخر (للفنيين حسب نطاق الإسناد)، تصعيد إداري بعد أيام التصعيد، وملخص يومي للإدارة؛
--    كلها بمفاتيح منع تكرار لكل استحقاق. تُشغَّل يوميًا عبر pg_cron (05:00 بتوقيت الرياض) مع سجل تشغيل.
--
-- لا يحذف ولا يعدّل أي صف قائم (إلا إضافة أعمدة بقيم افتراضية). لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الأعمدة والإعدادات
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists default_interval_months smallint not null default 3
  check (default_interval_months between 1 and 60);
alter table public.companies add column if not exists schedule_policy text not null default 'from_completion'
  check (schedule_policy in ('from_completion', 'fixed'));
alter table public.companies add column if not exists escalation_days smallint not null default 7
  check (escalation_days between 1 and 90);

alter table public.devices add column if not exists maintenance_interval_months smallint check (maintenance_interval_months between 1 and 60);
alter table public.devices add column if not exists schedule_start_date date;
alter table public.safety_systems add column if not exists default_interval_months smallint check (default_interval_months between 1 and 60);
alter table public.catalog_items add column if not exists default_interval_months smallint check (default_interval_months between 1 and 60);

alter table public.maintenance_records add column if not exists kind text
  check (kind in ('periodic', 'corrective', 'follow_up', 'installation', 'other'));
alter table public.maintenance_records add column if not exists cycle_id uuid;

-- ---------------------------------------------------------------------
-- 2) الحساب
-- ---------------------------------------------------------------------
create or replace function app_private.add_months(p_date date, p_months integer) returns date
language sql immutable set search_path = '' as $$ select (p_date + make_interval(months => p_months))::date $$;

-- الموعد القادم بعد إنجاز في p_done (أو عند بدء الجدول إذا p_done = null)
create or replace function app_private.compute_next_due(p_start date, p_months integer, p_days integer, p_policy text,
  p_done date, p_current_due date) returns date
language plpgsql immutable set search_path = '' as $$
declare k integer := 1; v_after date;
begin
  if p_months is null and p_days is null then return null; end if;
  if p_done is null then
    return case when p_months is not null then app_private.add_months(p_start, p_months) else p_start + p_days end;
  end if;
  if p_months is null then return p_done + p_days; end if;
  if p_policy = 'fixed' and p_start is not null then
    -- ثابتة: أول موعد على تقويم البداية بعد الإنجاز وبعد الاستحقاق الحالي (الإنجاز المبكر يغطي الاستحقاق الحالي)
    v_after := greatest(p_done, coalesce(p_current_due, p_done));
    while app_private.add_months(p_start, k * p_months) <= v_after and k < 2000 loop k := k + 1; end loop;
    return app_private.add_months(p_start, k * p_months);
  end if;
  return app_private.add_months(p_done, p_months);
end $$;

-- حالة الاستحقاق لعرضها وللتقارير
create or replace function public.maintenance_due_status(p_next date, p_alert_days integer) returns text
language sql stable set search_path = '' as $$
  select case
    when p_next is null then 'none'
    when p_next < (now() at time zone 'Asia/Riyadh')::date then 'overdue'
    when p_next = (now() at time zone 'Asia/Riyadh')::date then 'due'
    when p_next <= (now() at time zone 'Asia/Riyadh')::date + coalesce(p_alert_days, 14) then 'due_soon'
    else 'upcoming' end
$$;

-- ---------------------------------------------------------------------
-- 3) دورات الاستحقاق
-- ---------------------------------------------------------------------
create table if not exists public.device_maintenance_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  device_id uuid not null,
  customer_id uuid not null, site_id uuid,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled', 'superseded')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  completed_on date,
  completed_record_id uuid,
  days_late integer,
  constraint dmc_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict
);
create unique index if not exists device_maintenance_cycles_one_open on public.device_maintenance_cycles (device_id) where status = 'open';
create index if not exists device_maintenance_cycles_device_idx on public.device_maintenance_cycles (device_id, due_date desc);
create index if not exists device_maintenance_cycles_open_due_idx on public.device_maintenance_cycles (company_id, due_date) where status = 'open';

-- العمليات على الدورات من داخل القاعدة فقط
create or replace function app_private.cycle_open(p_device uuid, p_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d record; v uuid;
begin
  if p_due is null then return null; end if;
  select id, company_id, customer_id, site_id into d from public.devices where id = p_device;
  insert into public.device_maintenance_cycles (company_id, device_id, customer_id, site_id, due_date)
  values (d.company_id, d.id, d.customer_id, d.site_id, p_due) returning id into v;
  return v;
end $$;

create or replace function app_private.cycle_close(p_device uuid, p_status text, p_record uuid, p_done date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  update public.device_maintenance_cycles set status = p_status, closed_at = now(), completed_on = p_done, completed_record_id = p_record,
    days_late = case when p_status = 'completed' then greatest(0, p_done - due_date) end
  where device_id = p_device and status = 'open' returning id into v;
  return v;
end $$;

-- تغيير الموعد يدويًا (تعديل الجهاز أو تطبيق جدول جديد) يستبدل الاستحقاق المفتوح ويحفظ القديم
create or replace function app_private.devices_cycle_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.cycle_managed', true), '') <> '' then return null; end if;
  if tg_op = 'INSERT' then
    perform app_private.cycle_open(new.id, new.next_maintenance_at);
  elsif new.next_maintenance_at is distinct from old.next_maintenance_at then
    perform app_private.cycle_close(new.id, 'superseded', null, null);
    perform app_private.cycle_open(new.id, new.next_maintenance_at);
  elsif new.archived_at is not null and old.archived_at is null then
    perform app_private.cycle_close(new.id, 'cancelled', null, null);
  elsif new.archived_at is null and old.archived_at is not null and new.next_maintenance_at is not null
        and not exists (select 1 from public.device_maintenance_cycles where device_id = new.id and status = 'open') then
    perform app_private.cycle_open(new.id, new.next_maintenance_at);
  end if;
  if tg_op = 'UPDATE' and (new.site_id is distinct from old.site_id or new.customer_id is distinct from old.customer_id) then
    update public.device_maintenance_cycles set customer_id = new.customer_id, site_id = new.site_id where device_id = new.id and status = 'open';
  end if;
  return null;
end $$;
drop trigger if exists trg_devices_cycle_sync on public.devices;
create trigger trg_devices_cycle_sync after insert or update of next_maintenance_at, archived_at, site_id, customer_id on public.devices
  for each row execute function app_private.devices_cycle_sync();

-- الاستحقاقات القائمة: دورة مفتوحة لكل جهاز نشط له موعد (صفوف جديدة فقط)
insert into public.device_maintenance_cycles (company_id, device_id, customer_id, site_id, due_date)
select d.company_id, d.id, d.customer_id, d.site_id, d.next_maintenance_at from public.devices d
where d.archived_at is null and d.next_maintenance_at is not null and d.status <> 'decommissioned'
  and not exists (select 1 from public.device_maintenance_cycles x where x.device_id = d.id and x.status = 'open');

alter table public.device_maintenance_cycles enable row level security;
drop policy if exists ays_dmc_select on public.device_maintenance_cycles;
create policy ays_dmc_select on public.device_maintenance_cycles for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'devices'));
revoke all on public.device_maintenance_cycles from anon;
revoke insert, update, delete, truncate, references, trigger on public.device_maintenance_cycles from authenticated;
grant select on public.device_maintenance_cycles to authenticated;

-- ---------------------------------------------------------------------
-- 4) تسجيل الجهاز: الفترة الافتراضية وتاريخ بداية الجدول
-- ---------------------------------------------------------------------
create or replace function app_private.devices_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; s_customer uuid; v_policy text;
begin
  if tg_op = 'UPDATE' and new.qr_token is distinct from old.qr_token then
    raise exception 'لا يمكن تغيير رمز الجهاز' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and app_private.is_client_request() and coalesce(current_setting('app.device_move', true), '') = ''
     and (new.site_id is distinct from old.site_id or new.customer_id is distinct from old.customer_id) then
    raise exception 'تغيير موقع الجهاز أو عميله يتم بإجراء «نقل الجهاز» فقط حتى يُحفظ سجل النقل' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.site_id is null and app_private.is_client_request() then
    raise exception 'حدد موقع الجهاز لدى العميل' using errcode = '23514';
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
      if new.maintenance_interval_months is null and new.maintenance_interval_days is null then
        new.maintenance_interval_months := c.default_interval_months;
        if new.maintenance_interval_months is null then new.maintenance_interval_days := c.default_interval_days; end if;
      end if;
    end if;
    if new.maintenance_interval_months is null and new.maintenance_interval_days is null and new.system_id is not null then
      select default_interval_months, default_interval_days into c from public.safety_systems where id = new.system_id;
      new.maintenance_interval_months := c.default_interval_months;
      if new.maintenance_interval_months is null then new.maintenance_interval_days := c.default_interval_days; end if;
    end if;
    if new.maintenance_interval_months is null and new.maintenance_interval_days is null then
      select default_interval_months into new.maintenance_interval_months from public.companies where id = new.company_id;
    end if;
    new.schedule_start_date := coalesce(new.schedule_start_date, new.installed_at, (now() at time zone 'Asia/Riyadh')::date);
    if new.next_maintenance_at is null then
      select schedule_policy into v_policy from public.companies where id = new.company_id;
      new.next_maintenance_at := app_private.compute_next_due(new.schedule_start_date, new.maintenance_interval_months,
        new.maintenance_interval_days, v_policy, new.last_maintenance_at, null);
    end if;
    insert into app_private.device_tokens (token, device_id, company_id) values (new.qr_token, new.id, new.company_id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5) الصيانة: الدورية فقط تُتم الاستحقاق
-- ---------------------------------------------------------------------
create or replace function app_private.maintenance_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record; v_policy text;
begin
  select * into d from public.devices where id = new.device_id;
  new.customer_id := d.customer_id;
  new.site_id := d.site_id;
  new.device_ref_snapshot := d.ref_no;
  new.device_name_snapshot := d.name;
  new.catalog_snapshot := jsonb_build_object('catalog_item_id', d.catalog_item_id, 'system_id', d.system_id,
    'manufacturer', d.manufacturer, 'model', d.model, 'serial_number', d.serial_number);
  new.kind := coalesce(new.kind, case
    when new.action in ('inspection', 'test', 'cleaning', 'refill') then 'periodic'
    when new.action in ('repair', 'part_replacement') then 'corrective'
    when new.action = 'installation' then 'installation'
    else 'other' end);
  if new.kind = 'periodic' then
    select id into new.cycle_id from public.device_maintenance_cycles where device_id = d.id and status = 'open';
  end if;
  if new.status_after = 'decommissioned' then
    new.next_due_at := null;
  elsif new.kind = 'periodic' and new.next_due_at is null then
    select schedule_policy into v_policy from public.companies where id = d.company_id;
    new.next_due_at := app_private.compute_next_due(coalesce(d.schedule_start_date, d.installed_at), d.maintenance_interval_months,
      d.maintenance_interval_days, v_policy, (new.performed_at at time zone 'Asia/Riyadh')::date, d.next_maintenance_at);
  end if;
  -- غير الدورية لا تمس الموعد إلا بموعد جديد صريح (next_due_at)
  return new;
end $$;

create or replace function app_private.maintenance_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_day date := (new.performed_at at time zone 'Asia/Riyadh')::date; v_latest boolean;
begin
  select last_maintenance_at is null or last_maintenance_at <= v_day into v_latest from public.devices where id = new.device_id;
  if not v_latest then return new; end if; -- تسجيل عملية أقدم من آخر صيانة لا يغيّر الحالة الحالية
  perform set_config('app.cycle_managed', '1', true);
  if new.status_after = 'decommissioned' then
    perform app_private.cycle_close(new.device_id, 'cancelled', new.id, v_day);
    update public.devices set status = new.status_after, next_maintenance_at = null where id = new.device_id;
  elsif new.kind = 'periodic' then
    perform app_private.cycle_close(new.device_id, 'completed', new.id, v_day);
    update public.devices set status = new.status_after, next_maintenance_at = new.next_due_at,
      last_maintenance_at = greatest(coalesce(last_maintenance_at, '-infinity'::date), v_day) where id = new.device_id;
    perform app_private.cycle_open(new.device_id, new.next_due_at);
  elsif new.next_due_at is not null then
    perform app_private.cycle_close(new.device_id, 'superseded', null, null);
    update public.devices set status = new.status_after, next_maintenance_at = new.next_due_at where id = new.device_id;
    perform app_private.cycle_open(new.device_id, new.next_due_at);
  else
    update public.devices set status = new.status_after where id = new.device_id;
  end if;
  perform set_config('app.cycle_managed', '', true);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6) ضبط الجدول لمجموعة أجهزة (لا يغيّر المواعيد القائمة إلا بطلب صريح)
-- ---------------------------------------------------------------------
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
  for d in select * from public.devices where id = any (p_devices) and archived_at is null for update loop
    update public.devices set maintenance_interval_months = p_months,
      schedule_start_date = coalesce(p_start, schedule_start_date, installed_at, (now() at time zone 'Asia/Riyadh')::date),
      next_maintenance_at = case when p_recalculate and status <> 'decommissioned' then
        app_private.compute_next_due(coalesce(p_start, schedule_start_date, installed_at, (now() at time zone 'Asia/Riyadh')::date),
          p_months, null, v_policy, last_maintenance_at, null) else next_maintenance_at end
    where id = d.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- إعدادات الصيانة للشركة (مدير الشركة)
create or replace function public.company_update_maintenance_settings(p_company uuid, p_default_months integer, p_policy text,
  p_alert_days integer, p_escalation_days integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old record;
begin
  perform public.require_company_manager(p_company);
  if p_default_months not between 1 and 60 then raise exception 'الفترة الافتراضية بين شهر و60 شهرًا' using errcode = '22023'; end if;
  if p_policy not in ('from_completion', 'fixed') then raise exception 'سياسة غير صالحة' using errcode = '22023'; end if;
  if p_alert_days not between 1 and 90 then raise exception 'التنبيه المسبق بين يوم و90 يومًا' using errcode = '22023'; end if;
  if p_escalation_days not between 1 and 90 then raise exception 'أيام التصعيد بين يوم و90 يومًا' using errcode = '22023'; end if;
  select default_interval_months, schedule_policy, maintenance_alert_days, escalation_days into v_old from public.companies where id = p_company;
  update public.companies set default_interval_months = p_default_months, schedule_policy = p_policy,
    maintenance_alert_days = p_alert_days, escalation_days = p_escalation_days where id = p_company;
  perform public.company_audit(p_company, 'maintenance_settings', 'company', p_company, jsonb_build_object('before', to_jsonb(v_old),
    'after', jsonb_build_object('default_interval_months', p_default_months, 'schedule_policy', p_policy, 'maintenance_alert_days', p_alert_days, 'escalation_days', p_escalation_days)));
end $$;

-- ---------------------------------------------------------------------
-- 7) التنبيهات
-- ---------------------------------------------------------------------
create table if not exists app_private.maintenance_alert_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  companies integer, notifications integer,
  error text
);

-- «اليوم» بتوقيت الرياض (بلا توقيت صيفي)؛ كل حساب للاستحقاق ومفاتيح منع التكرار يعتمد عليه
create or replace function app_private.riyadh_date(p_at timestamptz default now()) returns date
language sql stable set search_path = '' as $$ select (p_at at time zone 'Asia/Riyadh')::date $$;

-- إدارة المتابعة: أعضاء الشركة النشطون الذين يملكون إسناد الفنيين (مدير الشركة، والمشرف افتراضيًا)
create or replace function app_private.company_followup_users(p_company uuid) returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select mm.user_id from public.company_memberships mm
  where mm.company_id = p_company and mm.status = 'active'
    and 'assignments.manage' = any (public.company_effective_permissions(mm.role, mm.permissions))
$$;

-- p_today لاختبار تعاقب الأيام فقط؛ التشغيل الفعلي يستخدم تاريخ الرياض الحالي.
-- التوزيع: الفني (حسب نطاق الإسناد) والإدارة يتلقيان إشعارًا لكل جهاز متأخر؛ الإدارة تتلقى تصعيدًا إضافيًا لكل جهاز
-- بلغ تأخره حد التصعيد، وملخصًا يوميًا واحدًا. كل إشعار بمفتاح منع تكرار لكل استحقاق (أو لكل يوم للملخص)،
-- فإعادة التشغيل أو تكرار المهمة لا تكرر الإشعار، ومن كان فنيًا ومديرًا معًا يتلقى إشعار الجهاز مرة واحدة.
drop function if exists app_private.run_maintenance_alerts_for(uuid);
create or replace function app_private.run_maintenance_alerts_for(p_company uuid, p_today date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  co record; y record; r record;
  v_today date := coalesce(p_today, app_private.riyadh_date()); v_days integer; n integer := 0;
  v_overdue integer; v_today_n integer; v_soon integer; v_esc integer;
begin
  select id, maintenance_alert_days, escalation_days into co from public.companies where id = p_company and status = 'active';
  if co.id is null then return 0; end if;
  for y in select x.id cycle_id, x.due_date, d.id, d.ref_no, d.name from public.device_maintenance_cycles x
           join public.devices d on d.id = x.device_id
           where x.company_id = p_company and x.status = 'open' and d.archived_at is null and d.status <> 'decommissioned'
             and x.due_date <= v_today + co.maintenance_alert_days loop
    v_days := y.due_date - v_today;
    -- الفنيون: مسبق / يوم الاستحقاق / تأخر — لكل جهاز ضمن نطاقهم
    for r in select u.user_id from app_private.device_responsible_users(y.id) u loop
      if v_days > 0 then
        perform app_private.notify(p_company, r.user_id, 'maintenance_due_soon', 'صيانة قادمة: ' || y.name || ' (' || y.ref_no || ')',
          'موعد الصيانة ' || to_char(y.due_date, 'YYYY-MM-DD') || ' — بعد ' || v_days || ' يوم', '/devices/' || y.id, 'device', y.id, 'soon:' || y.cycle_id);
      elsif v_days = 0 then
        perform app_private.notify(p_company, r.user_id, 'maintenance_due_today', 'صيانة مستحقة اليوم: ' || y.name || ' (' || y.ref_no || ')',
          'موعد الصيانة اليوم ' || to_char(y.due_date, 'YYYY-MM-DD'), '/devices/' || y.id, 'device', y.id, 'today:' || y.cycle_id);
      end if;
      n := n + 1;
    end loop;
    if v_days < 0 then
      -- التأخر: لكل جهاز، للفنيين المسؤولين وللإدارة (مفتاح واحد لكل استحقاق ومتلقٍ)
      for r in select u.user_id from app_private.device_responsible_users(y.id) u
               union select f.user_id from app_private.company_followup_users(p_company) f loop
        perform app_private.notify(p_company, r.user_id, 'maintenance_overdue', 'صيانة متأخرة: ' || y.name || ' (' || y.ref_no || ')',
          'كان موعد الصيانة ' || to_char(y.due_date, 'YYYY-MM-DD') || ' — متأخرة ' || (-v_days) || ' يوم', '/devices/' || y.id, 'device', y.id, 'overdue:' || y.cycle_id);
        n := n + 1;
      end loop;
    end if;
    if v_days <= -co.escalation_days then
      for r in select f.user_id from app_private.company_followup_users(p_company) f loop
        perform app_private.notify(p_company, r.user_id, 'maintenance_escalation', 'تصعيد: صيانة متأخرة ' || (-v_days) || ' يوم — ' || y.name,
          'الجهاز ' || y.ref_no || ' كان موعده ' || to_char(y.due_date, 'YYYY-MM-DD') || ' وتجاوز حد التصعيد (' || co.escalation_days || ' يوم) دون استكمال صيانته.',
          '/devices/' || y.id, 'device', y.id, 'escalate:' || y.cycle_id);
        n := n + 1;
      end loop;
    end if;
  end loop;

  -- ملخص يومي واحد للإدارة بتاريخ الرياض
  select count(*) filter (where x.due_date < v_today), count(*) filter (where x.due_date = v_today),
         count(*) filter (where x.due_date > v_today), count(*) filter (where x.due_date <= v_today - co.escalation_days)
    into v_overdue, v_today_n, v_soon, v_esc
  from public.device_maintenance_cycles x join public.devices d on d.id = x.device_id
  where x.company_id = p_company and x.status = 'open' and d.archived_at is null and d.status <> 'decommissioned'
    and x.due_date <= v_today + co.maintenance_alert_days;
  if v_overdue + v_today_n + v_soon > 0 then
    for r in select f.user_id from app_private.company_followup_users(p_company) f loop
      perform app_private.notify(p_company, r.user_id, 'maintenance_digest', 'ملخص الصيانة — ' || to_char(v_today, 'YYYY-MM-DD'),
        'متأخرة: ' || v_overdue || ' (تجاوزت حد التصعيد: ' || v_esc || ') · مستحقة اليوم: ' || v_today_n || ' · خلال ' || co.maintenance_alert_days || ' يومًا: ' || v_soon,
        '/reports/maintenance-due', 'company', p_company, 'digest:' || to_char(v_today, 'YYYY-MM-DD'));
      n := n + 1;
    end loop;
  end if;
  update public.companies set last_alert_run_at = now() where id = p_company;
  return n;
end $$;

create or replace function app_private.cron_maintenance_alerts() returns void
language plpgsql security definer set search_path = '' as $$
declare v_run bigint; o record; n integer := 0; k integer := 0;
begin
  insert into app_private.maintenance_alert_runs default values returning id into v_run;
  begin
    for o in select id from public.companies where status = 'active' loop
      n := n + app_private.run_maintenance_alerts_for(o.id); k := k + 1;
    end loop;
    update app_private.maintenance_alert_runs set finished_at = now(), companies = k, notifications = n where id = v_run;
  exception when others then
    update app_private.maintenance_alert_runs set finished_at = now(), companies = k, notifications = n, error = sqlerrm where id = v_run;
  end;
end $$;

-- آخر تشغيلات المهمة لمالك المنصة (للتحقق من عمل الجدولة)
create or replace function public.platform_maintenance_alert_runs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from
    (select started_at, finished_at, companies, notifications, error from app_private.maintenance_alert_runs order by started_at desc limit 14) r), '[]'::jsonb);
end $$;

create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ays-maintenance-alerts') then perform cron.unschedule('ays-maintenance-alerts'); end if;
  -- 02:00 UTC = 05:00 بتوقيت الرياض
  perform cron.schedule('ays-maintenance-alerts', '0 2 * * *', 'select app_private.cron_maintenance_alerts()');
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function app_private.cycle_open(uuid, date), app_private.cycle_close(uuid, text, uuid, date), app_private.devices_cycle_sync(),
  app_private.cron_maintenance_alerts() from public, anon, authenticated;
revoke all on function app_private.add_months(date, integer), app_private.compute_next_due(date, integer, integer, text, date, date) from public, anon;
grant execute on function app_private.add_months(date, integer), app_private.compute_next_due(date, integer, integer, text, date, date) to authenticated;
revoke all on table app_private.maintenance_alert_runs from public, anon, authenticated;
revoke all on function app_private.run_maintenance_alerts_for(uuid, date), app_private.company_followup_users(uuid), app_private.riyadh_date(timestamptz) from public, anon, authenticated, service_role;
do $$ declare f text; begin
  foreach f in array array['public.maintenance_due_status(date, integer)', 'public.devices_set_schedule(uuid[], integer, date, boolean)',
    'public.company_update_maintenance_settings(uuid, integer, text, integer, integer)', 'public.platform_maintenance_alert_runs()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
