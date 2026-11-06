-- =====================================================================
-- عين السلامة — م2: الموقع المكاني للأجهزة وسجل نقلها (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) device_transfers: سجل دائم لكل نقل (من/إلى عميل وموقع، التاريخ، السبب، المنفّذ)؛ لا يُعدَّل ولا يُحذف.
-- 2) device_move(device, to_site, reason, moved_at): الإجراء الوحيد لتغيير موقع الجهاز أو عميله.
--    العميل يُستنتج من الموقع الهدف. النقل داخل العميل نفسه بصلاحية devices.update،
--    والنقل إلى عميل آخر عملية حساسة بصلاحية مستقلة devices.transfer (لمدير الشركة افتراضيًا).
--    الزيارات وسجلات الصيانة السابقة تبقى بموقعها وعميلها الأصليين (سجلات الصيانة تحفظ customer_id/site_id وقت تسجيلها).
--    هوية الجهاز ورمز QR وسجل صيانته لا تتغير.
-- 3) devices_before_write: تغيير site_id/customer_id بالتعديل المباشر من الواجهة مرفوض (يجب استخدام النقل)،
--    والجهاز الجديد يجب أن يُسجَّل في موقع محدد. الأجهزة القديمة بلا موقع تبقى كما هي وتُربط بالنقل.
-- 4) لا تُؤرشف مواقع فيها أجهزة نشطة (الحذف ممنوع أصلًا بقيود restrict).
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('devices.transfer', 'devices', 'نقل جهاز إلى عميل آخر', 156)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1) سجل النقل
-- ---------------------------------------------------------------------
create table if not exists public.device_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  device_id uuid not null,
  from_customer_id uuid not null, from_site_id uuid,
  to_customer_id uuid not null, to_site_id uuid not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  moved_at timestamptz not null default now(),
  moved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dt_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict,
  constraint dt_from_customer_fk foreign key (from_customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint dt_to_customer_fk foreign key (to_customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint dt_from_site_fk foreign key (from_site_id, company_id) references public.customer_sites (id, company_id) on delete restrict,
  constraint dt_to_site_fk foreign key (to_site_id, company_id) references public.customer_sites (id, company_id) on delete restrict
);
create index if not exists device_transfers_device_idx on public.device_transfers (device_id, moved_at desc);
create index if not exists device_transfers_company_idx on public.device_transfers (company_id, moved_at desc);

drop trigger if exists trg_device_transfers_block on public.device_transfers;
create trigger trg_device_transfers_block before update or delete on public.device_transfers
  for each row execute function app_private.block_change();

alter table public.device_transfers enable row level security;
-- من يرى كل الأجهزة يرى كل سجل النقل؛ الفني المسند يرى نقل أجهزة عميله داخل العميل نفسه فقط (لا يُكشف العميل السابق)
drop policy if exists ays_dt_select on public.device_transfers;
create policy ays_dt_select on public.device_transfers for select to authenticated using (
  (select public.company_has_perm(company_id, 'devices.view'))
  or (from_customer_id = to_customer_id and (select public.company_has_perm(company_id, 'field.assigned'))
      and app_private.is_assigned_customer(company_id, to_customer_id)));
revoke all on public.device_transfers from anon;
revoke insert, update, delete, truncate, references, trigger on public.device_transfers from authenticated;
grant select on public.device_transfers to authenticated;

-- ---------------------------------------------------------------------
-- 2) حارس الجهاز: الموقع إلزامي للجديد، وتغييره بالنقل فقط
-- ---------------------------------------------------------------------
-- الطلب من الواجهة (PostgREST) يحمل دورًا في رمز الجلسة؛ is_api_caller لا يصلح هنا لأن الدالة SECURITY DEFINER.
-- device_move يرفع العلامة app.device_move داخل معاملته فقط ثم يعيدها.
create or replace function app_private.is_client_request() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon')
$$;

create or replace function app_private.devices_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- ---------------------------------------------------------------------
-- 3) نقل الجهاز
-- ---------------------------------------------------------------------
create or replace function public.device_move(p_device uuid, p_to_site uuid, p_reason text, p_moved_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.devices; s public.customer_sites; v_id uuid; v_at timestamptz := coalesce(p_moved_at, now());
begin
  select * into d from public.devices where id = p_device for update;
  if d.id is null then raise exception 'الجهاز غير موجود' using errcode = 'P0002'; end if;
  if not public.company_has_perm(d.company_id, 'devices.update') then
    raise exception 'ليست لديك صلاحية نقل الأجهزة' using errcode = '42501';
  end if;
  if d.archived_at is not null then raise exception 'لا يمكن نقل جهاز مؤرشف' using errcode = 'P0001'; end if;
  select * into s from public.customer_sites where id = p_to_site and company_id = d.company_id;
  if s.id is null then raise exception 'الموقع المحدد غير موجود' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'لا يمكن النقل إلى موقع مؤرشف' using errcode = 'P0001'; end if;
  if s.id is not distinct from d.site_id then raise exception 'الجهاز موجود في هذا الموقع بالفعل' using errcode = 'P0001'; end if;
  if s.customer_id <> d.customer_id and not public.company_has_perm(d.company_id, 'devices.transfer') then
    raise exception 'نقل جهاز إلى عميل آخر يتطلب صلاحية «نقل جهاز إلى عميل آخر»' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'اذكر سبب النقل' using errcode = '22023'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'تاريخ النقل لا يكون في المستقبل' using errcode = '22023'; end if;

  insert into public.device_transfers (company_id, device_id, from_customer_id, from_site_id, to_customer_id, to_site_id, reason, moved_at, moved_by)
  values (d.company_id, d.id, d.customer_id, d.site_id, s.customer_id, s.id, btrim(p_reason), v_at, auth.uid())
  returning id into v_id;
  perform set_config('app.device_move', v_id::text, true);
  update public.devices set customer_id = s.customer_id, site_id = s.id where id = d.id;
  perform set_config('app.device_move', '', true);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4) لا أرشفة لموقع فيه أجهزة نشطة
-- ---------------------------------------------------------------------
create or replace function app_private.sites_block_archive_with_devices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.archived_at is null and new.archived_at is not null
     and exists (select 1 from public.devices where site_id = new.id and archived_at is null) then
    raise exception 'في الموقع أجهزة نشطة؛ انقلها إلى موقع آخر أو أرشفها أولًا' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_customer_sites_archive_devices on public.customer_sites;
create trigger trg_customer_sites_archive_devices before update of archived_at on public.customer_sites
  for each row execute function app_private.sites_block_archive_with_devices();

revoke all on function app_private.sites_block_archive_with_devices() from public, anon, authenticated;
revoke all on function app_private.is_client_request() from public, anon;
grant execute on function app_private.is_client_request() to authenticated;
revoke all on function public.device_move(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.device_move(uuid, uuid, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
