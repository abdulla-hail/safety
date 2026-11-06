-- =====================================================================
-- عين السلامة — م7: نوع العميل «مؤسسة»، الماركات، عروض أسعار الفنيين مع المراجعة، تنبيهات مسبقة متعددة،
-- إشعارات أنشطة الفريق للإدارة (فورية عبر Realtime)، وإعدادات بريد الشركة (SMTP). (مشروع cgwnusudjhhxkwnqjzfr)
-- لا يحذف أي صف قائم. لا يمس safety_*. التعديل الوحيد على بيانات قائمة: إضافة صلاحية quotes.create للفنيين
-- ذوي الصلاحيات المخصصة (طلب صريح: تمكين الفني من إنشاء عروض الأسعار)، مع حفظ القيم الأصلية لاستعادتها في التراجع.
--
-- 1) customers.customer_type يقبل 'establishment' (مؤسسة).
-- 2) brands: قائمة ماركات لكل شركة (إدارة: catalog.manage؛ إضافة سريعة أثناء التسعير: quotes.manage أو catalog.manage).
--    البنود (survey_items, quotation_items) تحفظ brand_id واسم الماركة نصًا (يبقى في المستند حتى لو حُذفت الماركة).
-- 3) quotes.create للفني: ينشئ عرضًا لعملاء/فروع نطاقه أو من معاينته، ويعدّل مسودته فقط، ويرسلها «للمراجعة».
--    الحالات: draft ← review ← sent ← accepted/rejected. الاعتماد والإرسال للعميل وتحديد القرار لـ quotes.manage.
--    كل تعديل على البنود يُسجَّل في سجل التدقيق تحت العرض نفسه.
-- 4) companies.alert_lead_days: أيام التنبيه المسبق (افتراضي 30، 15، 7، 1)؛ تنبيه لكل مرحلة مرة واحدة لكل استحقاق.
-- 5) إشعارات الأنشطة للإدارة: من يملك صلاحية العرض للمورد وليس فنيًا ميدانيًا فقط (أو يملك الإسناد)؛ يستثنى منفّذ العملية.
--    تفضيلات لكل مستخدم ونوع (notification_preferences). notifications.actor_user_id يحفظ منفّذ العملية.
--    ملخص يومي إضافي: زيارات لم تُغلق بعد موعدها، وعروض بانتظار المراجعة.
-- 6) company_mail_settings: بيانات المرسل وخادم SMTP للشركة؛ كلمة المرور تُخزَّن مشفّرة من الخادم ولا تُقرأ من الواجهة.
-- =====================================================================

do $$ begin
  if to_regclass('public.quotations') is null then raise exception 'طبّق 20261110000100 أولًا'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) الصلاحيات
-- ---------------------------------------------------------------------
insert into public.permission_definitions (key, module, label_ar, sort_order) values
  ('quotes.create', 'quotes', 'إنشاء عروض أسعار ضمن النطاق وإرسالها للمراجعة', 242)
on conflict (key) do nothing;
insert into public.company_role_permissions (role, permission_key) values
  ('technician', 'quotes.create'), ('supervisor', 'quotes.create')
on conflict do nothing;
-- الفنيون ذوو الصلاحيات المخصصة يُضاف إليهم quotes.create (الطلب: تمكين الفني من إنشاء العروض).
-- @expect-change company_memberships(permissions, updated_at): إضافة quotes.create للفنيين ذوي الصلاحيات المخصصة (ومُشغّل التحديث يغيّر updated_at)
-- القيم الأصلية تُحفظ قبل التعديل، فيعيدها ملف التراجع بالضبط (الصلاحيات ووقت آخر تحديث).
create table if not exists app_private.migration_0111_memberships (
  membership_id uuid primary key,
  permissions text[] not null,
  updated_at timestamptz,
  migrated_at timestamptz not null default now()
);
revoke all on table app_private.migration_0111_memberships from public, anon, authenticated;
insert into app_private.migration_0111_memberships (membership_id, permissions, updated_at)
select id, permissions, updated_at from public.company_memberships
where role = 'technician' and permissions is not null and not ('quotes.create' = any (permissions))
on conflict (membership_id) do nothing;
update public.company_memberships m set permissions = array_append(m.permissions, 'quotes.create')
from app_private.migration_0111_memberships b
where m.id = b.membership_id and not ('quotes.create' = any (m.permissions));

-- ---------------------------------------------------------------------
-- 1) نوع العميل «مؤسسة»
-- ---------------------------------------------------------------------
alter table public.customers drop constraint if exists customers_customer_type_check;
alter table public.customers add constraint customers_customer_type_check
  check (customer_type in ('company', 'establishment', 'government', 'individual'));

-- ---------------------------------------------------------------------
-- 2) الماركات
-- ---------------------------------------------------------------------
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint brands_id_company_key unique (id, company_id)
);
create unique index if not exists brands_company_name_key on public.brands (company_id, lower(btrim(name)));
drop trigger if exists trg_brands_touch on public.brands;
create trigger trg_brands_touch before update on public.brands for each row execute function app_private.touch_updated_at();
drop trigger if exists trg_brands_created_by on public.brands;
create trigger trg_brands_created_by before insert on public.brands for each row execute function app_private.set_created_by();
drop trigger if exists trg_brands_audit on public.brands;
create trigger trg_brands_audit after insert or update or delete on public.brands for each row execute function app_private.audit_row('brand');
alter table public.brands enable row level security;
drop policy if exists ays_brands_select on public.brands;
create policy ays_brands_select on public.brands for select to authenticated using (public.company_is_member(company_id));
drop policy if exists ays_brands_insert on public.brands;
create policy ays_brands_insert on public.brands for insert to authenticated
  with check (public.company_has_any_perm(company_id, array['catalog.manage', 'quotes.manage']));
drop policy if exists ays_brands_update on public.brands;
create policy ays_brands_update on public.brands for update to authenticated
  using (public.company_has_perm(company_id, 'catalog.manage')) with check (public.company_has_perm(company_id, 'catalog.manage'));
drop policy if exists ays_brands_delete on public.brands;
create policy ays_brands_delete on public.brands for delete to authenticated using (public.company_has_perm(company_id, 'catalog.manage'));
revoke all on public.brands from anon;
revoke truncate, references, trigger on public.brands from authenticated;
grant select, insert, update, delete on public.brands to authenticated;

alter table public.survey_items add column if not exists brand_id uuid;
alter table public.survey_items add column if not exists brand text check (brand is null or length(brand) <= 100);
alter table public.quotation_items add column if not exists brand_id uuid;
alter table public.quotation_items add column if not exists brand text check (brand is null or length(brand) <= 100);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'si_brand_fk') then
    alter table public.survey_items add constraint si_brand_fk foreign key (brand_id) references public.brands(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qi_brand_fk') then
    alter table public.quotation_items add constraint qi_brand_fk foreign key (brand_id) references public.brands(id) on delete set null;
  end if;
end $$;
create index if not exists survey_items_brand_idx on public.survey_items (brand_id) where brand_id is not null;
create index if not exists quotation_items_brand_idx on public.quotation_items (brand_id) where brand_id is not null;

-- اسم الماركة نصًا من القائمة (ولا تُقبل ماركة من شركة أخرى)
create or replace function app_private.item_brand_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if new.brand_id is not null and (tg_op = 'INSERT' or new.brand_id is distinct from old.brand_id) then
    select id, company_id, name into b from public.brands where id = new.brand_id;
    if b.id is null or b.company_id <> new.company_id then raise exception 'الماركة غير موجودة في قائمة الشركة' using errcode = '23514'; end if;
    new.brand := b.name;
  end if;
  if new.brand is not null then new.brand := nullif(btrim(new.brand), ''); end if;
  return new;
end $$;
drop trigger if exists trg_survey_items_brand on public.survey_items;
create trigger trg_survey_items_brand before insert or update of brand_id, brand on public.survey_items for each row execute function app_private.item_brand_sync();
drop trigger if exists trg_quotation_items_brand on public.quotation_items;
create trigger trg_quotation_items_brand before insert or update of brand_id, brand on public.quotation_items for each row execute function app_private.item_brand_sync();

-- ---------------------------------------------------------------------
-- 3) عروض أسعار الفنيين والمراجعة
-- ---------------------------------------------------------------------
alter table public.quotations drop constraint if exists quotations_status_check;
alter table public.quotations add constraint quotations_status_check check (status in ('draft', 'review', 'sent', 'accepted', 'rejected'));
alter table public.quotations add column if not exists submitted_at timestamptz;
alter table public.quotations add column if not exists approved_by uuid;
alter table public.quotations add column if not exists approved_at timestamptz;

-- التعديل في «قيد الإعداد» و«بانتظار المراجعة» (المراجع يصحح الأسعار قبل الاعتماد)؛ بعد الإرسال يلزم الإرجاع للإعداد
create or replace function app_private.quotations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.quote_work', true), '') <> '' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'العرض الجديد يبدأ «قيد الإعداد»' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then raise exception 'تُغيَّر حالة العرض بإجراء الحالة فقط' using errcode = 'P0001'; end if;
  if old.status not in ('draft', 'review') and (to_jsonb(new) - array['archived_at', 'archived_by', 'updated_at'])
       is distinct from (to_jsonb(old) - array['archived_at', 'archived_by', 'updated_at']) then
    raise exception 'العرض مرسل أو محسوم؛ أعده إلى «قيد الإعداد» لتعديله' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function app_private.quotation_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q record; v_id uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  if coalesce(current_setting('app.quote_work', true), '') <> '' then return coalesce(new, old); end if;
  select id, company_id, status into q from public.quotations where id = v_id;
  if q.id is null then return old; end if;
  if q.status not in ('draft', 'review') then raise exception 'العرض مرسل أو محسوم؛ أعده إلى «قيد الإعداد» لتعديل بنوده' using errcode = 'P0001'; end if;
  if tg_op <> 'DELETE' then
    if new.company_id <> q.company_id then raise exception 'البند لشركة أخرى' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and new.quotation_id <> old.quotation_id then raise exception 'لا يُنقل البند إلى عرض آخر' using errcode = 'P0001'; end if;
    return new;
  end if;
  return old;
end $$;

-- هل يحق للمستخدم تعديل هذا العرض (البيانات والبنود)؟ المدير في «قيد الإعداد»/«المراجعة»؛ الفني لمسودته هو فقط
create or replace function app_private.quote_can_edit(p_quote uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select q.archived_at is null and (public.company_has_perm(q.company_id, 'quotes.manage')
      or (public.company_has_perm(q.company_id, 'quotes.create') and q.created_by = auth.uid() and q.status = 'draft'))
    from public.quotations q where q.id = p_quote), false)
$$;
-- نطاق الفني: العميل/الفرع ضمن إسناده
create or replace function app_private.quote_in_scope(p_company uuid, p_customer uuid, p_site uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_site is not null then app_private.is_assigned_site(p_company, p_customer, p_site)
              else app_private.is_assigned_customer(p_company, p_customer) end
$$;

drop policy if exists ays_qt_select on public.quotations;
create policy ays_qt_select on public.quotations for select to authenticated
  using (public.company_has_any_perm(company_id, array['quotes.view', 'quotes.manage'])
    or (created_by = (select auth.uid()) and public.company_has_perm(company_id, 'quotes.create')));
drop policy if exists ays_qt_insert on public.quotations;
create policy ays_qt_insert on public.quotations for insert to authenticated with check (
  public.company_has_perm(company_id, 'quotes.manage')
  or (public.company_has_perm(company_id, 'quotes.create') and app_private.quote_in_scope(company_id, customer_id, site_id)));
drop policy if exists ays_qt_update on public.quotations;
create policy ays_qt_update on public.quotations for update to authenticated
  using (public.company_has_perm(company_id, 'quotes.manage')
    or (created_by = (select auth.uid()) and status = 'draft' and archived_at is null and public.company_has_perm(company_id, 'quotes.create')))
  with check (public.company_has_perm(company_id, 'quotes.manage')
    or (created_by = (select auth.uid()) and archived_at is null and public.company_has_perm(company_id, 'quotes.create')
        and app_private.quote_in_scope(company_id, customer_id, site_id)));
drop policy if exists ays_qi_insert on public.quotation_items;
create policy ays_qi_insert on public.quotation_items for insert to authenticated with check (app_private.quote_can_edit(quotation_id));
drop policy if exists ays_qi_update on public.quotation_items;
create policy ays_qi_update on public.quotation_items for update to authenticated
  using (app_private.quote_can_edit(quotation_id)) with check (app_private.quote_can_edit(quotation_id));
drop policy if exists ays_qi_delete on public.quotation_items;
create policy ays_qi_delete on public.quotation_items for delete to authenticated using (app_private.quote_can_edit(quotation_id));

-- سجل تعديلات البنود تحت العرض نفسه (من أضاف/عدّل/حذف ومتى)
create or replace function app_private.quotation_items_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record := coalesce(new, old); v_changes jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'UPDATE' then
    for k in select unnest(array['description', 'quantity', 'unit_price', 'brand']) loop
      if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  end if;
  if exists (select 1 from public.quotations where id = r.quotation_id) then
    perform public.company_audit(r.company_id, case tg_op when 'INSERT' then 'item_added' when 'UPDATE' then 'item_updated' else 'item_deleted' end,
      'quotation', r.quotation_id, jsonb_build_object('name', left(r.description, 120), 'brand', r.brand, 'quantity', r.quantity, 'unit_price', r.unit_price, 'changes', v_changes));
  end if;
  return null;
end $$;
drop trigger if exists trg_quotation_items_audit on public.quotation_items;
create trigger trg_quotation_items_audit after insert or update or delete on public.quotation_items
  for each row execute function app_private.quotation_items_audit();

-- عرض من معاينة منتهية: للمدير، أو للفني الذي يعمل على المعاينة (quotes.create). الماركة تنتقل مع البند.
create or replace function public.quotation_from_visit(p_visit uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v record; v_id uuid;
begin
  select id, company_id, customer_id, site_id, visit_type, closed_at, ref_no, survey_vat, recommendations into v from public.visits where id = p_visit;
  if v.id is null or not (public.company_has_perm(v.company_id, 'quotes.manage')
       or (public.company_has_perm(v.company_id, 'quotes.create') and app_private.visit_can_work(p_visit))) then
    raise exception 'ليست لديك صلاحية إنشاء عروض الأسعار' using errcode = '42501';
  end if;
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
  insert into public.quotation_items (company_id, quotation_id, description, quantity, unit_price, sort_order, source_item_id, brand_id, brand)
  select s.company_id, v_id,
    left(s.title || coalesce(' — ' || nullif(btrim(s.description), ''), ''), 1000), s.quantity, s.unit_price,
    row_number() over (order by s.sort_order, s.created_at), s.id, s.brand_id, s.brand
  from public.survey_items s where s.visit_id = p_visit;
  perform set_config('app.quote_work', '', true);
  return v_id;
end $$;

-- الحالات: الفني (منشئ العرض) يرسل مسودته للمراجعة أو يسحبها؛ المدير يعتمد ويرسل ويسجّل القرار ويعيد للإعداد
create or replace function public.quotation_set_status(p_quote uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q record; v_manager boolean; v_owner boolean;
begin
  select id, company_id, status, ref_no, created_by, archived_at into q from public.quotations where id = p_quote for update;
  if q.id is null then raise exception 'العرض غير موجود' using errcode = 'P0002'; end if;
  v_manager := public.company_has_perm(q.company_id, 'quotes.manage');
  v_owner := q.created_by = auth.uid() and public.company_has_perm(q.company_id, 'quotes.create');
  if not (v_manager or v_owner) then raise exception 'ليست لديك صلاحية على هذا العرض' using errcode = '42501'; end if;
  if q.archived_at is not null then raise exception 'العرض مؤرشف' using errcode = 'P0001'; end if;
  if not ((q.status = 'draft' and p_status = 'review' and (v_owner or v_manager))
       or (q.status = 'review' and p_status = 'draft' and (v_owner or v_manager))
       or (q.status in ('draft', 'review') and p_status = 'sent' and v_manager)
       or (q.status = 'sent' and p_status in ('accepted', 'rejected', 'draft') and v_manager)
       or (q.status in ('accepted', 'rejected') and p_status = 'draft' and v_manager)) then
    if not v_manager and p_status in ('sent', 'accepted', 'rejected') then
      raise exception 'اعتماد العرض وإرساله للعميل للمسؤول؛ أرسله للمراجعة' using errcode = '42501';
    end if;
    raise exception 'انتقال غير مسموح من «%» إلى «%»', q.status, p_status using errcode = 'P0001';
  end if;
  if p_status in ('review', 'sent') and not exists (select 1 from public.quotation_items where quotation_id = p_quote) then
    raise exception 'أضف بندًا واحدًا على الأقل' using errcode = 'P0001';
  end if;
  perform set_config('app.quote_work', '1', true);
  update public.quotations set status = p_status,
    submitted_at = case when p_status = 'review' then now() when p_status = 'draft' then null else submitted_at end,
    approved_by = case when p_status = 'sent' then auth.uid() when p_status = 'draft' then null else approved_by end,
    approved_at = case when p_status = 'sent' then now() when p_status = 'draft' then null else approved_at end,
    sent_at = case when p_status = 'sent' then now() when p_status = 'draft' then null else sent_at end,
    decided_at = case when p_status in ('accepted', 'rejected') then now() else null end,
    decision_note = case when p_status in ('accepted', 'rejected', 'draft') then left(nullif(btrim(p_note), ''), 1000) else null end
  where id = p_quote;
  perform set_config('app.quote_work', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 4) مشاركة المستند: الماركة في بنود العرض والمعاينة (بقية التعريف كما في م6)
-- ---------------------------------------------------------------------
create or replace function public.shared_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.share_links; c public.companies; v_doc jsonb; v_sub numeric; v_rate numeric; v_mail jsonb;
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
        'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'brand', i.brand, 'quantity', i.quantity, 'unit_price', i.unit_price) order by i.sort_order, i.created_at)
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
                   'quantity', si.quantity, 'unit_price', si.unit_price, 'brand', si.brand, 'device', d.name, 'device_ref', d.ref_no, 'system', ss.name) order by si.sort_order, si.created_at)
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
  -- بريد الشركة الرسمي (إن ضُبط) يظهر للعميل بدل بريد الملف العام
  select jsonb_build_object('sender_name', ms.sender_name, 'sender_email', ms.sender_email) into v_mail
  from public.company_mail_settings ms where ms.company_id = c.id;
  return jsonb_build_object('status', 'ok', 'kind', l.kind, 'expires_at', l.expires_at,
    'company', jsonb_build_object('name', coalesce(nullif(v_mail ->> 'sender_name', ''), c.name), 'legal_name', c.legal_name, 'phone', c.phone,
      'email', coalesce(nullif(v_mail ->> 'sender_email', ''), c.email), 'website', c.website,
      'city', c.city, 'address', c.address, 'vat_number', c.vat_number, 'commercial_registration', c.commercial_registration,
      'license_no', c.license_no, 'logo_path', case when c.show_logo_in_reports then c.logo_path end,
      'primary_color', c.primary_color, 'header_text', c.header_text, 'footer_text', c.footer_text),
    'doc', v_doc,
    'totals', jsonb_build_object('subtotal', round(v_sub, 2), 'vat_rate', v_rate, 'vat', round(v_sub * v_rate / 100, 2),
      'total', round(v_sub + v_sub * v_rate / 100, 2)));
end $$;

-- ---------------------------------------------------------------------
-- 5) بريد الشركة (SMTP)
-- ---------------------------------------------------------------------
create table if not exists public.company_mail_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  sender_name text check (sender_name is null or length(sender_name) <= 120),
  sender_email text check (sender_email is null or sender_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  reply_to text check (reply_to is null or reply_to ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  smtp_host text check (smtp_host is null or smtp_host ~ '^[A-Za-z0-9.-]{3,253}$'),
  smtp_port integer check (smtp_port is null or smtp_port between 1 and 65535),
  smtp_secure boolean not null default true,
  smtp_user text check (smtp_user is null or length(smtp_user) <= 254),
  smtp_password_enc text check (smtp_password_enc is null or length(smtp_password_enc) <= 2000),
  enabled boolean not null default false,
  last_test_at timestamptz, last_test_ok boolean, last_test_error text,
  updated_by uuid, updated_at timestamptz not null default now()
);
drop trigger if exists trg_mail_settings_touch on public.company_mail_settings;
create trigger trg_mail_settings_touch before update on public.company_mail_settings for each row execute function app_private.touch_updated_at();
alter table public.company_mail_settings enable row level security;
drop policy if exists ays_ms_select on public.company_mail_settings;
create policy ays_ms_select on public.company_mail_settings for select to authenticated using (public.company_has_perm(company_id, 'settings.branding'));
drop policy if exists ays_ms_insert on public.company_mail_settings;
create policy ays_ms_insert on public.company_mail_settings for insert to authenticated with check (public.company_has_perm(company_id, 'settings.branding'));
drop policy if exists ays_ms_update on public.company_mail_settings;
create policy ays_ms_update on public.company_mail_settings for update to authenticated
  using (public.company_has_perm(company_id, 'settings.branding')) with check (public.company_has_perm(company_id, 'settings.branding'));
revoke all on public.company_mail_settings from anon, authenticated;
-- كلمة المرور المشفرة لا تُقرأ عبر الواجهة البرمجية (تكتب فقط)؛ يقرؤها الخادم عبر company_mail_config
grant select (company_id, sender_name, sender_email, reply_to, smtp_host, smtp_port, smtp_secure, smtp_user, enabled,
  last_test_at, last_test_ok, last_test_error, updated_at) on public.company_mail_settings to authenticated;
grant insert, update on public.company_mail_settings to authenticated;

-- إعدادات الإرسال للخادم عند مشاركة مستند: لمن يملك صلاحية المشاركة في الشركة. كلمة المرور تبقى مشفرة بمفتاح الخادم.
create or replace function public.company_mail_config(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.company_mail_settings;
begin
  if not public.company_has_any_perm(p_company, array['quotes.manage', 'quotes.create', 'visits.create', 'visits.update', 'reports.print', 'settings.branding']) then
    raise exception 'ليست لديك صلاحية' using errcode = '42501';
  end if;
  select * into m from public.company_mail_settings where company_id = p_company;
  if m.company_id is null then return null; end if;
  return to_jsonb(m) - 'updated_by';
end $$;

create or replace function public.company_mail_test_result(p_company uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.company_has_perm(p_company, 'settings.branding') then raise exception 'ليست لديك صلاحية' using errcode = '42501'; end if;
  update public.company_mail_settings set last_test_at = now(), last_test_ok = p_ok, last_test_error = left(p_error, 500) where company_id = p_company;
end $$;

-- ---------------------------------------------------------------------
-- 6) التنبيهات المسبقة المتعددة
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists alert_lead_days smallint[] not null default '{30,15,7,1}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_alert_lead_days_chk') then
    alter table public.companies add constraint companies_alert_lead_days_chk check (
      cardinality(alert_lead_days) between 1 and 6 and 1 <= all (alert_lead_days) and 180 >= all (alert_lead_days));
  end if;
end $$;

create or replace function public.set_alert_lead_days(p_company uuid, p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old smallint[]; v_new smallint[];
begin
  perform public.require_company_manager(p_company);
  select array_agg(distinct d order by d desc)::smallint[] into v_new from unnest(p_days) d where d between 1 and 180;
  if v_new is null or cardinality(v_new) > 6 then raise exception 'اختر من يوم إلى ستة مواعيد بين 1 و180 يومًا' using errcode = '22023'; end if;
  select alert_lead_days into v_old from public.companies where id = p_company;
  update public.companies set alert_lead_days = v_new, maintenance_alert_days = greatest(v_new[1], 1) where id = p_company;
  perform public.company_audit(p_company, 'maintenance_settings', 'company', p_company,
    jsonb_build_object('before', jsonb_build_object('alert_lead_days', v_old), 'after', jsonb_build_object('alert_lead_days', v_new)));
end $$;

-- الحساب اليومي (م4) مع مراحل التنبيه المسبق: كل مرحلة (30/15/7/1...) مرة واحدة لكل استحقاق، وتُرسل المرحلة الأقرب فقط
create or replace function app_private.run_maintenance_alerts_for(p_company uuid, p_today date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  co record; y record; r record; v_tier integer; v_window integer;
  v_today date := coalesce(p_today, app_private.riyadh_date()); v_days integer; n integer := 0;
  v_overdue integer; v_today_n integer; v_soon integer; v_esc integer;
begin
  select id, maintenance_alert_days, escalation_days, alert_lead_days into co from public.companies where id = p_company and status = 'active';
  if co.id is null then return 0; end if;
  v_window := greatest(coalesce((select max(d) from unnest(co.alert_lead_days) d), 0), 1);
  for y in select x.id cycle_id, x.due_date, d.id, d.ref_no, d.name, d.customer_id, d.site_id from public.device_maintenance_cycles x
           join public.devices d on d.id = x.device_id
           where x.company_id = p_company and x.status = 'open' and d.archived_at is null and d.status <> 'decommissioned'
             and x.due_date <= v_today + v_window loop
    v_days := y.due_date - v_today;
    if v_days > 0 then
      select min(d) into v_tier from unnest(co.alert_lead_days) d where v_days <= d;
      if v_tier is not null then
        for r in select u.user_id from app_private.device_responsible_users(y.id) u
                 union select f.user_id from app_private.company_followup_users(p_company) f loop
          perform app_private.notify(p_company, r.user_id, 'maintenance_due_soon', 'صيانة قادمة بعد ' || v_days || ' يوم: ' || y.name || ' (' || y.ref_no || ')',
            'موعد الصيانة ' || to_char(y.due_date, 'YYYY-MM-DD') || ' — تنبيه قبل ' || v_tier || ' يوم', '/devices/' || y.id, 'device', y.id, 'soon' || v_tier || ':' || y.cycle_id);
          n := n + 1;
        end loop;
      end if;
    elsif v_days = 0 then
      for r in select u.user_id from app_private.device_responsible_users(y.id) u
               union select f.user_id from app_private.company_followup_users(p_company) f loop
        perform app_private.notify(p_company, r.user_id, 'maintenance_due_today', 'صيانة مستحقة اليوم: ' || y.name || ' (' || y.ref_no || ')',
          'موعد الصيانة اليوم ' || to_char(y.due_date, 'YYYY-MM-DD'), '/devices/' || y.id, 'device', y.id, 'today:' || y.cycle_id);
        n := n + 1;
      end loop;
    else
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

  select count(*) filter (where x.due_date < v_today), count(*) filter (where x.due_date = v_today),
         count(*) filter (where x.due_date > v_today), count(*) filter (where x.due_date <= v_today - co.escalation_days)
    into v_overdue, v_today_n, v_soon, v_esc
  from public.device_maintenance_cycles x join public.devices d on d.id = x.device_id
  where x.company_id = p_company and x.status = 'open' and d.archived_at is null and d.status <> 'decommissioned'
    and x.due_date <= v_today + v_window;
  if v_overdue + v_today_n + v_soon > 0 then
    for r in select f.user_id from app_private.company_followup_users(p_company) f loop
      perform app_private.notify(p_company, r.user_id, 'maintenance_digest', 'ملخص الصيانة — ' || to_char(v_today, 'YYYY-MM-DD'),
        'متأخرة: ' || v_overdue || ' (تجاوزت حد التصعيد: ' || v_esc || ') · مستحقة اليوم: ' || v_today_n || ' · خلال ' || v_window || ' يومًا: ' || v_soon,
        '/reports/maintenance-due', 'company', p_company, 'digest:' || to_char(v_today, 'YYYY-MM-DD'));
      n := n + 1;
    end loop;
  end if;
  n := n + app_private.run_ops_digest_for(p_company, v_today);
  update public.companies set last_alert_run_at = now() where id = p_company;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7) إشعارات الأنشطة للإدارة
-- ---------------------------------------------------------------------
alter table public.notifications add column if not exists actor_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.notification_preferences (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id, kind)
);
alter table public.notification_preferences enable row level security;
drop policy if exists ays_np_all on public.notification_preferences;
create policy ays_np_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and public.company_is_member(company_id))
  with check (user_id = (select auth.uid()) and public.company_is_member(company_id));
revoke all on public.notification_preferences from anon;
revoke truncate, references, trigger on public.notification_preferences from authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

-- اسم منفّذ العملية: اسم الفني المرتبط بالحساب، ثم الاسم في الحساب، ثم البريد
create or replace function app_private.actor_name(p_company uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.full_name from public.technicians t where t.company_id = p_company and t.user_id = p_user and t.archived_at is null limit 1),
    (select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email) from auth.users u where u.id = p_user),
    'النظام')
$$;

-- يُرسل إشعار نشاط لمن يتابع هذا النوع: يملك p_perm، وليس فنيًا ميدانيًا فقط (أو يملك الإسناد)، وليس منفّذ العملية،
-- ولم يوقف هذا النوع. p_dedupe لدمج الأحداث المتكررة (الصور/الملاحظات/التعديلات) في إشعار واحد للفترة.
create or replace function app_private.notify_activity(p_company uuid, p_perm text, p_kind text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_actor uuid := auth.uid(); v_name text;
begin
  if p_company is null then return; end if;
  v_name := case when v_actor is null then null else app_private.actor_name(p_company, v_actor) end;
  for r in select m.user_id from public.company_memberships m join public.companies c on c.id = m.company_id
           where m.company_id = p_company and m.status = 'active' and c.status = 'active'
             and m.user_id is distinct from v_actor
             and p_perm = any (public.company_effective_permissions(m.role, m.permissions))
             and ('assignments.manage' = any (public.company_effective_permissions(m.role, m.permissions))
                  or not ('field.assigned' = any (public.company_effective_permissions(m.role, m.permissions))))
             and not exists (select 1 from public.notification_preferences np
                             where np.company_id = p_company and np.user_id = m.user_id and np.kind = p_kind and not np.enabled) loop
    insert into public.notifications (company_id, recipient_user_id, kind, title, body, link, entity_type, entity_id, dedupe_key, actor_user_id)
    values (p_company, r.user_id, p_kind, left(p_title, 200),
      left(coalesce(p_body, '') || case when v_name is not null then ' — بواسطة ' || v_name else '' end, 600),
      p_link, p_entity_type, p_entity_id, p_dedupe, v_actor)
    on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end $$;

create or replace function app_private.activity_visits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_link text := '/visits/' || new.id || case when new.visit_type = 'survey' then '/survey' else '' end;
  v_label text := case when new.visit_type = 'survey' then 'معاينة' else 'زيارة' end;
  v_where text := coalesce((select s.name from public.customer_sites s where s.id = new.site_id), (select c.name from public.customers c where c.id = new.customer_id), '');
  v_hour text := to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDD');
begin
  if tg_op = 'INSERT' then
    perform app_private.notify_activity(new.company_id, 'visits.view', case when new.visit_type = 'survey' then 'survey_created' else 'visit_created' end,
      v_label || ' جديدة ' || coalesce(new.ref_no, '') || ' — ' || v_where,
      'الموعد ' || to_char(new.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), v_link, 'visit', new.id, 'vc:' || new.id);
    return null;
  end if;
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    perform app_private.notify_activity(new.company_id, 'visits.view', 'visit_started', 'بدء ' || v_label || ' ' || coalesce(new.ref_no, '') || ' — ' || v_where,
      null, v_link, 'visit', new.id, 'vs:' || new.id);
  end if;
  if new.closed_at is not null and old.closed_at is null then
    perform app_private.notify_activity(new.company_id, 'visits.view', case when new.visit_type = 'survey' then 'survey_completed' else 'visit_closed' end,
      case when new.visit_type = 'survey' then 'نتائج معاينة ' else 'إنهاء زيارة ' end || coalesce(new.ref_no, '') || ' — ' || v_where,
      case when new.visit_type = 'survey' then (select 'البنود: ' || count(*) || ' · الإجمالي قبل الضريبة: ' || coalesce(sum(quantity * unit_price), 0) || ' ر.س'
                                                from public.survey_items where visit_id = new.id) else null end,
      v_link, 'visit', new.id, 'vx:' || new.id || ':' || to_char(new.closed_at, 'YYYYMMDDHH24MISS'));
  end if;
  if (new.summary, new.technician_notes, new.recommendations) is distinct from (old.summary, old.technician_notes, old.recommendations)
     and new.closed_at is null then
    perform app_private.notify_activity(new.company_id, 'visits.view', 'visit_notes', 'ملاحظات على ' || v_label || ' ' || coalesce(new.ref_no, '') || ' — ' || v_where,
      left(coalesce(new.summary, new.technician_notes, new.recommendations, ''), 160), v_link, 'visit', new.id, 'vn:' || new.id || ':' || coalesce(auth.uid()::text, '') || ':' || v_hour);
  end if;
  return null;
end $$;
drop trigger if exists trg_visits_activity on public.visits;
create trigger trg_visits_activity after insert or update of status, closed_at, summary, technician_notes, recommendations on public.visits
  for each row execute function app_private.activity_visits();

create or replace function app_private.activity_devices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.notify_activity(new.company_id, 'devices.view', 'device_created', 'جهاز جديد: ' || new.name || ' (' || coalesce(new.ref_no, '') || ')',
    coalesce((select c.name from public.customers c where c.id = new.customer_id), '') || coalesce(' · ' || (select s.name from public.customer_sites s where s.id = new.site_id), ''),
    '/devices/' || new.id, 'device', new.id, 'dc:' || new.id);
  return null;
end $$;
drop trigger if exists trg_devices_activity on public.devices;
create trigger trg_devices_activity after insert on public.devices for each row execute function app_private.activity_devices();

create or replace function app_private.activity_attachments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if new.entity_type <> 'visit' then return null; end if;
  select id, ref_no, visit_type into v from public.visits where id = new.entity_id;
  if v.id is null then return null; end if;
  perform app_private.notify_activity(new.company_id, 'visits.view', 'photo_added', 'صور جديدة في ' || case when v.visit_type = 'survey' then 'المعاينة ' else 'الزيارة ' end || coalesce(v.ref_no, ''),
    null, '/visits/' || v.id || case when v.visit_type = 'survey' then '/survey' else '/run' end, 'visit', v.id,
    'ph:' || v.id || ':' || coalesce(auth.uid()::text, '') || ':' || to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDDHH24'));
  return null;
end $$;
drop trigger if exists trg_attachments_activity on public.attachments;
create trigger trg_attachments_activity after insert on public.attachments for each row execute function app_private.activity_attachments();

create or replace function app_private.activity_maintenance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- صيانة الزيارة الواحدة تُدمج في إشعار واحد (سجل لكل جهاز)
  perform app_private.notify_activity(new.company_id, 'maintenance.view', 'maintenance_done',
    case when new.visit_id is not null then 'صيانة مكتملة في الزيارة ' || coalesce((select ref_no from public.visits where id = new.visit_id), '')
         else 'صيانة مكتملة: ' || coalesce(new.device_name_snapshot, '') end, null,
    case when new.visit_id is not null then '/visits/' || new.visit_id else '/devices/' || new.device_id end,
    case when new.visit_id is not null then 'visit' else 'device' end, coalesce(new.visit_id, new.device_id),
    'md:' || coalesce(new.visit_id, new.id));
  return null;
end $$;
drop trigger if exists trg_maintenance_activity on public.maintenance_records;
create trigger trg_maintenance_activity after insert on public.maintenance_records for each row execute function app_private.activity_maintenance();

create or replace function app_private.activity_due_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if new.source not in ('manual', 'visit_override') then return null; end if;
  select id, name, ref_no into d from public.devices where id = new.device_id;
  perform app_private.notify_activity(new.company_id, 'devices.view', 'due_rescheduled', 'تعديل موعد صيانة: ' || coalesce(d.name, '') || ' (' || coalesce(d.ref_no, '') || ')',
    coalesce(to_char(new.old_date, 'YYYY-MM-DD'), '—') || ' ← ' || coalesce(to_char(new.new_date, 'YYYY-MM-DD'), '—') || coalesce(' · ' || left(new.reason, 150), ''),
    '/devices/' || new.device_id, 'device', new.device_id, 'dd:' || new.id);
  return null;
end $$;
drop trigger if exists trg_due_changes_activity on public.device_due_changes;
create trigger trg_due_changes_activity after insert on public.device_due_changes for each row execute function app_private.activity_due_changes();

create or replace function app_private.activity_quotations() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cust text := coalesce((select c.name from public.customers c where c.id = new.customer_id), '');
  v_title text := 'عرض سعر ' || coalesce(new.ref_no, '') || ' — ' || v_cust;
begin
  if tg_op = 'INSERT' then
    perform app_private.notify_activity(new.company_id, 'quotes.view', 'quote_created', 'عرض سعر جديد ' || coalesce(new.ref_no, '') || ' — ' || v_cust,
      null, '/quotes/' || new.id, 'quotation', new.id, 'qc:' || new.id);
    return null;
  end if;
  if new.status is distinct from old.status then
    perform app_private.notify_activity(new.company_id, 'quotes.view',
      case new.status when 'review' then 'quote_review' when 'sent' then 'quote_sent' when 'accepted' then 'quote_accepted'
                      when 'rejected' then 'quote_rejected' else 'quote_returned' end,
      case new.status when 'review' then 'بانتظار المراجعة: ' when 'sent' then 'أُرسل للعميل: ' when 'accepted' then 'قبِل العميل: '
                      when 'rejected' then 'رفض العميل: ' else 'أُعيد للإعداد: ' end || v_title,
      new.decision_note, '/quotes/' || new.id, 'quotation', new.id, 'qs:' || new.id || ':' || new.status || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  elsif (to_jsonb(new) - array['updated_at', 'archived_at', 'archived_by']) is distinct from (to_jsonb(old) - array['updated_at', 'archived_at', 'archived_by']) then
    perform app_private.notify_activity(new.company_id, 'quotes.view', 'quote_updated', 'تعديل ' || v_title, null, '/quotes/' || new.id, 'quotation', new.id,
      'qu:' || new.id || ':' || coalesce(auth.uid()::text, '') || ':' || to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDDHH24'));
  end if;
  return null;
end $$;
drop trigger if exists trg_quotations_activity on public.quotations;
create trigger trg_quotations_activity after insert or update on public.quotations for each row execute function app_private.activity_quotations();

create or replace function app_private.activity_quote_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record := coalesce(new, old); q record;
begin
  select id, company_id, ref_no, customer_id into q from public.quotations where id = r.quotation_id;
  if q.id is null or coalesce(current_setting('app.quote_work', true), '') <> '' then return null; end if;
  perform app_private.notify_activity(q.company_id, 'quotes.view', 'quote_updated', 'تعديل بنود عرض سعر ' || coalesce(q.ref_no, ''),
    null, '/quotes/' || q.id, 'quotation', q.id,
    'qu:' || q.id || ':' || coalesce(auth.uid()::text, '') || ':' || to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDDHH24'));
  return null;
end $$;
drop trigger if exists trg_quotation_items_activity on public.quotation_items;
create trigger trg_quotation_items_activity after insert or update or delete on public.quotation_items
  for each row execute function app_private.activity_quote_items();

-- الملخص التشغيلي اليومي: زيارات لم تُغلق بعد موعدها بيوم، وعروض بانتظار المراجعة
create or replace function app_private.run_ops_digest_for(p_company uuid, p_today date) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_open integer; v_review integer; r record; n integer := 0;
begin
  select count(*) into v_open from public.visits
  where company_id = p_company and archived_at is null and closed_at is null and status not in ('cancelled', 'missed', 'completed')
    and (scheduled_start at time zone 'Asia/Riyadh')::date < p_today - 1;
  select count(*) into v_review from public.quotations where company_id = p_company and archived_at is null and status = 'review';
  if v_open > 0 then
    for r in select f.user_id from app_private.company_followup_users(p_company) f loop
      perform app_private.notify(p_company, r.user_id, 'visits_unclosed', 'زيارات لم تُغلق: ' || v_open,
        'زيارات تجاوز موعدها يومًا ولم تُغلق بعد', '/visits?status=open', 'company', p_company, 'unclosed:' || to_char(p_today, 'YYYY-MM-DD'));
      n := n + 1;
    end loop;
  end if;
  if v_review > 0 then
    for r in select m.user_id from public.company_memberships m where m.company_id = p_company and m.status = 'active'
             and 'quotes.manage' = any (public.company_effective_permissions(m.role, m.permissions)) loop
      perform app_private.notify(p_company, r.user_id, 'quotes_pending', 'عروض أسعار بانتظار المراجعة: ' || v_review,
        'عروض أرسلها الفنيون للمراجعة والاعتماد', '/quotes?status=review', 'company', p_company, 'qreview:' || to_char(p_today, 'YYYY-MM-DD'));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

-- إشعارات فورية: نشر جدول الإشعارات عبر Supabase Realtime (يحترم RLS: كل مستخدم يتلقى إشعاراته فقط)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8) الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.item_brand_sync(), app_private.quotation_items_audit(), app_private.activity_visits(),
  app_private.activity_devices(), app_private.activity_attachments(), app_private.activity_maintenance(), app_private.activity_due_changes(),
  app_private.activity_quotations(), app_private.activity_quote_items() from public, anon, authenticated;
revoke all on function app_private.notify_activity(uuid, text, text, text, text, text, text, uuid, text),
  app_private.actor_name(uuid, uuid), app_private.run_ops_digest_for(uuid, date) from public, anon, authenticated;
revoke all on function app_private.quote_can_edit(uuid), app_private.quote_in_scope(uuid, uuid, uuid) from public, anon;
grant execute on function app_private.quote_can_edit(uuid), app_private.quote_in_scope(uuid, uuid, uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.company_mail_config(uuid)', 'public.company_mail_test_result(uuid, boolean, text)',
    'public.set_alert_lead_days(uuid, integer[])', 'public.quotation_from_visit(uuid)', 'public.quotation_set_status(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.shared_document(text) from public;
grant execute on function public.shared_document(text) to anon, authenticated;

notify pgrst, 'reload schema';
