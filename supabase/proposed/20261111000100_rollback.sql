-- =====================================================================
-- التراجع عن 20261111000100_brands_tech_quotes_activity.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بيانات تعتمد على الترحيل (ماركات، بريد شركة، تفضيلات إشعارات، عروض بانتظار المراجعة، عملاء «مؤسسة»،
-- إشعارات أنشطة، أو مواعيد تنبيه مخصصة).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.brands) or exists (select 1 from public.company_mail_settings)
     or exists (select 1 from public.notification_preferences) or exists (select 1 from public.quotations where status = 'review' or submitted_at is not null)
     or exists (select 1 from public.customers where customer_type = 'establishment')
     or exists (select 1 from public.notifications where actor_user_id is not null)
     or exists (select 1 from public.survey_items where brand is not null) or exists (select 1 from public.quotation_items where brand is not null)
     or exists (select 1 from public.companies where alert_lead_days <> '{30,15,7,1}')
     or exists (select 1 from public.company_invitations where 'quotes.create' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end $$;
drop trigger if exists trg_visits_activity on public.visits;
drop trigger if exists trg_devices_activity on public.devices;
drop trigger if exists trg_attachments_activity on public.attachments;
drop trigger if exists trg_maintenance_activity on public.maintenance_records;
drop trigger if exists trg_due_changes_activity on public.device_due_changes;
drop trigger if exists trg_quotations_activity on public.quotations;
drop trigger if exists trg_quotation_items_activity on public.quotation_items;
drop trigger if exists trg_quotation_items_audit on public.quotation_items;
drop trigger if exists trg_survey_items_brand on public.survey_items;
drop trigger if exists trg_quotation_items_brand on public.quotation_items;
drop function if exists app_private.activity_visits();
drop function if exists app_private.activity_devices();
drop function if exists app_private.activity_attachments();
drop function if exists app_private.activity_maintenance();
drop function if exists app_private.activity_due_changes();
drop function if exists app_private.activity_quotations();
drop function if exists app_private.activity_quote_items();
drop function if exists app_private.quotation_items_audit();
drop function if exists app_private.item_brand_sync();

CREATE OR REPLACE FUNCTION app_private.quotations_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.quotation_items_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.quotation_from_visit(p_visit uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.quotation_set_status(p_quote uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.shared_document(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.run_maintenance_alerts_for(p_company uuid, p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

drop function if exists app_private.run_ops_digest_for(uuid, date);
drop function if exists app_private.notify_activity(uuid, text, text, text, text, text, text, uuid, text);
drop function if exists app_private.actor_name(uuid, uuid);
drop function if exists public.set_alert_lead_days(uuid, integer[]);
drop function if exists public.company_mail_test_result(uuid, boolean, text);
drop function if exists public.company_mail_config(uuid);

drop policy if exists ays_qi_delete on public.quotation_items;
create policy ays_qi_delete on public.quotation_items for delete to authenticated using (company_has_perm(company_id, 'quotes.manage'::text));
drop policy if exists ays_qi_insert on public.quotation_items;
create policy ays_qi_insert on public.quotation_items for insert to authenticated with check (company_has_perm(company_id, 'quotes.manage'::text));
drop policy if exists ays_qi_update on public.quotation_items;
create policy ays_qi_update on public.quotation_items for update to authenticated using (company_has_perm(company_id, 'quotes.manage'::text)) with check (company_has_perm(company_id, 'quotes.manage'::text));
drop policy if exists ays_qt_insert on public.quotations;
create policy ays_qt_insert on public.quotations for insert to authenticated with check (company_has_perm(company_id, 'quotes.manage'::text));
drop policy if exists ays_qt_select on public.quotations;
create policy ays_qt_select on public.quotations for select to authenticated using (company_has_any_perm(company_id, ARRAY['quotes.view'::text, 'quotes.manage'::text]));
drop policy if exists ays_qt_update on public.quotations;
create policy ays_qt_update on public.quotations for update to authenticated using (company_has_perm(company_id, 'quotes.manage'::text)) with check (company_has_perm(company_id, 'quotes.manage'::text));
drop function if exists app_private.quote_can_edit(uuid);
drop function if exists app_private.quote_in_scope(uuid, uuid, uuid);

alter table customers drop constraint if exists customers_customer_type_check;
alter table customers add constraint customers_customer_type_check CHECK ((customer_type = ANY (ARRAY['company'::text, 'government'::text, 'individual'::text])));
alter table quotations drop constraint if exists quotations_status_check;
alter table quotations add constraint quotations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text])));

drop table if exists public.notification_preferences;
drop table if exists public.company_mail_settings;
alter table public.notifications drop column if exists actor_user_id;
alter table public.companies drop constraint if exists companies_alert_lead_days_chk;
alter table public.companies drop column if exists alert_lead_days;
alter table public.quotations drop column if exists submitted_at, drop column if exists approved_by, drop column if exists approved_at;
alter table public.survey_items drop column if exists brand_id, drop column if exists brand;
alter table public.quotation_items drop column if exists brand_id, drop column if exists brand;
drop table if exists public.brands;

-- عضويات الفنيين التي عدّلها الترحيل: تُعاد صلاحياتها ووقت آخر تحديث كما كانت بالضبط من النسخة المحفوظة،
-- ما لم تُعدَّل بعد الترحيل (عندها يُزال quotes.create فقط ويبقى تعديل المدير). مُشغّل اللمس يُوقف مؤقتًا داخل المعاملة فقط.
do $$ begin
  if to_regclass('app_private.migration_0111_memberships') is not null then
    alter table public.company_memberships disable trigger company_memberships_touch;
    update public.company_memberships m set permissions = b.permissions, updated_at = b.updated_at
    from app_private.migration_0111_memberships b
    where m.id = b.membership_id and m.permissions = array_append(b.permissions, 'quotes.create') and m.updated_at = b.migrated_at;
    alter table public.company_memberships enable trigger company_memberships_touch;
  end if;
end $$;
update public.company_memberships set permissions = array_remove(permissions, 'quotes.create') where 'quotes.create' = any (permissions);
drop table if exists app_private.migration_0111_memberships;
delete from public.company_role_permissions where permission_key = 'quotes.create';
delete from public.permission_definitions where key = 'quotes.create';

notify pgrst, 'reload schema';
