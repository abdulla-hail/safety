-- =====================================================================
-- التراجع عن 20261108000100_work_order_execution.sql (مولَّد من سياسات وقيود cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بيانات تعتمد على الترحيل (ملاحظات فني، بلاغات بإجراء/توصية/مفتاح، صور بتصنيف جديد).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.visits where technician_notes is not null)
     or exists (select 1 from public.device_faults where action_taken is not null or recommendation is not null or client_key is not null)
     or exists (select 1 from public.attachments where photo_stage in ('fault', 'other')) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

drop policy if exists ays_files_delete on storage.objects;
drop function if exists public.attachment_delete(uuid);
drop function if exists app_private.attachment_deletable(uuid);
CREATE OR REPLACE FUNCTION app_private.visit_can_work(p_visit uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.visits v where v.id = p_visit and v.archived_at is null
    and public.company_has_perm(v.company_id, 'visits.update')
    and (public.company_can_view_site(v.company_id, v.customer_id, v.site_id, 'visits') or app_private.is_assigned_visit(v.id)))
$function$;
drop function if exists public.visit_report_fault(uuid, uuid, uuid, text, text, text, text, text);
drop function if exists public.visit_save_report(uuid, text, text, text);
drop trigger if exists trg_visits_close_work_order on public.visits;
drop function if exists app_private.visits_close_work_order();
drop function if exists public.work_order_start_visit(uuid, uuid);
alter policy ays_customer_sites_select on public.customer_sites using (company_can_view_site(company_id, customer_id, id, 'sites'::text));
alter policy ays_customers_select on public.customers using (company_can_view_customer(company_id, id, 'customers'::text));
alter policy ays_devices_select on public.devices using (company_can_view_site(company_id, customer_id, site_id, 'devices'::text));
alter policy ays_mr_select on public.maintenance_records using (company_can_view_site(company_id, customer_id, site_id, 'maintenance'::text));
drop function if exists app_private.assigned_work_customer(uuid);
drop function if exists app_private.assigned_work_site(uuid);
drop function if exists app_private.assigned_work_device(uuid);
alter table public.attachments drop constraint if exists attachments_photo_stage_check;
alter table public.attachments add constraint attachments_photo_stage_check CHECK ((photo_stage = ANY (ARRAY['before'::text, 'after'::text, 'general'::text])));
drop index if exists public.visits_one_open_per_work_order;
drop index if exists public.device_faults_client_key;
alter table public.device_faults drop column if exists client_key;
alter table public.device_faults drop column if exists recommendation;
alter table public.device_faults drop column if exists action_taken;
alter table public.visits drop column if exists technician_notes;

notify pgrst, 'reload schema';
