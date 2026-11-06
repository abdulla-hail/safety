-- =====================================================================
-- عين السلامة — الترحيل 3: سجل التدقيق والإشعارات والرسائل الخارجية
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) سجل التدقيق (لا يُعدَّل ولا يُحذف)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_ref text,
  summary text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

drop trigger if exists trg_audit_logs_block on public.audit_logs;
create trigger trg_audit_logs_block before update or delete on public.audit_logs
  for each row execute function app_private.block_change();

create or replace function app_private.log_audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_entity_ref text, p_summary text, p_changes jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, entity_ref, summary, changes)
  values (p_org, auth.uid(), p_action, p_entity_type, p_entity_id, p_entity_ref, p_summary, coalesce(p_changes, '{}'::jsonb));
$$;
revoke all on function app_private.log_audit(uuid, text, text, uuid, text, text, jsonb) from public;

-- مشغّل التدقيق العام: TG_ARGV[0] = نوع الكيان
create or replace function app_private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text;
  v_changes jsonb := '{}'::jsonb;
  k text;
  -- لا تُسجَّل الحقول التقنية؛ ولا توجد كلمات مرور أو مفاتيح في هذه الجداول.
  v_skip text[] := array['updated_at', 'created_at', 'last_alert_run_at'];
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_changes := v_old - v_skip;
  else
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any (v_skip)) and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    if v_changes ? 'archived_at' then
      v_action := case when (v_new ->> 'archived_at') is null then 'restore' else 'archive' end;
    elsif v_changes ? 'status' then
      v_action := 'status_change';
    else
      v_action := 'update';
    end if;
  end if;

  perform app_private.log_audit(
    coalesce((v_row ->> 'organization_id')::uuid, case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    v_action, tg_argv[0],
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    v_row ->> 'ref_no',
    coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', v_row ->> 'device_name_snapshot'),
    v_changes);
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
      ('organizations', 'organization'),
      ('customers', 'customer'),
      ('technicians', 'technician'),
      ('customer_sites', 'site'),
      ('safety_systems', 'safety_system'),
      ('catalog_items', 'catalog_item'),
      ('devices', 'device'),
      ('work_orders', 'work_order'),
      ('visits', 'visit'),
      ('maintenance_records', 'maintenance'),
      ('attachments', 'attachment')
    ) as v(tbl, entity)
  loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function app_private.audit_row(%2$L)', t.tbl, t.entity);
  end loop;
end $$;

-- تدقيق الإسناد (جداول ربط بلا معرّف مستقل)
create or replace function app_private.audit_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := to_jsonb(coalesce(new, old));
begin
  perform app_private.log_audit(
    (v ->> 'organization_id')::uuid,
    case when tg_op = 'INSERT' then 'assign' else 'unassign' end,
    tg_argv[0], null, null, null, v - array['created_at']);
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
      ('technician_customers', 'technician_customer'),
      ('work_order_technicians', 'work_order_technician'),
      ('visit_technicians', 'visit_technician'),
      ('work_order_devices', 'work_order_device')
    ) as v(tbl, entity)
  loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t.tbl);
    execute format('create trigger trg_%1$s_audit after insert or delete on public.%1$I
                    for each row execute function app_private.audit_link(%2$L)', t.tbl, t.entity);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) الإشعارات الداخلية
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text check (link is null or link ~ '^/[A-Za-z0-9/_\-?=&.%]*$'),
  entity_type text,
  entity_id uuid,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create unique index if not exists notifications_dedupe_key on public.notifications (recipient_user_id, dedupe_key)
  where dedupe_key is not null;

-- المستلم يستطيع فقط تعيين read_at
create or replace function app_private.notifications_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app_private.is_api_caller() and (
       (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')) then
    raise exception 'لا يمكن تعديل محتوى الإشعار' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_notifications_guard on public.notifications;
create trigger trg_notifications_guard before update on public.notifications
  for each row execute function app_private.notifications_guard();

create or replace function app_private.notify(
  p_org uuid, p_user uuid, p_kind text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  -- لا يُرسل للمستخدم إشعار عن فعل قام به بنفسه (إلا التنبيهات الآلية ذات مفتاح منع التكرار)
  if p_dedupe is null and p_user = auth.uid() then return; end if;
  insert into public.notifications (organization_id, recipient_user_id, kind, title, body, link, entity_type, entity_id, dedupe_key)
  values (p_org, p_user, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe)
  on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke all on function app_private.notify(uuid, uuid, text, text, text, text, text, uuid, text) from public;

-- إشعار جميع أعضاء الشركة الذين يملكون صلاحية معيّنة
create or replace function app_private.notify_perm_holders(
  p_org uuid, p_perm text, p_kind text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select distinct m.user_id from public.organization_members m
    join public.member_permissions mp on mp.member_id = m.id and mp.permission_key = p_perm
    where m.organization_id = p_org and m.status in ('active', 'approved')
      and (m.expires_at is null or m.expires_at > now())
  loop
    perform app_private.notify(p_org, r.user_id, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function app_private.notify_perm_holders(uuid, text, text, text, text, text, text, uuid, text) from public;

-- إسناد عميل ↔ فني
create or replace function app_private.notify_technician_customer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_customer text;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select name into v_customer from public.customers where id = new.customer_id;
  perform app_private.notify(new.organization_id, v_user, 'assignment',
    'تم إسناد عميل إليك', 'العميل: ' || coalesce(v_customer, ''),
    '/customers/' || new.customer_id, 'customer', new.customer_id);
  return null;
end $$;
drop trigger if exists trg_technician_customers_notify on public.technician_customers;
create trigger trg_technician_customers_notify after insert on public.technician_customers
  for each row execute function app_private.notify_technician_customer();

-- تعيين فني لأمر عمل
create or replace function app_private.notify_work_order_technician()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; w record;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select ref_no, title into w from public.work_orders where id = new.work_order_id;
  perform app_private.notify(new.organization_id, v_user, 'work_order_assigned',
    'تم تعيينك لأمر عمل ' || coalesce(w.ref_no, ''), w.title,
    '/work-orders/' || new.work_order_id, 'work_order', new.work_order_id);
  return null;
end $$;
drop trigger if exists trg_work_order_technicians_notify on public.work_order_technicians;
create trigger trg_work_order_technicians_notify after insert on public.work_order_technicians
  for each row execute function app_private.notify_work_order_technician();

-- تغيير حالة أمر العمل: يُشعر المنشئ والفنيين المعيّنين
create or replace function app_private.notify_work_order_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status is not distinct from old.status then return null; end if;
  for r in
    select new.created_by as user_id
    union
    select t.user_id from public.work_order_technicians wt
    join public.technicians t on t.id = wt.technician_id
    where wt.work_order_id = new.id and t.user_id is not null
  loop
    perform app_private.notify(new.organization_id, r.user_id, 'work_order_status',
      'تغيّرت حالة أمر العمل ' || coalesce(new.ref_no, ''), new.title,
      '/work-orders/' || new.id, 'work_order', new.id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_work_orders_notify_status on public.work_orders;
create trigger trg_work_orders_notify_status after update of status on public.work_orders
  for each row execute function app_private.notify_work_order_status();

-- تعيين فني لزيارة
create or replace function app_private.notify_visit_technician()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v record;
begin
  select user_id into v_user from public.technicians where id = new.technician_id;
  select ref_no, scheduled_start into v from public.visits where id = new.visit_id;
  perform app_private.notify(new.organization_id, v_user, 'visit_scheduled',
    'زيارة جديدة ' || coalesce(v.ref_no, ''),
    'الموعد: ' || to_char(v.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
    '/visits/' || new.visit_id, 'visit', new.visit_id);
  return null;
end $$;
drop trigger if exists trg_visit_technicians_notify on public.visit_technicians;
create trigger trg_visit_technicians_notify after insert on public.visit_technicians
  for each row execute function app_private.notify_visit_technician();

-- تعديل موعد زيارة
create or replace function app_private.notify_visit_reschedule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.scheduled_start is not distinct from old.scheduled_start then return null; end if;
  for r in
    select t.user_id from public.visit_technicians vt
    join public.technicians t on t.id = vt.technician_id
    where vt.visit_id = new.id and t.user_id is not null
  loop
    perform app_private.notify(new.organization_id, r.user_id, 'visit_rescheduled',
      'تعديل موعد الزيارة ' || coalesce(new.ref_no, ''),
      'الموعد الجديد: ' || to_char(new.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
      '/visits/' || new.id, 'visit', new.id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_visits_notify_reschedule on public.visits;
create trigger trg_visits_notify_reschedule after update of scheduled_start on public.visits
  for each row execute function app_private.notify_visit_reschedule();

-- ---------------------------------------------------------------------
-- 3) التنبيهات الآلية لمواعيد الصيانة (قابلة للتشغيل المتكرر دون تكرار الإشعارات)
-- ---------------------------------------------------------------------
create or replace function app_private.run_maintenance_alerts_for(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_days integer;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  n integer := 0;
  r record;
begin
  select maintenance_alert_days into v_days from public.organizations where id = p_org and status = 'approved';
  if v_days is null then return 0; end if;

  for d in
    select id, ref_no, name, customer_id, next_maintenance_at
    from public.devices
    where organization_id = p_org and archived_at is null and status <> 'decommissioned'
      and next_maintenance_at is not null and next_maintenance_at <= v_today + v_days
  loop
    -- المستلمون: أصحاب صلاحية عرض الأجهزة + الفنيون المسندون للعميل
    for r in
      select distinct m.user_id from public.organization_members m
      join public.member_permissions mp on mp.member_id = m.id and mp.permission_key = 'devices.view'
      where m.organization_id = p_org and m.status in ('active', 'approved') and (m.expires_at is null or m.expires_at > now())
      union
      select t.user_id from public.technician_customers tc
      join public.technicians t on t.id = tc.technician_id
      where tc.customer_id = d.customer_id and t.user_id is not null and t.archived_at is null
    loop
      if d.next_maintenance_at < v_today then
        perform app_private.notify(p_org, r.user_id, 'maintenance_overdue',
          'صيانة متأخرة: ' || d.name || ' (' || d.ref_no || ')',
          'كان موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'),
          '/devices/' || d.id, 'device', d.id,
          'overdue:' || d.id || ':' || d.next_maintenance_at);
      else
        perform app_private.notify(p_org, r.user_id, 'maintenance_due',
          'صيانة قادمة: ' || d.name || ' (' || d.ref_no || ')',
          'موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'),
          '/devices/' || d.id, 'device', d.id,
          'due:' || d.id || ':' || d.next_maintenance_at);
      end if;
      n := n + 1;
    end loop;
  end loop;

  update public.organizations set last_alert_run_at = now() where id = p_org;
  return n;
end $$;
revoke all on function app_private.run_maintenance_alerts_for(uuid) from public;

-- للاستدعاء من الواجهة: يشغّل الفحص لشركة المستخدم بحد أقصى مرة كل ساعة
create or replace function public.run_maintenance_alerts(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  if not public.is_org_member(p_org) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select last_alert_run_at into v_last from public.organizations where id = p_org;
  if v_last is not null and v_last > now() - interval '1 hour' then
    return 0;
  end if;
  return app_private.run_maintenance_alerts_for(p_org);
end $$;
revoke all on function public.run_maintenance_alerts(uuid) from public, anon;
grant execute on function public.run_maintenance_alerts(uuid) to authenticated;

-- للجدولة (pg_cron) فقط: يمر على جميع الشركات المعتمدة
create or replace function app_private.run_all_maintenance_alerts()
returns integer language plpgsql security definer set search_path = '' as $$
declare o record; n integer := 0;
begin
  for o in select id from public.organizations where status = 'approved' loop
    n := n + app_private.run_maintenance_alerts_for(o.id);
  end loop;
  return n;
end $$;
revoke all on function app_private.run_all_maintenance_alerts() from public, authenticated;

-- ---------------------------------------------------------------------
-- 4) الرسائل الخارجية (بنية فقط؛ لا يُرسل شيء ما لم يُهيأ مزود من الخادم)
-- ---------------------------------------------------------------------
create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  notification_id uuid references public.notifications(id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  recipient text not null,
  subject text,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  provider_ref text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outbound_messages_pending_idx on public.outbound_messages (status, next_attempt_at);
