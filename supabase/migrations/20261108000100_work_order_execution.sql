-- =====================================================================
-- عين السلامة — م5ج: تنفيذ أوامر العمل بالزيارة، تقرير الزيارة، بلاغات أثناء الزيارة، تصنيف الصور وحذفها الآمن
-- (مشروع cgwnusudjhhxkwnqjzfr). يتطلب 20261106000100 و20261107000100.
--
-- 1) بدء زيارة من أمر عمل: الفني المعيَّن للأمر (أو من يملك جدولة الزيارات ويرى الأمر) يبدأ زيارة واحدة مفتوحة للأمر
--    (لا تكرار: مفتاح عميل + فهرس زيارة مفتوحة واحدة لكل أمر)، بنوع يطابق نوع الأمر وأجهزته؛ الأمر يصير «قيد التنفيذ».
--    إغلاق الزيارة يُكمل الأمر (أو يبقيه قيد التنفيذ إن أُغلقت ناقصة باستثناء).
-- 2) الفني المعيَّن لأمر عمل أو زيارة يرى عميلها وموقعها وأجهزتها وسجلات صيانتها (قراءة فقط) حتى خارج نطاق إسناده.
-- 3) تقرير الزيارة وملاحظات الفني: حفظ تدريجي قبل الإغلاق، ويُجمَّد بعده (حارس الزيارة المغلقة القائم).
-- 4) بلاغ عطل أثناء الزيارة مرتبط بالزيارة وأمر العمل والعميل والموقع والجهاز، بالوصف والخطورة والحالة والإجراء والتوصية؛
--    منع التكرار بمفتاح عميل؛ الجهاز يُضاف لبنود الزيارة إن لم يكن فيها.
-- 5) تصنيف الصور: عامة/قبل/بعد/توثيق عطل/أخرى. الحذف النهائي: قبل الإغلاق لرافع الملف أو من يملك الحذف، وبعده لمن يملك
--    الحذف فقط؛ يُحذف السجل ويُدقق ثم يُزال الملف من التخزين (سياسة تسمح بإزالة الملفات غير المرتبطة بأي سجل فقط).
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

do $$ begin
  if to_regclass('public.visit_devices') is null then raise exception 'طبّق 20261106000100 أولًا'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الأعمدة
-- ---------------------------------------------------------------------
alter table public.visits add column if not exists technician_notes text;
alter table public.device_faults add column if not exists action_taken text;
alter table public.device_faults add column if not exists recommendation text;
alter table public.device_faults add column if not exists client_key uuid;
create unique index if not exists device_faults_client_key on public.device_faults (company_id, client_key) where client_key is not null;
create unique index if not exists visits_one_open_per_work_order on public.visits (work_order_id)
  where work_order_id is not null and closed_at is null and status in ('scheduled', 'in_progress') and archived_at is null;

do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.attachments'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%photo_stage%' loop
    execute format('alter table public.attachments drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.attachments add constraint attachments_photo_stage_check
  check (photo_stage in ('general', 'before', 'after', 'fault', 'other'));

-- ---------------------------------------------------------------------
-- 2) رؤية عمل الفني المعيَّن (أمر عمل أو زيارة) خارج نطاق إسناده — قراءة فقط
-- ---------------------------------------------------------------------
create or replace function app_private.assigned_work_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_orders w where w.customer_id = p_customer and w.archived_at is null and app_private.is_assigned_work_order(w.id))
      or exists (select 1 from public.visits v where v.customer_id = p_customer and v.archived_at is null and app_private.is_assigned_visit(v.id))
$$;
create or replace function app_private.assigned_work_site(p_site uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_orders w where w.site_id = p_site and w.archived_at is null and app_private.is_assigned_work_order(w.id))
      or exists (select 1 from public.visits v where v.site_id = p_site and v.archived_at is null and app_private.is_assigned_visit(v.id))
$$;
create or replace function app_private.assigned_work_device(p_device uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_order_devices d join public.work_orders w on w.id = d.work_order_id
                 where d.device_id = p_device and w.archived_at is null and app_private.is_assigned_work_order(w.id))
      or exists (select 1 from public.visit_devices d where d.device_id = p_device and app_private.is_assigned_visit(d.visit_id))
$$;

-- يُضاف شرط العمل المعيَّن إلى سياسات القراءة القائمة كما هي (يُقرأ نصها الحالي فلا يتغير ما سبق)
do $$
declare r record; extra text;
begin
  for r in select tablename, policyname, qual from pg_policies where schemaname = 'public'
           and (tablename, policyname) in (('customers', 'ays_customers_select'), ('customer_sites', 'ays_customer_sites_select'),
                                           ('devices', 'ays_devices_select'), ('maintenance_records', 'ays_mr_select')) loop
    continue when r.qual like '%assigned_work_%' or r.qual like '%is_assigned_visit(visit_id)%';
    extra := case r.tablename
      when 'customers' then 'app_private.assigned_work_customer(id)'
      when 'customer_sites' then 'app_private.assigned_work_site(id)'
      when 'devices' then 'app_private.assigned_work_device(id)'
      when 'maintenance_records' then '(visit_id is not null and app_private.is_assigned_visit(visit_id))' end;
    execute format('alter policy %I on public.%I using ((%s) or (public.company_is_member(company_id) and %s))', r.policyname, r.tablename, r.qual, extra);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) بدء زيارة من أمر عمل
-- ---------------------------------------------------------------------
create or replace function public.work_order_start_visit(p_wo uuid, p_client_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w record; v_id uuid; v_type text; v_reason text; v_tech uuid; v_devs uuid[]; v_open record;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'أمر العمل غير موجود' using errcode = 'P0002'; end if;
  if not ((app_private.is_assigned_work_order(w.id) and public.company_has_perm(w.company_id, 'visits.update'))
          or (public.company_has_perm(w.company_id, 'visits.create') and public.company_can_view_site(w.company_id, w.customer_id, w.site_id, 'work_orders'))) then
    raise exception 'أمر العمل غير مسند إليك' using errcode = '42501';
  end if;
  if w.archived_at is not null or w.status in ('completed', 'cancelled') then raise exception 'أمر العمل مغلق أو مؤرشف' using errcode = 'P0001'; end if;
  if w.site_id is null then raise exception 'حدد موقع أمر العمل أولًا حتى تُحدَّد أجهزة الزيارة' using errcode = 'P0001'; end if;
  if p_client_key is not null then
    select id into v_id from public.visits where company_id = w.company_id and client_key = p_client_key;
    if v_id is not null then return v_id; end if;
  end if;
  v_tech := app_private.my_technician(w.company_id);
  v_type := case w.order_type when 'preventive' then 'periodic' when 'emergency' then 'emergency' when 'corrective' then 'repair'
                              when 'inspection' then 'reinspection' else 'installation' end;
  v_reason := case w.order_type when 'emergency' then 'fault' when 'corrective' then 'repair' when 'inspection' then 'reinspection'
                                when 'preventive' then null else 'other' end;
  select coalesce(array_agg(d.id), '{}') into v_devs from public.work_order_devices x join public.devices d on d.id = x.device_id
  where x.work_order_id = w.id and d.site_id = w.site_id and d.archived_at is null and d.status not in ('decommissioned', 'replaced');

  perform set_config('app.visit_work', '1', true);
  -- زيارة مفتوحة للأمر (مثل زيارة جدولها المشرف): تُستأنف
  select id, status into v_open from public.visits where work_order_id = w.id and closed_at is null
    and status in ('scheduled', 'in_progress') and archived_at is null for update;
  v_id := v_open.id;
  if v_id is null and v_type = 'periodic' then
    -- الزيارة الدورية المفتوحة للموقع (إن وُجدت) تُربط بالأمر بدل إنشاء ثانية
    select id, work_order_id into v_open from public.visits where site_id = w.site_id and visit_type = 'periodic' and closed_at is null
      and status in ('scheduled', 'in_progress') and archived_at is null for update;
    if v_open.id is not null then
      if v_open.work_order_id is not null and v_open.work_order_id <> w.id then
        raise exception 'للموقع زيارة دورية مفتوحة مرتبطة بأمر عمل آخر؛ أكملها أولًا' using errcode = 'P0001';
      end if;
      update public.visits set work_order_id = w.id where id = v_open.id;
      v_id := v_open.id;
    end if;
  end if;
  if v_id is null then
    insert into public.visits (company_id, customer_id, site_id, work_order_id, scheduled_start, status, actual_start, visit_type, urgent_reason, client_key, notes, created_by)
    values (w.company_id, w.customer_id, w.site_id, w.id, now(), 'in_progress', now(), v_type, v_reason, p_client_key,
      left(concat_ws(E'\n', w.title, nullif(btrim(w.description), '')), 2000), auth.uid())
    returning id into v_id;
  else
    update public.visits set status = 'in_progress', actual_start = coalesce(actual_start, now()) where id = v_id and status = 'scheduled';
  end if;
  if (select visit_type from public.visits where id = v_id) = 'periodic' then
    perform app_private.visit_fill_periodic(v_id);
  elsif cardinality(v_devs) > 0 then
    perform app_private.visit_add_items(v_id, (select array_agg(x) from unnest(v_devs) x
      where not exists (select 1 from public.visit_devices vd where vd.visit_id = v_id and vd.device_id = x)),
      case when w.order_type = 'corrective' then 'repair' else 'inspection' end)
    where exists (select 1 from unnest(v_devs) x where not exists (select 1 from public.visit_devices vd where vd.visit_id = v_id and vd.device_id = x));
  end if;
  perform set_config('app.visit_work', '1', true);
  update public.work_orders set status = 'in_progress' where id = w.id and status in ('new', 'scheduled', 'on_hold');
  perform set_config('app.visit_work', '', true);
  if v_tech is not null then
    insert into public.visit_technicians (visit_id, technician_id, company_id, created_by) values (v_id, v_tech, w.company_id, auth.uid())
    on conflict do nothing;
  end if;
  perform public.company_audit(w.company_id, 'work_order_visit_started', 'work_order', w.id, jsonb_build_object('visit_id', v_id, 'ref_no', w.ref_no));
  return v_id;
end $$;

-- إغلاق زيارة أمر العمل يُكمل الأمر؛ الإغلاق الناقص (باستثناء) يبقيه قيد التنفيذ
create or replace function app_private.visits_close_work_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.closed_at is null and new.closed_at is not null and new.work_order_id is not null then
    update public.work_orders set
      status = case when new.outcome = 'incomplete' then 'in_progress' else 'completed' end,
      completed_at = case when new.outcome = 'incomplete' then completed_at else coalesce(completed_at, now()) end
    where id = new.work_order_id and status <> 'cancelled' and archived_at is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_visits_close_work_order on public.visits;
create trigger trg_visits_close_work_order after update of closed_at on public.visits
  for each row execute function app_private.visits_close_work_order();

-- ---------------------------------------------------------------------
-- 4) تقرير الزيارة وملاحظات الفني (حفظ تدريجي قبل الإغلاق)
-- ---------------------------------------------------------------------
create or replace function public.visit_save_report(p_visit uuid, p_summary text, p_technician_notes text, p_recommendations text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v record; v_at timestamptz;
begin
  select id, closed_at, status into v from public.visits where id = p_visit for update;
  if v.id is null or not app_private.visit_can_work(p_visit) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if v.closed_at is not null or v.status in ('completed', 'cancelled') then raise exception 'الزيارة مغلقة؛ التقرير سجل تاريخي لا يُعدَّل' using errcode = 'P0001'; end if;
  update public.visits set summary = left(nullif(btrim(p_summary), ''), 4000), technician_notes = left(nullif(btrim(p_technician_notes), ''), 4000),
    recommendations = left(nullif(btrim(p_recommendations), ''), 4000)
  where id = p_visit returning updated_at into v_at;
  return v_at;
end $$;

-- ---------------------------------------------------------------------
-- 5) بلاغ عطل أثناء الزيارة
-- ---------------------------------------------------------------------
create or replace function public.visit_report_fault(p_visit uuid, p_device uuid, p_client_key uuid, p_description text, p_severity text,
  p_status text, p_action text, p_recommendation text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v record; d record; v_id uuid;
begin
  select * into v from public.visits where id = p_visit for update;
  if v.id is null or not app_private.visit_can_work(p_visit) then raise exception 'ليست لديك صلاحية على هذه الزيارة' using errcode = '42501'; end if;
  if not public.company_has_perm(v.company_id, 'faults.create') then raise exception 'ليست لديك صلاحية تسجيل البلاغات' using errcode = '42501'; end if;
  if v.closed_at is not null or v.status in ('completed', 'cancelled') then raise exception 'الزيارة مغلقة' using errcode = 'P0001'; end if;
  if p_client_key is not null then
    select id into v_id from public.device_faults where company_id = v.company_id and client_key = p_client_key;
    if v_id is not null then return v_id; end if;
  end if;
  select id, site_id, status, archived_at into d from public.devices where id = p_device and company_id = v.company_id;
  if d.id is null or d.site_id is distinct from v.site_id or d.archived_at is not null then
    raise exception 'الجهاز ليس جهازًا نشطًا في موقع الزيارة' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'صف العطل' using errcode = '22023'; end if;
  if coalesce(p_severity, '') not in ('low', 'medium', 'high', 'critical') then raise exception 'درجة الخطورة غير صالحة' using errcode = '22023'; end if;
  if coalesce(p_status, 'open') not in ('open', 'in_progress', 'awaiting_verification') then raise exception 'حالة البلاغ غير صالحة' using errcode = '22023'; end if;
  if p_status = 'awaiting_verification' and length(btrim(coalesce(p_action, ''))) < 3 then
    raise exception 'اذكر الإجراء المتخذ لإصلاح العطل' using errcode = '22023';
  end if;
  if not exists (select 1 from public.visit_devices where visit_id = p_visit and device_id = p_device) then
    perform app_private.visit_add_items(p_visit, array[p_device], 'repair');
  end if;
  insert into public.device_faults (company_id, device_id, source, severity, description, kind, work_order_id, visit_id, action_taken,
    recommendation, client_key, reported_by, created_by)
  values (v.company_id, p_device, 'technician', p_severity, left(btrim(p_description), 2000), 'fault', v.work_order_id, p_visit,
    left(nullif(btrim(p_action), ''), 2000), left(nullif(btrim(p_recommendation), ''), 2000), p_client_key, auth.uid(), auth.uid())
  returning id into v_id;
  if coalesce(p_status, 'open') <> 'open' then
    update public.device_faults set status = p_status,
      resolution = case when p_status = 'awaiting_verification' then left(btrim(p_action), 2000) end,
      resolved_at = case when p_status = 'awaiting_verification' then now() end,
      resolved_by = case when p_status = 'awaiting_verification' then auth.uid() end
    where id = v_id;
    insert into public.device_fault_events (company_id, fault_id, from_status, to_status, note, actor_id)
    values (v.company_id, v_id, 'open', p_status, left(nullif(btrim(p_action), ''), 300), auth.uid());
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6) حذف مرفق محفوظ (نهائي) بصلاحية وتدقيق
--    الترتيب: يُزال الملف من التخزين أولًا (سياسة التخزين تسمح فقط لمن يحق له حذف سجله) ثم يُحذف السجل ويُدقق.
--    فشل الإزالة لا يغيّر شيئًا؛ وإعادة المحاولة بعد إزالة الملف تحذف السجل فقط.
-- ---------------------------------------------------------------------
create or replace function app_private.attachment_deletable(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare a record; v record;
begin
  select id, company_id, entity_type, entity_id, created_by into a from public.attachments where id = p_id;
  if a.id is null then return false; end if;
  if a.entity_type = 'visit' then
    select id, closed_at, status into v from public.visits where id = a.entity_id;
    return public.company_has_perm(a.company_id, 'visits.delete')
      or (v.closed_at is null and v.status not in ('completed', 'cancelled') and a.created_by = auth.uid() and app_private.visit_can_work(a.entity_id));
  end if;
  return public.company_has_perm(a.company_id, app_private.attachment_module(a.entity_type) || '.delete');
end $$;

create or replace function public.attachment_delete(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.attachments where id = p_id for update;
  if a.id is null then raise exception 'المرفق غير موجود' using errcode = 'P0002'; end if;
  if not app_private.attachment_deletable(p_id) then
    raise exception 'لا يمكنك حذف هذا المرفق: الحذف النهائي لرافعه قبل إغلاق الزيارة، أو لمن يملك صلاحية الحذف' using errcode = '42501';
  end if;
  delete from public.attachments where id = p_id;
  perform public.company_audit(a.company_id, 'attachment_deleted', 'attachment', a.id, jsonb_build_object('entity_type', a.entity_type,
    'entity_id', a.entity_id, 'file_name', a.file_name, 'photo_stage', a.photo_stage, 'device_id', a.device_id, 'storage_path', a.storage_path));
  return a.storage_path;
end $$;

-- إزالة ملف مرفق من التخزين: فقط لمن يحق له حذف سجله (نفس قاعدة attachment_delete)
drop policy if exists ays_files_delete on storage.objects;
create policy ays_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-files'
    and exists (select 1 from public.attachments a where a.storage_path = objects.name and app_private.attachment_deletable(a.id)));

-- زيارة أمر العمل ينفّذها المعيَّنون له أو لها، أو من يملك جدولة الزيارات؛ لا يكفي نطاق الموقع وحده
create or replace function app_private.visit_can_work(p_visit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visits v where v.id = p_visit and v.archived_at is null
    and public.company_has_perm(v.company_id, 'visits.update')
    and (public.company_can_view_site(v.company_id, v.customer_id, v.site_id, 'visits') or app_private.is_assigned_visit(v.id))
    and (v.work_order_id is null or app_private.is_assigned_visit(v.id) or app_private.is_assigned_work_order(v.work_order_id)
         or public.company_has_perm(v.company_id, 'visits.create')))
$$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function app_private.visits_close_work_order() from public, anon, authenticated;
revoke all on function app_private.attachment_deletable(uuid) from public, anon;
grant execute on function app_private.attachment_deletable(uuid) to authenticated;
revoke all on function app_private.assigned_work_customer(uuid), app_private.assigned_work_site(uuid), app_private.assigned_work_device(uuid) from public, anon;
grant execute on function app_private.assigned_work_customer(uuid), app_private.assigned_work_site(uuid), app_private.assigned_work_device(uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.work_order_start_visit(uuid, uuid)', 'public.visit_save_report(uuid, text, text, text)',
    'public.visit_report_fault(uuid, uuid, uuid, text, text, text, text, text)', 'public.attachment_delete(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
