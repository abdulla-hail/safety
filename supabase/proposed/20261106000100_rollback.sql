-- =====================================================================
-- التراجع عن 20261106000100_visit_inspections.sql (مولَّد من تعريفات وسياسات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بنود زيارات أو سجل تغيير مواعيد أو زيارات مغلقة/طارئة بالإجراء الجديد أو متابعات مسندة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.visit_devices) or exists (select 1 from public.device_due_changes)
     or exists (select 1 from public.visits where client_key is not null or closed_at is not null or urgent_reason is not null or close_exception_reason is not null)
     or exists (select 1 from public.maintenance_records where findings is not null or parts <> '[]'::jsonb)
     or exists (select 1 from public.device_faults where kind <> 'fault' or assigned_technician_id is not null or follow_up_due is not null or visit_id is not null)
     or exists (select 1 from public.company_memberships where permissions && array['visits.close_exception', 'maintenance.reschedule'])
     or exists (select 1 from public.company_invitations where permissions && array['visits.close_exception', 'maintenance.reschedule']) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

drop function if exists public.visit_close(uuid, text, text);
drop function if exists public.visit_save_item(uuid, jsonb, integer);
drop function if exists public.visit_remove_device(uuid);
drop function if exists public.visit_add_devices(uuid, uuid[]);
drop function if exists public.visit_start(uuid, uuid, text, text, uuid[], text);
drop function if exists app_private.visit_add_items(uuid, uuid[], text);
drop function if exists app_private.visit_fill_periodic(uuid);
drop function if exists public.device_set_next_due(uuid, date, text);

CREATE OR REPLACE FUNCTION public.devices_set_schedule(p_devices uuid[], p_months integer, p_start date DEFAULT NULL::date, p_recalculate boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

drop policy if exists ays_attachments_insert on public.attachments;
create policy ays_attachments_insert on public.attachments for insert to authenticated
  with check (company_has_any_perm(company_id, ARRAY[(app_private.attachment_module(entity_type) || '.update'::text), (app_private.attachment_module(entity_type) || '.create'::text), 'catalog.manage'::text]));
drop policy if exists ays_vt_insert on public.visit_technicians;
create policy ays_vt_insert on public.visit_technicians for insert to authenticated
  with check (company_has_any_perm(company_id, ARRAY['visits.create'::text, 'visits.update'::text]));
drop policy if exists ays_visits_update on public.visits;
create policy ays_visits_update on public.visits for update to authenticated
  using (company_has_any_perm(company_id, ARRAY['visits.update'::text, 'visits.archive'::text]))
  with check (company_has_any_perm(company_id, ARRAY['visits.update'::text, 'visits.archive'::text]));

drop trigger if exists trg_maintenance_via_visit on public.maintenance_records;
drop function if exists app_private.maintenance_via_visit();
drop trigger if exists trg_attachments_visit_open on public.attachments;
drop function if exists app_private.attachments_visit_open();
drop trigger if exists trg_visits_closed_guard on public.visits;
drop function if exists app_private.visits_closed_guard();
drop trigger if exists trg_devices_due_log on public.devices;
drop function if exists app_private.devices_due_log();
drop trigger if exists trg_devices_due_guard on public.devices;
drop function if exists app_private.devices_due_guard();
drop table if exists public.device_due_changes;
drop table if exists public.visit_devices;
drop function if exists app_private.visit_devices_guard();
drop function if exists app_private.visit_can_work(uuid);
drop function if exists app_private.my_technician(uuid);
revoke insert (kind, assigned_technician_id, follow_up_due) on public.device_faults from authenticated;
revoke update (assigned_technician_id, follow_up_due) on public.device_faults from authenticated;
alter table public.device_faults drop constraint if exists df_visit_fk;
alter table public.device_faults drop constraint if exists df_assignee_fk;
alter table public.device_faults drop column if exists visit_id;
alter table public.device_faults drop column if exists follow_up_due;
alter table public.device_faults drop column if exists assigned_technician_id;
alter table public.device_faults drop column if exists kind;
alter table public.maintenance_records drop constraint if exists maintenance_records_parts_array;
alter table public.maintenance_records drop column if exists parts;
alter table public.maintenance_records drop column if exists findings;
drop index if exists public.visits_one_open_periodic;
drop index if exists public.visits_client_key;
alter table public.visits drop column if exists close_exception_reason;
alter table public.visits drop column if exists closed_by;
alter table public.visits drop column if exists closed_at;
alter table public.visits drop column if exists urgent_reason;
alter table public.visits drop column if exists client_key;
delete from public.company_role_permissions where permission_key in ('visits.close_exception', 'maintenance.reschedule');
delete from public.permission_definitions where key in ('visits.close_exception', 'maintenance.reschedule');

notify pgrst, 'reload schema';
