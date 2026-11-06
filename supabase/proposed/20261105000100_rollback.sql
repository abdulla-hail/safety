-- =====================================================================
-- التراجع عن 20261105000100_visits_faults_history.sql (مولَّد من تعريفات وقيود cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بلاغات أو تصحيحات أو صور مصنفة أو بيانات زيارة/فحص جديدة أو حالات جهاز جديدة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_faults) or exists (select 1 from public.maintenance_corrections)
     or exists (select 1 from public.attachments where photo_stage is not null or device_id is not null or entity_type = 'fault')
     or exists (select 1 from public.visits where visit_type <> 'periodic' or outcome is not null or recommendations is not null or follow_up_status <> 'none')
     or exists (select 1 from public.maintenance_records where readings <> '{}'::jsonb or actions_taken is not null or recommendations is not null)
     or exists (select 1 from public.devices where status in ('faulty', 'replaced') or replaced_by_device_id is not null)
     or exists (select 1 from public.maintenance_records where status_after in ('faulty', 'replaced'))
     or exists (select 1 from public.company_memberships where permissions && array['faults.view', 'faults.create', 'faults.update', 'maintenance.correct'])
     or exists (select 1 from public.company_invitations where permissions && array['faults.view', 'faults.create', 'faults.update', 'maintenance.correct']) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل';
  end if;
end $$;

CREATE OR REPLACE FUNCTION app_private.attachment_module(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_type when 'device' then 'devices' when 'customer' then 'customers' when 'site' then 'sites'
    when 'work_order' then 'work_orders' when 'visit' then 'visits' when 'maintenance' then 'maintenance'
    when 'catalog_item' then 'catalog' when 'technician' then 'technicians' end
$function$;

CREATE OR REPLACE FUNCTION app_private.attachment_entity_visible(p_type text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
end $function$;

drop function if exists public.fault_transition(uuid, text, text, uuid, text, text);
drop function if exists public.maintenance_correct(uuid, text, jsonb, text);
alter table public.maintenance_records drop constraint if exists mr_fault_fk;
alter table public.maintenance_records drop column if exists fault_id;
drop table if exists public.device_fault_events;
drop table if exists public.device_faults;
drop function if exists app_private.faults_after_insert();
drop function if exists app_private.faults_before_insert();
drop trigger if exists trg_attachments_device on public.attachments;
drop function if exists app_private.attachments_check_device();
alter table public.attachments drop constraint if exists attachments_device_fk;
drop index if exists public.attachments_device_idx;
alter table public.attachments drop column if exists device_id;
alter table public.attachments drop column if exists photo_stage;
alter table public.attachments drop constraint if exists attachments_entity_type_check;
drop table if exists public.maintenance_corrections;
drop trigger if exists trg_maintenance_condition on public.maintenance_records;
drop function if exists app_private.maintenance_capture_condition();
alter table public.maintenance_records drop column if exists recommendations;
alter table public.maintenance_records drop column if exists actions_taken;
alter table public.maintenance_records drop column if exists readings;
alter table public.maintenance_records drop column if exists condition_before;
alter table public.visits drop column if exists follow_up_status;
alter table public.visits drop column if exists recommendations;
alter table public.visits drop column if exists outcome;
alter table public.visits drop column if exists visit_type;
alter table public.devices drop constraint if exists devices_replaced_by_fk;
alter table public.devices drop column if exists replaced_by_device_id;
alter table public.devices drop constraint if exists devices_status_check;
alter table public.maintenance_records drop constraint if exists maintenance_records_status_after_check;
alter table devices add constraint devices_status_check CHECK ((status = ANY (ARRAY['operational'::text, 'needs_maintenance'::text, 'under_repair'::text, 'out_of_service'::text, 'expired'::text, 'decommissioned'::text])));
alter table maintenance_records add constraint maintenance_records_status_after_check CHECK ((status_after = ANY (ARRAY['operational'::text, 'needs_maintenance'::text, 'under_repair'::text, 'out_of_service'::text, 'expired'::text, 'decommissioned'::text])));
alter table attachments add constraint attachments_entity_type_check CHECK ((entity_type = ANY (ARRAY['device'::text, 'customer'::text, 'site'::text, 'work_order'::text, 'visit'::text, 'maintenance'::text, 'catalog_item'::text, 'technician'::text])));
delete from public.company_role_permissions where permission_key in ('faults.view', 'faults.create', 'faults.update', 'maintenance.correct');
delete from public.permission_definitions where key in ('faults.view', 'faults.create', 'faults.update', 'maintenance.correct');

notify pgrst, 'reload schema';
