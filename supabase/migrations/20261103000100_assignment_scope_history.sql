-- =====================================================================
-- عين السلامة — م3: نطاق إسناد الفنيين وتاريخه، والفني الأساسي، وحماية المرفقات (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) technician_customer_sites: تضييق إسناد (فني↔عميل) إلى مواقع محددة. إسناد بلا مواقع = العميل كاملًا (السلوك الحالي).
--    الفني المسند لمواقع محددة يرى العميل، ومواقعه المسندة فقط وأجهزتها وزياراتها وسجلات صيانتها وأوامر عملها.
-- 2) فني أساسي واحد لكل عميل (is_primary)؛ تعيين فني آخر لزيارة/أمر عمل محدد لا يغيّره (visit_technicians/work_order_technicians).
-- 3) technician_assignment_events: سجل دائم لكل إسناد/إلغاء/تغيير أساسي/تغيير نطاق، بالمنفّذ والتاريخ والسبب.
--    يُملأ للإسنادات القائمة بحدث «إسناد» بتاريخ إنشائها (صفوف جديدة فقط؛ لا يُعدَّل صف قائم).
-- 4) سياسات القراءة للمواقع/الأجهزة/الزيارات/الصيانة/أوامر العمل/سجل النقل وrésolve_device_token تحترم نطاق الموقع.
-- 5) إصلاح: كان أي فني (field.assigned) يقرأ كل مرفقات الشركة؛ صار يقرأ مرفقات السجلات التي يراها فقط.
-- 6) تنبيهات الصيانة تصل لفنيي نطاق الجهاز (العميل كاملًا أو موقع الجهاز) والإدارة.
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) نطاق المواقع
-- ---------------------------------------------------------------------
create table if not exists public.technician_customer_sites (
  assignment_id uuid not null references public.technician_customers(id) on delete cascade,
  site_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  created_by uuid, created_at timestamptz not null default now(),
  primary key (assignment_id, site_id),
  constraint tcs_site_fk foreign key (site_id, company_id) references public.customer_sites (id, company_id) on delete restrict
);
create index if not exists technician_customer_sites_site_idx on public.technician_customer_sites (site_id);

create or replace function app_private.tcs_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.technician_customers; s_customer uuid;
begin
  select * into a from public.technician_customers where id = new.assignment_id;
  select customer_id into s_customer from public.customer_sites where id = new.site_id;
  if a.id is null or s_customer is distinct from a.customer_id or a.company_id <> new.company_id then
    raise exception 'الموقع لا يتبع عميل الإسناد' using errcode = '23514';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
drop trigger if exists trg_tcs_before_insert on public.technician_customer_sites;
create trigger trg_tcs_before_insert before insert on public.technician_customer_sites
  for each row execute function app_private.tcs_before_insert();

-- فني أساسي واحد لكل عميل
create unique index if not exists technician_customers_one_primary on public.technician_customers (customer_id) where is_primary;

-- ---------------------------------------------------------------------
-- 2) سجل أحداث الإسناد
-- ---------------------------------------------------------------------
create table if not exists public.technician_assignment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  technician_id uuid not null,
  customer_id uuid not null,
  site_id uuid,
  event text not null check (event in ('assigned', 'unassigned', 'primary_set', 'primary_cleared', 'site_added', 'site_removed')),
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint tae_tech_fk foreign key (technician_id, company_id) references public.technicians (id, company_id) on delete restrict,
  constraint tae_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict
);
create index if not exists technician_assignment_events_customer_idx on public.technician_assignment_events (customer_id, occurred_at desc);
create index if not exists technician_assignment_events_tech_idx on public.technician_assignment_events (technician_id, occurred_at desc);
drop trigger if exists trg_tae_block on public.technician_assignment_events;
create trigger trg_tae_block before update or delete on public.technician_assignment_events
  for each row execute function app_private.block_change();

create or replace function app_private.log_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(current_setting('app.assignment_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.technician_assignment_events (company_id, technician_id, customer_id, event, actor_id, reason)
    values (new.company_id, new.technician_id, new.customer_id, 'assigned', auth.uid(), v_reason);
    if new.is_primary then
      insert into public.technician_assignment_events (company_id, technician_id, customer_id, event, actor_id, reason)
      values (new.company_id, new.technician_id, new.customer_id, 'primary_set', auth.uid(), v_reason);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_primary is distinct from old.is_primary then
      insert into public.technician_assignment_events (company_id, technician_id, customer_id, event, actor_id, reason)
      values (new.company_id, new.technician_id, new.customer_id, case when new.is_primary then 'primary_set' else 'primary_cleared' end, auth.uid(), v_reason);
    end if;
  else
    insert into public.technician_assignment_events (company_id, technician_id, customer_id, event, actor_id, reason)
    values (old.company_id, old.technician_id, old.customer_id, 'unassigned', auth.uid(), v_reason);
  end if;
  return null;
end $$;
drop trigger if exists trg_technician_customers_events on public.technician_customers;
create trigger trg_technician_customers_events after insert or update or delete on public.technician_customers
  for each row execute function app_private.log_assignment();

create or replace function app_private.log_assignment_site() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record; r record := coalesce(new, old);
begin
  select technician_id, customer_id into a from public.technician_customers where id = r.assignment_id;
  if a.technician_id is null then return null; end if; -- حذف الإسناد كاملًا يُسجَّل «إلغاء» مرة واحدة
  insert into public.technician_assignment_events (company_id, technician_id, customer_id, site_id, event, actor_id, reason)
  values (r.company_id, a.technician_id, a.customer_id, r.site_id, case when tg_op = 'INSERT' then 'site_added' else 'site_removed' end,
          auth.uid(), nullif(current_setting('app.assignment_reason', true), ''));
  return null;
end $$;
drop trigger if exists trg_tcs_events on public.technician_customer_sites;
create trigger trg_tcs_events after insert or delete on public.technician_customer_sites
  for each row execute function app_private.log_assignment_site();

-- الإسنادات القائمة: حدث «إسناد» بتاريخها الأصلي (صفوف جديدة في سجل الأحداث فقط)
insert into public.technician_assignment_events (company_id, technician_id, customer_id, event, actor_id, occurred_at, reason)
select tc.company_id, tc.technician_id, tc.customer_id, 'assigned', tc.created_by, tc.created_at, 'قائم قبل تفعيل سجل الإسناد'
from public.technician_customers tc
where not exists (select 1 from public.technician_assignment_events e where e.technician_id = tc.technician_id and e.customer_id = tc.customer_id);

-- ---------------------------------------------------------------------
-- 3) الإجراءات
-- ---------------------------------------------------------------------
-- إسناد فني لعميل كاملًا (p_sites فارغة) أو لمواقع محددة؛ يستبدل نطاق المواقع إن كان الإسناد قائمًا
create or replace function public.assignment_set(p_technician uuid, p_customer uuid, p_sites uuid[] default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.technicians; c public.customers; v_id uuid; s uuid; v_sites uuid[] := coalesce(p_sites, '{}');
begin
  select * into t from public.technicians where id = p_technician;
  select * into c from public.customers where id = p_customer;
  if t.id is null or c.id is null or t.company_id <> c.company_id then raise exception 'الفني أو العميل غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(c.company_id, 'assignments.manage') then raise exception 'ليست لديك صلاحية الإسناد' using errcode = '42501'; end if;
  if t.archived_at is not null or not t.is_active then raise exception 'الفني غير نشط' using errcode = 'P0001'; end if;
  if c.archived_at is not null then raise exception 'العميل مؤرشف' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_sites) x where not exists (
      select 1 from public.customer_sites cs where cs.id = x and cs.customer_id = p_customer and cs.archived_at is null)) then
    raise exception 'أحد المواقع لا يتبع العميل أو مؤرشف' using errcode = '23514';
  end if;
  perform set_config('app.assignment_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  insert into public.technician_customers (company_id, technician_id, customer_id) values (c.company_id, p_technician, p_customer)
  on conflict (technician_id, customer_id) do nothing;
  select id into v_id from public.technician_customers where technician_id = p_technician and customer_id = p_customer;
  delete from public.technician_customer_sites where assignment_id = v_id and not (site_id = any (v_sites));
  foreach s in array v_sites loop
    insert into public.technician_customer_sites (assignment_id, site_id, company_id) values (v_id, s, c.company_id) on conflict do nothing;
  end loop;
  perform set_config('app.assignment_reason', '', true);
  return v_id;
end $$;

create or replace function public.assignment_remove(p_technician uuid, p_customer uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.technician_customers;
begin
  select * into a from public.technician_customers where technician_id = p_technician and customer_id = p_customer;
  if a.id is null then raise exception 'الإسناد غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(a.company_id, 'assignments.manage') then raise exception 'ليست لديك صلاحية الإسناد' using errcode = '42501'; end if;
  perform set_config('app.assignment_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  delete from public.technician_customers where id = a.id;
  perform set_config('app.assignment_reason', '', true);
end $$;

-- الفني الأساسي للعميل (يجب أن يكون مسندًا للعميل كاملًا)؛ null = بلا فني أساسي
create or replace function public.assignment_set_primary(p_customer uuid, p_technician uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers; a public.technician_customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'العميل غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(c.company_id, 'assignments.manage') then raise exception 'ليست لديك صلاحية الإسناد' using errcode = '42501'; end if;
  if p_technician is not null then
    select * into a from public.technician_customers where customer_id = p_customer and technician_id = p_technician;
    if a.id is null then raise exception 'أسند الفني للعميل أولًا' using errcode = 'P0001'; end if;
    if exists (select 1 from public.technician_customer_sites where assignment_id = a.id) then
      raise exception 'الفني الأساسي يكون مسندًا للعميل كاملًا لا لمواقع محددة' using errcode = 'P0001';
    end if;
  end if;
  perform set_config('app.assignment_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  update public.technician_customers set is_primary = false where customer_id = p_customer and is_primary and technician_id is distinct from p_technician;
  if p_technician is not null then
    update public.technician_customers set is_primary = true where id = a.id and not is_primary;
  end if;
  perform set_config('app.assignment_reason', '', true);
end $$;

-- تضييق الإسناد لمواقع يجعل الفني غير مؤهل ليكون أساسيًا
create or replace function app_private.tcs_clear_primary() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.technician_customers set is_primary = false where id = new.assignment_id and is_primary;
  return null;
end $$;
drop trigger if exists trg_tcs_clear_primary on public.technician_customer_sites;
create trigger trg_tcs_clear_primary after insert on public.technician_customer_sites
  for each row execute function app_private.tcs_clear_primary();

-- ---------------------------------------------------------------------
-- 4) الرؤية حسب نطاق الموقع
-- ---------------------------------------------------------------------
-- الفني يرى السجل إن كان مسندًا للعميل كاملًا، أو لموقع السجل نفسه (سجل بلا موقع: للمسند للعميل كاملًا فقط)
create or replace function app_private.is_assigned_site(p_company uuid, p_customer uuid, p_site uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
    where tc.company_id = p_company and tc.customer_id = p_customer and t.user_id = auth.uid() and t.archived_at is null
      and (not exists (select 1 from public.technician_customer_sites s where s.assignment_id = tc.id)
           or (p_site is not null and exists (select 1 from public.technician_customer_sites s where s.assignment_id = tc.id and s.site_id = p_site))))
$$;

create or replace function public.company_can_view_site(p_company uuid, p_customer uuid, p_site uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.company_has_perm(p_company, p_module || '.view')
      or (public.company_has_perm(p_company, 'field.assigned') and app_private.is_assigned_site(p_company, p_customer, p_site))
$$;

drop policy if exists ays_customer_sites_select on public.customer_sites;
create policy ays_customer_sites_select on public.customer_sites for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, id, 'sites'));
drop policy if exists ays_devices_select on public.devices;
create policy ays_devices_select on public.devices for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'devices'));
drop policy if exists ays_mr_select on public.maintenance_records;
create policy ays_mr_select on public.maintenance_records for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'maintenance'));
drop policy if exists ays_visits_select on public.visits;
create policy ays_visits_select on public.visits for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'visits') or (public.company_is_member(company_id) and app_private.is_assigned_visit(id)));
drop policy if exists ays_wo_select on public.work_orders;
create policy ays_wo_select on public.work_orders for select to authenticated
  using (public.company_can_view_site(company_id, customer_id, site_id, 'work_orders') or (public.company_is_member(company_id) and app_private.is_assigned_work_order(id)));
drop policy if exists ays_dt_select on public.device_transfers;
create policy ays_dt_select on public.device_transfers for select to authenticated using (
  (select public.company_has_perm(company_id, 'devices.view'))
  or (from_customer_id = to_customer_id and (select public.company_has_perm(company_id, 'field.assigned'))
      and app_private.is_assigned_site(company_id, to_customer_id, to_site_id)));

alter table public.technician_customer_sites enable row level security;
alter table public.technician_assignment_events enable row level security;
drop policy if exists ays_tcs_select on public.technician_customer_sites;
create policy ays_tcs_select on public.technician_customer_sites for select to authenticated using (
  public.company_has_any_perm(company_id, array['assignments.manage', 'customers.view', 'technicians.view'])
  or exists (select 1 from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
             where tc.id = assignment_id and t.user_id = auth.uid()));
drop policy if exists ays_tae_select on public.technician_assignment_events;
create policy ays_tae_select on public.technician_assignment_events for select to authenticated using (
  public.company_has_any_perm(company_id, array['assignments.manage', 'technicians.view'])
  or exists (select 1 from public.technicians t where t.id = technician_id and t.user_id = auth.uid()));
revoke all on public.technician_customer_sites, public.technician_assignment_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.technician_customer_sites, public.technician_assignment_events from authenticated;
grant select on public.technician_customer_sites, public.technician_assignment_events to authenticated;

-- QR: الفني المسند لموقع يفتح أجهزة ذلك الموقع فقط
create or replace function public.resolve_device_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d record; v_token text := upper(btrim(p_token));
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthenticated'); end if;
  if v_token !~ '^[A-Z0-9]{8,32}$' then return jsonb_build_object('status', 'invalid'); end if;
  select id, company_id, customer_id, site_id, archived_at into d from public.devices where qr_token = v_token;
  if d.id is null then
    if exists (select 1 from app_private.device_tokens where token = v_token) then return jsonb_build_object('status', 'removed'); end if;
    return jsonb_build_object('status', 'not_found');
  end if;
  if not public.company_can_view_site(d.company_id, d.customer_id, d.site_id, 'devices') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'device_id', d.id, 'organization_id', d.company_id, 'archived', d.archived_at is not null);
end $$;

-- ---------------------------------------------------------------------
-- 5) المرفقات: الفني يقرأ مرفقات ما يراه فقط (تُقيَّم بصلاحيات المستدعي فتطبَّق RLS للجدول المعني)
-- ---------------------------------------------------------------------
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
    else false end;
end $$;
drop policy if exists ays_attachments_select on public.attachments;
create policy ays_attachments_select on public.attachments for select to authenticated using (
  public.company_has_perm(company_id, app_private.attachment_module(entity_type) || '.view')
  or (public.company_has_perm(company_id, 'field.assigned') and app_private.attachment_entity_visible(entity_type, entity_id)));

-- ---------------------------------------------------------------------
-- 6) مستلمو تنبيهات الجهاز: الإدارة (devices.view) + فنيو نطاقه
-- ---------------------------------------------------------------------
create or replace function app_private.device_responsible_users(p_device uuid) returns table (user_id uuid, is_technician boolean)
language sql stable security definer set search_path = '' as $$
  with d as (select id, company_id, customer_id, site_id from public.devices where id = p_device)
  select distinct t.user_id, true from d
    join public.technician_customers tc on tc.customer_id = d.customer_id
    join public.technicians t on t.id = tc.technician_id
  where t.user_id is not null and t.archived_at is null and t.is_active
    and (not exists (select 1 from public.technician_customer_sites s where s.assignment_id = tc.id)
         or exists (select 1 from public.technician_customer_sites s where s.assignment_id = tc.id and s.site_id = d.site_id))
$$;

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
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function app_private.tcs_before_insert(), app_private.log_assignment(), app_private.log_assignment_site(),
  app_private.tcs_clear_primary(), app_private.device_responsible_users(uuid) from public, anon, authenticated;
revoke all on function app_private.is_assigned_site(uuid, uuid, uuid), app_private.attachment_entity_visible(text, uuid) from public, anon;
grant execute on function app_private.is_assigned_site(uuid, uuid, uuid), app_private.attachment_entity_visible(text, uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.company_can_view_site(uuid, uuid, uuid, text)', 'public.assignment_set(uuid, uuid, uuid[], text)',
    'public.assignment_remove(uuid, uuid, text)', 'public.assignment_set_primary(uuid, uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
