-- =====================================================================
-- التراجع عن 20261104000100_maintenance_schedule_alerts.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت دورات استحقاق مغلقة أو سجلات صيانة أو فترات بالأشهر أو إعدادات غير افتراضية بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_maintenance_cycles where status <> 'open')
     or exists (select 1 from public.maintenance_records where cycle_id is not null)
     or exists (select 1 from public.devices where maintenance_interval_months is not null)
     or exists (select 1 from public.companies where default_interval_months <> 3 or schedule_policy <> 'from_completion' or escalation_days <> 7)
     or exists (select 1 from public.safety_systems where default_interval_months is not null)
     or exists (select 1 from public.catalog_items where default_interval_months is not null) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات جدولة أُنشئت بعد الترحيل';
  end if;
end $$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'ays-maintenance-alerts') then perform cron.unschedule('ays-maintenance-alerts'); end if;
end $$;

drop function if exists app_private.run_maintenance_alerts_for(uuid, date);
drop function if exists app_private.company_followup_users(uuid);
drop function if exists app_private.riyadh_date(timestamptz);

CREATE OR REPLACE FUNCTION app_private.devices_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; s_customer uuid;
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.maintenance_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.maintenance_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.devices
     set last_maintenance_at = greatest(coalesce(last_maintenance_at, '-infinity'::date), (new.performed_at at time zone 'Asia/Riyadh')::date),
         next_maintenance_at = case when new.status_after = 'decommissioned' then null else new.next_due_at end,
         status = new.status_after
   where id = new.device_id
     and (last_maintenance_at is null or last_maintenance_at <= (new.performed_at at time zone 'Asia/Riyadh')::date);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app_private.run_maintenance_alerts_for(p_company uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
             select u.user_id from app_private.device_responsible_users(d.id) u loop
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
end $function$;
-- صلاحية التنفيذ كما كانت قبل الترحيل (postgres فقط)
revoke all on function app_private.run_maintenance_alerts_for(uuid) from public, anon, authenticated, service_role;

drop function if exists public.platform_maintenance_alert_runs();
drop function if exists app_private.cron_maintenance_alerts();
drop table if exists app_private.maintenance_alert_runs;
drop function if exists public.company_update_maintenance_settings(uuid, integer, text, integer, integer);
drop function if exists public.devices_set_schedule(uuid[], integer, date, boolean);
drop trigger if exists trg_devices_cycle_sync on public.devices;
drop function if exists app_private.devices_cycle_sync();
drop function if exists app_private.cycle_close(uuid, text, uuid, date);
drop function if exists app_private.cycle_open(uuid, date);
drop table if exists public.device_maintenance_cycles;
drop function if exists public.maintenance_due_status(date, integer);
drop function if exists app_private.compute_next_due(date, integer, integer, text, date, date);
drop function if exists app_private.add_months(date, integer);
alter table public.maintenance_records drop column if exists cycle_id;
alter table public.maintenance_records drop column if exists kind;
alter table public.catalog_items drop column if exists default_interval_months;
alter table public.safety_systems drop column if exists default_interval_months;
alter table public.devices drop column if exists schedule_start_date;
alter table public.devices drop column if exists maintenance_interval_months;
alter table public.companies drop column if exists escalation_days;
alter table public.companies drop column if exists schedule_policy;
alter table public.companies drop column if exists default_interval_months;
-- امتداد pg_cron يبقى مثبتًا (لا يضر)؛ أزيلت مهمته فقط

notify pgrst, 'reload schema';
