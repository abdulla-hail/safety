-- =====================================================================
-- التراجع عن 20261110000100_surveys_quotes_maps.sql
-- يرفض التنفيذ إذا وُجدت معاينات أو بنودها أو عروض أسعار أو روابط مشاركة أو مواقع فروع مسجلة بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.survey_items) or exists (select 1 from public.quotations) or exists (select 1 from public.share_links)
     or exists (select 1 from public.visits where visit_type = 'survey' or survey_vat is not true)
     or exists (select 1 from public.customer_sites where latitude is not null)
     or exists (select 1 from public.attachments where survey_item_id is not null)
     or exists (select 1 from public.company_memberships where permissions && array['quotes.view', 'quotes.manage'])
     or exists (select 1 from public.company_invitations where permissions && array['quotes.view', 'quotes.manage']) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;

drop policy if exists ays_files_shared_read on storage.objects;
drop function if exists public.storage_shared_allowed(text, text);
drop function if exists public.shared_document(text);
drop function if exists app_private.share_active(text, uuid);
drop function if exists public.share_revoke(uuid);
drop function if exists public.share_create(text, uuid, integer);
drop table if exists public.share_links;
drop function if exists public.quotation_set_status(uuid, text, text);
drop function if exists public.quotation_from_visit(uuid);
drop table if exists public.quotation_items;
drop table if exists public.quotations;
drop function if exists app_private.quotation_items_guard();
drop function if exists app_private.quotations_guard();
drop function if exists public.survey_reopen(uuid, text);
drop function if exists public.survey_complete(uuid);
drop function if exists public.survey_create(uuid, uuid, timestamptz, uuid, text);
drop trigger if exists trg_attachments_survey_item on public.attachments;
drop function if exists app_private.attachments_survey_item_check();
drop index if exists public.attachments_survey_item_idx;
alter table public.attachments drop column if exists survey_item_id;
drop table if exists public.survey_items;
drop function if exists app_private.survey_items_guard();
alter table public.visits drop column if exists survey_vat;
alter table public.visits drop constraint if exists visits_visit_type_check;
alter table public.visits add constraint visits_visit_type_check
  check (visit_type in ('periodic', 'emergency', 'repair', 'reinspection', 'installation', 'other'));
alter table public.customer_sites drop constraint if exists customer_sites_latlng_check;
alter table public.customer_sites drop column if exists longitude;
alter table public.customer_sites drop column if exists latitude;
delete from public.company_role_permissions where permission_key in ('quotes.view', 'quotes.manage');
delete from public.permission_definitions where key in ('quotes.view', 'quotes.manage');

notify pgrst, 'reload schema';
