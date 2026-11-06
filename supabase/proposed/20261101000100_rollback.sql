-- =====================================================================
-- التراجع عن 20261101000100_company_edit_delete.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- لا يعيد شركات حُذفت بعد الترحيل (لقطتها في سجل التدقيق)؛ يرفض التنفيذ إن وُجد حذف بالآلية الجديدة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_audit_log where action = 'company_deleted') then
    raise exception 'التراجع مرفوض: حُذفت شركات بالآلية الجديدة؛ راجع سجل التدقيق أولًا';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.platform_delete_company(p_company uuid, p_confirm_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.companies;
begin
  perform public.require_platform_perm('platform.companies.delete');
  select * into v from public.companies where id = p_company for update;
  if v.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if v.status <> 'archived' then raise exception 'يجب أرشفة الشركة قبل حذفها' using errcode = 'P0001'; end if;
  if upper(btrim(coalesce(p_confirm_ref, ''))) <> v.ref_no then raise exception 'رقم التأكيد لا يطابق رقم الشركة' using errcode = '22023'; end if;
  if exists (select 1 from public.company_memberships where company_id = p_company) then
    raise exception 'للشركة عضويات مرتبطة؛ تبقى مؤرشفة للحفاظ على السجلات' using errcode = '23503';
  end if;
  if exists (select 1 from public.company_invitations where company_id = p_company and status = 'accepted') then
    raise exception 'للشركة دعوات مقبولة؛ تبقى مؤرشفة للحفاظ على السجلات' using errcode = '23503';
  end if;
  perform public.company_audit(p_company, 'company_deleted', 'company', p_company,
    jsonb_build_object('name', v.name, 'ref_no', v.ref_no));
  delete from public.company_invitations where company_id = p_company;
  delete from public.companies where id = p_company;
end $function$;

drop function if exists public.platform_company_dependencies(uuid);
drop function if exists public.platform_update_company_details(uuid, jsonb);

notify pgrst, 'reload schema';
