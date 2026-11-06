-- =====================================================================
-- عين السلامة — م6: مواقع الفروع على الخريطة، الزيارات والمعاينات (بنود مسعّرة)، عروض الأسعار، وروابط المشاركة مع العميل
-- (مشروع cgwnusudjhhxkwnqjzfr). لا يحذف ولا يعدّل أي صف قائم. لا يمس safety_*. أوامر العمل تبقى جداولها كما هي (أُزيلت من الواجهة فقط).
--
-- 1) الفروع: إحداثيات (خط العرض والطول) لكل فرع/موقع، للخريطة والاتجاهات.
-- 2) المعاينة = نوع زيارة جديد «survey» على جدول الزيارات القائم (لا نظام زيارات مكرر): الجدولة والفني والصور والتقرير كما هي.
--    بنودها survey_items: الجهاز/النظام (اختياري)، نوع المشكلة، الوصف، الكمية، سعر الوحدة. تُعدَّل ما دامت المعاينة مفتوحة فقط.
-- 3) عرض السعر quotations + quotation_items: يُنشأ من معاينة منتهية (عرض واحد نشط لكل معاينة) أو يدويًا، ويُعدَّل في «قيد الإعداد»
--    فقط؛ الحالة بإجراء: قيد الإعداد ← مرسل ← مقبول/مرفوض (وإعادة للإعداد للمراجعة). الضريبة 15٪ أو بلا ضريبة.
-- 4) المشاركة: رابط برمز عشوائي (يُخزَّن تجزئته فقط) لعرض السعر أو تقرير المعاينة، صالح لمدة محددة وقابل للإلغاء؛
--    يعرض المستند للعميل دون حساب، مع شعار الشركة وصور المعاينة (سياسة قراءة تخزين مقيدة بالروابط السارية فقط).
-- =====================================================================

do $$ begin
  if to_regprocedure('app_private.visit_can_work(uuid)') is null then raise exception 'طبّق 20261106000100 أولًا'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) الصلاحيات
-- ---------------------------------------------------------------------
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('quotes.view', 'quotes', 'عرض عروض الأسعار', 240),
  ('quotes.manage', 'quotes', 'إنشاء عروض الأسعار وتعديلها وإرسالها', 241)
on conflict (key) do nothing;
insert into public.company_role_permissions (role, permission_key) values
  ('supervisor', 'quotes.view'), ('supervisor', 'quotes.manage'), ('accountant', 'quotes.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1) موقع الفرع على الخريطة
-- ---------------------------------------------------------------------
alter table public.customer_sites add column if not exists latitude double precision;
alter table public.customer_sites add column if not exists longitude double precision;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_sites_latlng_check') then
    alter table public.customer_sites add constraint customer_sites_latlng_check check (
      (latitude is null and longitude is null)
      or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) المعاينة نوع زيارة
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.visits'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%visit_type%' loop
    execute format('alter table public.visits drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.visits add constraint visits_visit_type_check
  check (visit_type in ('periodic', 'emergency', 'repair', 'reinspection', 'installation', 'other', 'survey'));
alter table public.visits add column if not exists survey_vat boolean not null default true;

create table if not exists public.survey_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  visit_id uuid not null,
  device_id uuid,
  system_id uuid,
  title text not null check (length(btrim(title)) between 2 and 200),
  issue_type text not null default 'needs_maintenance'
    check (issue_type in ('needs_maintenance', 'faulty', 'missing', 'expired', 'needs_replacement', 'installation', 'other')),
  description text check (description is null or length(description) <= 2000),
  quantity numeric(12, 2) not null default 1 check (quantity > 0 and quantity <= 100000),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0 and unit_price <= 100000000),
  sort_order integer not null default 0,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  constraint survey_items_id_company_key unique (id, company_id),
  constraint si_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete cascade,
  constraint si_device_fk foreign key (device_id, company_id) references public.devices (id, company_id) on delete restrict,
  constraint si_system_fk foreign key (system_id, company_id) references public.safety_systems (id, company_id) on delete restrict
);
create index if not exists survey_items_visit_idx on public.survey_items (visit_id, sort_order);
create index if not exists survey_items_device_idx on public.survey_items (device_id) where device_id is not null;
create index if not exists survey_items_system_idx on public.survey_items (system_id) where system_id is not null;

-- البند لمعاينة مفتوحة فقط، وجهازه من موقع المعاينة، والشركة شركة الزيارة
create or replace function app_private.survey_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record; v_id uuid := coalesce(new.visit_id, old.visit_id);
begin
  select id, company_id, site_id, visit_type, status, closed_at into v from public.visits where id = v_id;
  -- حذف الزيارة كاملة (cascade): الزيارة حُذفت قبل بنودها
  if v.id is null and tg_op = 'DELETE' then return old; end if;
  if v.id is null or v.visit_type <> 'survey' then raise exception 'البنود المسعّرة لزيارات المعاينة فقط' using errcode = '23514'; end if;
  if v.closed_at is not null or v.status in ('completed', 'cancelled') then
    raise exception 'المعاينة منتهية؛ بنودها لا تُعدَّل' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.company_id <> v.company_id then raise exception 'البند لشركة أخرى' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and new.visit_id <> old.visit_id then raise exception 'لا يُنقل البند إلى معاينة أخرى' using errcode = 'P0001'; end if;
  if new.device_id is not null and not exists (select 1 from public.devices d where d.id = new.device_id and d.site_id = v.site_id) then
    raise exception 'الجهاز ليس في موقع المعاينة' using errcode = '23514';
  end if;
  new.updated_at := now();
  if app_private.is_client_request() then
    new.updated_by := auth.uid();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_survey_items_guard on public.survey_items;
create trigger trg_survey_items_guard before insert or update or delete on public.survey_items
  for each row execute function app_private.survey_items_guard();

alter table public.survey_items enable row level security;
drop policy if exists ays_si_select on public.survey_items;
create policy ays_si_select on public.survey_items for select to authenticated using (exists (select 1 from public.visits v where v.id = visit_id));
drop policy if exists ays_si_insert on public.survey_items;
drop policy if exists ays_si_update on public.survey_items;
drop policy if exists ays_si_delete on public.survey_items;
create policy ays_si_insert on public.survey_items for insert to authenticated with check (app_private.visit_can_work(visit_id));
create policy ays_si_update on public.survey_items for update to authenticated using (app_private.visit_can_work(visit_id)) with check (app_private.visit_can_work(visit_id));
create policy ays_si_delete on public.survey_items for delete to authenticated using (app_private.visit_can_work(visit_id));
revoke all on public.survey_items from anon;
revoke truncate, references, trigger on public.survey_items from authenticated;
grant select, insert, update, delete on public.survey_items to authenticated;

-- صورة مرتبطة ببند معاينة (اختياري)
alter table public.attachments add column if not exists survey_item_id uuid references public.survey_items(id) on delete set null;
create index if not exists attachments_survey_item_idx on public.attachments (survey_item_id) where survey_item_id is not null;
create or replace function app_private.attachments_survey_item_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.survey_item_id is not null and (new.entity_type <> 'visit'
     or not exists (select 1 from public.survey_items s where s.id = new.survey_item_id and s.visit_id = new.entity_id)) then
    raise exception 'البند ليس ضمن هذه المعاينة' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_attachments_survey_item on public.attachments;
create trigger trg_attachments_survey_item before insert or update of survey_item_id on public.attachments
  for each row execute function app_private.attachments_survey_item_check();

-- إنشاء معاينة: المسؤول لأي موقع يراه، والفني لمواقع نطاقه ويُسند لنفسه فقط. مفتاح العميل يمنع التكرار.
create or replace function public.survey_create(p_client_key uuid, p_site uuid, p_scheduled timestamptz, p_technician uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s record; v_id uuid; v_me uuid; v_tech uuid; v_manager boolean;
begin
  select id, company_id, customer_id into s from public.customer_sites where id = p_site and archived_at is null;
  if s.id is null then raise exception 'الفرع غير موجود أو مؤرشف' using errcode = 'P0002'; end if;
  v_manager := public.company_has_perm(s.company_id, 'visits.create');
  if not (v_manager or (public.company_has_perm(s.company_id, 'field.assigned') and public.company_has_perm(s.company_id, 'visits.update')
          and app_private.is_assigned_site(s.company_id, s.customer_id, s.id))) then
    raise exception 'هذا الفرع خارج نطاق صلاحيتك' using errcode = '42501';
  end if;
  if p_client_key is not null then
    select id into v_id from public.visits where company_id = s.company_id and client_key = p_client_key;
    if v_id is not null then return v_id; end if;
  end if;
  v_me := app_private.my_technician(s.company_id);
  v_tech := coalesce(p_technician, v_me);
  if not v_manager and v_tech is distinct from v_me then raise exception 'يمكنك إسناد المعاينة لنفسك فقط' using errcode = '42501'; end if;
  if v_tech is not null and not exists (select 1 from public.technicians where id = v_tech and company_id = s.company_id and archived_at is null and is_active) then
    raise exception 'الفني غير موجود أو غير نشط' using errcode = '23514';
  end if;
  insert into public.visits (company_id, customer_id, site_id, scheduled_start, status, visit_type, client_key, notes, created_by)
  values (s.company_id, s.customer_id, s.id, coalesce(p_scheduled, now()), 'scheduled', 'survey', p_client_key, left(nullif(btrim(p_notes), ''), 2000), auth.uid())
  returning id into v_id;
  if v_tech is not null then
    insert into public.visit_technicians (visit_id, technician_id, company_id, created_by) values (v_id, v_tech, s.company_id, auth.uid());
  end if;
  return v_id;
end $$;

-- إنهاء المعاينة (يُجمِّد البنود والصور ويتيح التقرير وعرض السعر) وإعادة فتحها للمسؤول ما لم يُقبل عرضها
create or replace function public.survey_complete(p_visit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select id, company_id, ref_no, visit_type, closed_at, status, summary, recommendations into v from public.visits where id = p_visit for update;
  if v.id is null or not app_private.visit_can_work(p_visit) then raise exception 'ليست لديك صلاحية على هذه المعاينة' using errcode = '42501'; end if;
  if v.visit_type <> 'survey' then raise exception 'ليست زيارة معاينة' using errcode = 'P0001'; end if;
  if v.closed_at is not null then return; end if;
  if v.status = 'cancelled' then raise exception 'المعاينة ملغاة' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.survey_items where visit_id = p_visit) and length(btrim(coalesce(v.summary, '') || coalesce(v.recommendations, ''))) < 3 then
    raise exception 'سجّل بندًا واحدًا على الأقل أو اكتب نتيجة المعاينة قبل إنهائها' using errcode = 'P0001';
  end if;
  perform set_config('app.visit_work', '1', true);
  update public.visits set status = 'completed', actual_start = coalesce(actual_start, now()), actual_end = now(), closed_at = now(),
    closed_by = auth.uid(), outcome = 'completed' where id = p_visit;
  perform set_config('app.visit_work', '', true);
  perform public.company_audit(v.company_id, 'survey_completed', 'visit', v.id, jsonb_build_object('ref_no', v.ref_no,
    'items', (select count(*) from public.survey_items where visit_id = p_visit)));
end $$;

create or replace function public.survey_reopen(p_visit uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select id, company_id, ref_no, visit_type, closed_at into v from public.visits where id = p_visit for update;
  if v.id is null or v.visit_type <> 'survey' then raise exception 'ليست زيارة معاينة' using errcode = 'P0002'; end if;
  if not public.company_has_perm(v.company_id, 'visits.create') then raise exception 'إعادة فتح المعاينة للمسؤول فقط' using errcode = '42501'; end if;
  if v.closed_at is null then return; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'اذكر سبب إعادة الفتح' using errcode = '22023'; end if;
  if exists (select 1 from public.quotations q where q.visit_id = p_visit and q.archived_at is null and q.status = 'accepted') then
    raise exception 'عرض سعر هذه المعاينة مقبول؛ لا تُعاد فتحها' using errcode = 'P0001';
  end if;
  perform set_config('app.visit_work', '1', true);
  update public.visits set status = 'in_progress', closed_at = null, closed_by = null, actual_end = null, outcome = null where id = p_visit;
  perform set_config('app.visit_work', '', true);
  perform public.company_audit(v.company_id, 'survey_reopened', 'visit', v.id, jsonb_build_object('ref_no', v.ref_no, 'reason', left(btrim(p_reason), 500)));
end $$;

-- ---------------------------------------------------------------------
-- 3) عروض الأسعار
-- ---------------------------------------------------------------------
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  ref_no text,
  visit_id uuid,
  customer_id uuid not null,
  site_id uuid,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  issue_date date not null default (now() at time zone 'Asia/Riyadh')::date,
  valid_until date,
  vat_rate numeric(5, 2) not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  title text check (title is null or length(title) <= 200),
  notes text check (notes is null or length(notes) <= 4000),
  terms text check (terms is null or length(terms) <= 4000),
  sent_at timestamptz, decided_at timestamptz, decision_note text,
  archived_at timestamptz, archived_by uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint quotations_id_company_key unique (id, company_id),
  constraint qt_customer_fk foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  constraint qt_site_fk foreign key (site_id, company_id) references public.customer_sites (id, company_id) on delete restrict,
  constraint qt_visit_fk foreign key (visit_id, company_id) references public.visits (id, company_id) on delete restrict,
  constraint qt_valid_check check (valid_until is null or valid_until >= issue_date)
);
create unique index if not exists quotations_company_ref_key on public.quotations (company_id, ref_no);
-- عرض نشط واحد لكل معاينة (لعرض جديد: أرشفة السابق)
create unique index if not exists quotations_one_per_visit on public.quotations (visit_id) where visit_id is not null and archived_at is null;
create index if not exists quotations_company_status_idx on public.quotations (company_id, status, issue_date desc);
create index if not exists quotations_customer_idx on public.quotations (customer_id);
create index if not exists quotations_site_idx on public.quotations (site_id) where site_id is not null;

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  quotation_id uuid not null,
  description text not null check (length(btrim(description)) between 2 and 1000),
  quantity numeric(12, 2) not null default 1 check (quantity > 0 and quantity <= 100000),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0 and unit_price <= 100000000),
  sort_order integer not null default 0,
  source_item_id uuid references public.survey_items(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qi_quotation_fk foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade
);
create index if not exists quotation_items_quotation_idx on public.quotation_items (quotation_id, sort_order);
create index if not exists quotation_items_source_idx on public.quotation_items (source_item_id) where source_item_id is not null;

drop trigger if exists trg_quotations_ref on public.quotations;
create trigger trg_quotations_ref before insert or update on public.quotations for each row execute function app_private.assign_ref('QT');
drop trigger if exists trg_quotations_touch on public.quotations;
create trigger trg_quotations_touch before update on public.quotations for each row execute function app_private.touch_updated_at();
drop trigger if exists trg_quotations_created_by on public.quotations;
create trigger trg_quotations_created_by before insert on public.quotations for each row execute function app_private.set_created_by();
drop trigger if exists trg_quotations_links on public.quotations;
create trigger trg_quotations_links before insert or update of customer_id, site_id on public.quotations for each row execute function app_private.check_customer_links();
drop trigger if exists trg_quotations_audit on public.quotations;
create trigger trg_quotations_audit after insert or update or delete on public.quotations for each row execute function app_private.audit_row('quotation');

-- التعديل في «قيد الإعداد» فقط؛ الحالة بإجراء quotation_set_status؛ الأرشفة مسموحة دائمًا
create or replace function app_private.quotations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.quote_work', true), '') <> '' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'العرض الجديد يبدأ «قيد الإعداد»' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then raise exception 'تُغيَّر حالة العرض بإجراء الحالة فقط' using errcode = 'P0001'; end if;
  if old.status <> 'draft' and (to_jsonb(new) - array['archived_at', 'archived_by', 'updated_at'])
       is distinct from (to_jsonb(old) - array['archived_at', 'archived_by', 'updated_at']) then
    raise exception 'العرض مرسل أو محسوم؛ أعده إلى «قيد الإعداد» لتعديله' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_quotations_guard on public.quotations;
create trigger trg_quotations_guard before insert or update on public.quotations for each row execute function app_private.quotations_guard();

create or replace function app_private.quotation_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q record; v_id uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  if coalesce(current_setting('app.quote_work', true), '') <> '' then return coalesce(new, old); end if;
  select id, company_id, status into q from public.quotations where id = v_id;
  if q.id is null then return old; end if; -- حذف العرض نفسه (cascade)
  if q.status <> 'draft' then raise exception 'العرض مرسل أو محسوم؛ أعده إلى «قيد الإعداد» لتعديل بنوده' using errcode = 'P0001'; end if;
  if tg_op <> 'DELETE' then
    if new.company_id <> q.company_id then raise exception 'البند لشركة أخرى' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and new.quotation_id <> old.quotation_id then raise exception 'لا يُنقل البند إلى عرض آخر' using errcode = 'P0001'; end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists trg_quotation_items_guard on public.quotation_items;
create trigger trg_quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function app_private.quotation_items_guard();

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
drop policy if exists ays_qt_select on public.quotations;
create policy ays_qt_select on public.quotations for select to authenticated
  using (public.company_has_any_perm(company_id, array['quotes.view', 'quotes.manage']));
drop policy if exists ays_qt_insert on public.quotations;
create policy ays_qt_insert on public.quotations for insert to authenticated with check (public.company_has_perm(company_id, 'quotes.manage'));
drop policy if exists ays_qt_update on public.quotations;
create policy ays_qt_update on public.quotations for update to authenticated
  using (public.company_has_perm(company_id, 'quotes.manage')) with check (public.company_has_perm(company_id, 'quotes.manage'));
drop policy if exists ays_qi_select on public.quotation_items;
create policy ays_qi_select on public.quotation_items for select to authenticated using (exists (select 1 from public.quotations q where q.id = quotation_id));
drop policy if exists ays_qi_insert on public.quotation_items;
create policy ays_qi_insert on public.quotation_items for insert to authenticated with check (public.company_has_perm(company_id, 'quotes.manage'));
drop policy if exists ays_qi_update on public.quotation_items;
create policy ays_qi_update on public.quotation_items for update to authenticated
  using (public.company_has_perm(company_id, 'quotes.manage')) with check (public.company_has_perm(company_id, 'quotes.manage'));
drop policy if exists ays_qi_delete on public.quotation_items;
create policy ays_qi_delete on public.quotation_items for delete to authenticated using (public.company_has_perm(company_id, 'quotes.manage'));
revoke all on public.quotations, public.quotation_items from anon;
revoke truncate, references, trigger, delete on public.quotations from authenticated;
revoke truncate, references, trigger on public.quotation_items from authenticated;
grant select, insert, update on public.quotations to authenticated;
grant select, insert, update, delete on public.quotation_items to authenticated;

-- عرض سعر من معاينة منتهية: بيانات العميل والفرع، وكل البنود بالكميات والأسعار، والضريبة حسب المعاينة. لا تكرار.
create or replace function public.quotation_from_visit(p_visit uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v record; v_id uuid;
begin
  select id, company_id, customer_id, site_id, visit_type, closed_at, ref_no, survey_vat, recommendations into v from public.visits where id = p_visit;
  if v.id is null or not public.company_has_perm(v.company_id, 'quotes.manage') then raise exception 'ليست لديك صلاحية إنشاء عروض الأسعار' using errcode = '42501'; end if;
  if v.visit_type <> 'survey' then raise exception 'عرض السعر يُنشأ من زيارة معاينة' using errcode = 'P0001'; end if;
  if v.closed_at is null then raise exception 'أنهِ المعاينة أولًا حتى تُعتمد بنودها' using errcode = 'P0001'; end if;
  select id into v_id from public.quotations where visit_id = p_visit and archived_at is null;
  if v_id is not null then return v_id; end if;
  perform set_config('app.quote_work', '1', true);
  insert into public.quotations (company_id, visit_id, customer_id, site_id, vat_rate, title, notes, valid_until, created_by)
  values (v.company_id, v.id, v.customer_id, v.site_id, case when v.survey_vat then 15 else 0 end,
    'عرض سعر أعمال صيانة — معاينة ' || coalesce(v.ref_no, ''), v.recommendations,
    (now() at time zone 'Asia/Riyadh')::date + 30, auth.uid())
  returning id into v_id;
  insert into public.quotation_items (company_id, quotation_id, description, quantity, unit_price, sort_order, source_item_id)
  select s.company_id, v_id,
    left(s.title || coalesce(' — ' || nullif(btrim(s.description), ''), ''), 1000), s.quantity, s.unit_price,
    row_number() over (order by s.sort_order, s.created_at), s.id
  from public.survey_items s where s.visit_id = p_visit;
  perform set_config('app.quote_work', '', true);
  return v_id;
end $$;

create or replace function public.quotation_set_status(p_quote uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  select id, company_id, status, ref_no into q from public.quotations where id = p_quote for update;
  if q.id is null or not public.company_has_perm(q.company_id, 'quotes.manage') then raise exception 'ليست لديك صلاحية إدارة عروض الأسعار' using errcode = '42501'; end if;
  if not ((q.status = 'draft' and p_status = 'sent') or (q.status = 'sent' and p_status in ('accepted', 'rejected', 'draft'))
          or (q.status in ('accepted', 'rejected') and p_status = 'draft')) then
    raise exception 'انتقال غير مسموح من «%» إلى «%»', q.status, p_status using errcode = 'P0001';
  end if;
  if p_status = 'sent' and not exists (select 1 from public.quotation_items where quotation_id = p_quote) then
    raise exception 'أضف بندًا واحدًا على الأقل قبل الإرسال' using errcode = 'P0001';
  end if;
  perform set_config('app.quote_work', '1', true);
  update public.quotations set status = p_status,
    sent_at = case when p_status = 'sent' then now() when p_status = 'draft' then null else sent_at end,
    decided_at = case when p_status in ('accepted', 'rejected') then now() else null end,
    decision_note = case when p_status in ('accepted', 'rejected') then left(nullif(btrim(p_note), ''), 1000) else null end
  where id = p_quote;
  perform set_config('app.quote_work', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 4) روابط المشاركة مع العميل
-- ---------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  kind text not null check (kind in ('quote', 'survey')),
  entity_id uuid not null,
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid
);
create index if not exists share_links_entity_idx on public.share_links (kind, entity_id);
create index if not exists share_links_company_idx on public.share_links (company_id);
alter table public.share_links enable row level security;
drop policy if exists ays_sl_select on public.share_links;
create policy ays_sl_select on public.share_links for select to authenticated using (public.company_is_member(company_id));
revoke all on public.share_links from anon, authenticated;
grant select (id, company_id, kind, entity_id, created_by, created_at, expires_at, revoked_at) on public.share_links to authenticated;

-- ينشئ رابطًا ويعيد الرمز الخام مرة واحدة (لا يُخزَّن إلا تجزئته)
create or replace function public.share_create(p_kind text, p_id uuid, p_days integer default 30) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_token text; v_ok boolean;
begin
  if p_days is null or p_days not between 1 and 180 then raise exception 'مدة الرابط بين يوم و180 يومًا' using errcode = '22023'; end if;
  if p_kind = 'quote' then
    select company_id into v_company from public.quotations where id = p_id and archived_at is null;
    v_ok := v_company is not null and public.company_has_perm(v_company, 'quotes.manage');
  elsif p_kind = 'survey' then
    select company_id into v_company from public.visits where id = p_id and visit_type = 'survey' and closed_at is not null and archived_at is null;
    v_ok := v_company is not null and (public.company_has_any_perm(v_company, array['visits.create', 'quotes.manage', 'reports.print']) or app_private.visit_can_work(p_id));
  else
    raise exception 'نوع غير صالح' using errcode = '22023';
  end if;
  if v_company is null then raise exception 'المستند غير موجود أو غير جاهز للمشاركة (المعاينة يجب أن تكون منتهية)' using errcode = 'P0002'; end if;
  if not v_ok then raise exception 'ليست لديك صلاحية مشاركة هذا المستند' using errcode = '42501'; end if;
  v_token := translate(encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_');
  insert into public.share_links (company_id, kind, entity_id, token_hash, created_by, expires_at)
  values (v_company, p_kind, p_id, public.company_token_hash(v_token), auth.uid(), now() + make_interval(days => p_days));
  perform public.company_audit(v_company, 'share_link_created', p_kind, p_id, jsonb_build_object('days', p_days));
  return v_token;
end $$;

create or replace function public.share_revoke(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select * into l from public.share_links where id = p_link for update;
  if l.id is null then raise exception 'الرابط غير موجود' using errcode = 'P0002'; end if;
  if not (l.created_by = auth.uid() or public.company_has_any_perm(l.company_id, array['quotes.manage', 'visits.create'])) then
    raise exception 'ليست لديك صلاحية إلغاء الرابط' using errcode = '42501';
  end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()) where id = p_link;
  perform public.company_audit(l.company_id, 'share_link_revoked', l.kind, l.entity_id, '{}'::jsonb);
end $$;

-- الرابط الساري لمستند (للتحقق في سياسات قراءة الصور والشعار للعميل)
create or replace function app_private.share_active(p_kind text, p_entity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_links where kind = p_kind and entity_id = p_entity and revoked_at is null and expires_at > now())
$$;

-- المستند المشارَك للعميل (دون حساب): هوية الشركة + عرض السعر أو تقرير المعاينة بالبنود والإجماليات والصور
create or replace function public.shared_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.share_links; c public.companies; v_doc jsonb; v_sub numeric; v_rate numeric;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{20,100}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into l from public.share_links where token_hash = public.company_token_hash(p_token);
  if l.id is null then return jsonb_build_object('status', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  select * into c from public.companies where id = l.company_id;
  if c.status <> 'active' then return jsonb_build_object('status', 'unavailable'); end if;

  if l.kind = 'quote' then
    select jsonb_build_object('ref_no', q.ref_no, 'status', q.status, 'title', q.title, 'issue_date', q.issue_date, 'valid_until', q.valid_until,
        'vat_rate', q.vat_rate, 'notes', q.notes, 'terms', q.terms, 'archived', q.archived_at is not null,
        'customer', jsonb_build_object('name', cu.name, 'vat_number', cu.vat_number, 'phone', cu.phone),
        'site', case when s.id is null then null else jsonb_build_object('name', s.name, 'city', s.city, 'address', s.address) end,
        'visit_ref', v.ref_no,
        'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit_price', i.unit_price) order by i.sort_order, i.created_at)
                           from public.quotation_items i where i.quotation_id = q.id), '[]'::jsonb)),
      q.vat_rate, coalesce((select sum(i.quantity * i.unit_price) from public.quotation_items i where i.quotation_id = q.id), 0)
      into v_doc, v_rate, v_sub
    from public.quotations q join public.customers cu on cu.id = q.customer_id left join public.customer_sites s on s.id = q.site_id
    left join public.visits v on v.id = q.visit_id where q.id = l.entity_id;
  else
    select jsonb_build_object('ref_no', v.ref_no, 'scheduled_start', v.scheduled_start, 'actual_end', v.actual_end, 'summary', v.summary,
        'recommendations', v.recommendations, 'technician_notes', v.technician_notes, 'archived', v.archived_at is not null,
        'customer', jsonb_build_object('name', cu.name, 'phone', cu.phone),
        'site', case when s.id is null then null else jsonb_build_object('name', s.name, 'city', s.city, 'address', s.address,
                  'latitude', s.latitude, 'longitude', s.longitude) end,
        'technicians', coalesce((select jsonb_agg(t.full_name order by t.full_name) from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id where vt.visit_id = v.id), '[]'::jsonb),
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', si.id, 'title', si.title, 'issue_type', si.issue_type, 'description', si.description,
                   'quantity', si.quantity, 'unit_price', si.unit_price, 'device', d.name, 'device_ref', d.ref_no, 'system', ss.name) order by si.sort_order, si.created_at)
                  from public.survey_items si left join public.devices d on d.id = si.device_id left join public.safety_systems ss on ss.id = si.system_id
                  where si.visit_id = v.id), '[]'::jsonb),
        'photos', coalesce((select jsonb_agg(jsonb_build_object('path', a.storage_path, 'name', a.file_name, 'mime', a.mime_type, 'stage', a.photo_stage,
                   'item_id', a.survey_item_id) order by a.created_at)
                  from public.attachments a where a.entity_type = 'visit' and a.entity_id = v.id and a.archived_at is null), '[]'::jsonb)),
      case when v.survey_vat then 15 else 0 end,
      coalesce((select sum(si.quantity * si.unit_price) from public.survey_items si where si.visit_id = v.id), 0)
      into v_doc, v_rate, v_sub
    from public.visits v join public.customers cu on cu.id = v.customer_id left join public.customer_sites s on s.id = v.site_id
    where v.id = l.entity_id and v.visit_type = 'survey';
  end if;
  if v_doc is null then return jsonb_build_object('status', 'invalid'); end if;
  return jsonb_build_object('status', 'ok', 'kind', l.kind, 'expires_at', l.expires_at,
    'company', jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'phone', c.phone, 'email', c.email, 'website', c.website,
      'city', c.city, 'address', c.address, 'vat_number', c.vat_number, 'commercial_registration', c.commercial_registration,
      'license_no', c.license_no, 'logo_path', case when c.show_logo_in_reports then c.logo_path end,
      'primary_color', c.primary_color, 'header_text', c.header_text, 'footer_text', c.footer_text),
    'doc', v_doc,
    'totals', jsonb_build_object('subtotal', round(v_sub, 2), 'vat_rate', v_rate, 'vat', round(v_sub * v_rate / 100, 2),
      'total', round(v_sub + v_sub * v_rate / 100, 2)));
end $$;

-- قراءة الصور والشعار للعميل عبر رابط ساري فقط
create or replace function public.storage_shared_allowed(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'org-files' then exists (
      select 1 from public.attachments a where a.storage_path = p_name and a.entity_type = 'visit' and a.archived_at is null
        and app_private.share_active('survey', a.entity_id))
    when 'org-branding' then exists (
      select 1 from public.companies c where c.id = app_private.storage_company(p_name) and c.logo_path = p_name and c.status = 'active'
        and exists (select 1 from public.share_links l where l.company_id = c.id and l.revoked_at is null and l.expires_at > now()))
    else false end
$$;
drop policy if exists ays_files_shared_read on storage.objects;
create policy ays_files_shared_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('org-files', 'org-branding') and public.storage_shared_allowed(bucket_id, name));

-- ---------------------------------------------------------------------
-- الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.survey_items_guard(), app_private.attachments_survey_item_check(), app_private.quotations_guard(),
  app_private.quotation_items_guard() from public, anon, authenticated;
revoke all on function app_private.share_active(text, uuid) from public, anon;
grant execute on function app_private.share_active(text, uuid) to authenticated;
revoke all on function public.shared_document(text), public.storage_shared_allowed(text, text) from public;
grant execute on function public.shared_document(text), public.storage_shared_allowed(text, text) to anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.survey_create(uuid, uuid, timestamptz, uuid, text)', 'public.survey_complete(uuid)',
    'public.survey_reopen(uuid, text)', 'public.quotation_from_visit(uuid)', 'public.quotation_set_status(uuid, text, text)',
    'public.share_create(text, uuid, integer)', 'public.share_revoke(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
