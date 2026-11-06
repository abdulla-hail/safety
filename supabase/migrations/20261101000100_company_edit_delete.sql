-- =====================================================================
-- عين السلامة — م1: تعديل بيانات الشركة كاملة، معاينة ارتباطاتها، والحذف النهائي الآمن (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) platform_update_company_details(company, data): كل بيانات الشركة الأساسية مع تحقق وتدقيق (قبل/بعد).
--    الدالة القديمة platform_update_company تبقى كما هي.
-- 2) platform_company_dependencies(company): أعداد كل ما يرتبط بالشركة لعرضها قبل أي قرار.
-- 3) platform_delete_company: السبب المُثبت لفشل الحذف أن كل شركة تُزرع لها أنظمة سلامة افتراضية
--    (safety_systems) مرتبطة بقيد restrict، فيفشل حذف حتى الشركة الفارغة. الحذف الجديد:
--    - للشركة المؤرشفة فقط، وبتأكيد رقمها، وبصلاحية platform.companies.delete.
--    - يُرفض إن وُجد أي سجل تشغيلي (عملاء، مواقع، فنيون، أجهزة، أوامر عمل، زيارات، صيانة، مرفقات، كتالوج):
--      تلك الشركات تبقى مؤرشفة للحفاظ على السجلات التاريخية.
--    - بلا سجلات تشغيلية: تُحذف الإعدادات المرتبطة (الأنظمة الافتراضية، الدعوات، العضويات، سجل الهوية، إشعارات الشركة)
--      بعد حفظ لقطة منها في سجل التدقيق (يبقى بعد الحذف) وسجل تدقيق المنصة.
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) تعديل بيانات الشركة
-- ---------------------------------------------------------------------
create or replace function public.platform_update_company_details(p_company uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.companies;
  k text;
  v_fields constant text[] := array['name', 'legal_name', 'commercial_registration', 'vat_number', 'license_no',
    'phone', 'email', 'website', 'city', 'address'];
  v jsonb := '{}'::jsonb;
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.require_platform_perm('platform.companies.update');
  select * into v_old from public.companies where id = p_company for update;
  if v_old.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_data, 'null'::jsonb)) <> 'object' then raise exception 'بيانات غير صالحة' using errcode = '22023'; end if;

  -- تنظيف: نص مقصوص، والفارغ = null؛ الحقول غير المعروفة تُتجاهل
  foreach k in array v_fields loop
    v := v || jsonb_build_object(k, nullif(btrim(coalesce(p_data ->> k, '')), ''));
  end loop;

  if length(coalesce(v ->> 'name', '')) not between 2 and 200 then
    raise exception 'اسم الشركة مطلوب (2–200 حرف)' using errcode = '22023';
  end if;
  foreach k in array v_fields loop
    if length(coalesce(v ->> k, '')) > 300 then raise exception 'قيمة الحقل طويلة جدًا' using errcode = '22023'; end if;
  end loop;
  if (v ->> 'email') is not null and (v ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'بريد الشركة غير صالح' using errcode = '22023';
  end if;
  if (v ->> 'website') is not null and (v ->> 'website') !~* '^https?://[^\s]+\.[^\s]+$' then
    raise exception 'الموقع الإلكتروني يجب أن يبدأ بـ http:// أو https://' using errcode = '22023';
  end if;
  if (v ->> 'phone') is not null and (v ->> 'phone') !~ '^[0-9+()\s-]{5,30}$' then
    raise exception 'رقم الهاتف غير صالح' using errcode = '22023';
  end if;
  if (v ->> 'vat_number') is not null and (v ->> 'vat_number') !~ '^[0-9]{15}$' then
    raise exception 'الرقم الضريبي يتكون من 15 رقمًا' using errcode = '22023';
  end if;

  foreach k in array v_fields loop
    if (to_jsonb(v_old) -> k) is distinct from (v -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(v_old) -> k, 'to', v -> k));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then return; end if;

  update public.companies set
    name = v ->> 'name', legal_name = v ->> 'legal_name', commercial_registration = v ->> 'commercial_registration',
    vat_number = v ->> 'vat_number', license_no = v ->> 'license_no', phone = v ->> 'phone', email = lower(v ->> 'email'),
    website = v ->> 'website', city = v ->> 'city', address = v ->> 'address'
  where id = p_company;
  perform public.company_audit(p_company, 'company_updated', 'company', p_company, jsonb_build_object('changes', v_changes));
end $$;

-- ---------------------------------------------------------------------
-- 2) معاينة الارتباطات (أعداد فقط)
-- ---------------------------------------------------------------------
create or replace function public.platform_company_dependencies(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; v_ops integer;
begin
  perform public.require_platform_perm('platform.companies.view');
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'customers', (select count(*) from public.customers where company_id = p_company),
    'sites', (select count(*) from public.customer_sites where company_id = p_company),
    'technicians', (select count(*) from public.technicians where company_id = p_company),
    'devices', (select count(*) from public.devices where company_id = p_company),
    'work_orders', (select count(*) from public.work_orders where company_id = p_company),
    'visits', (select count(*) from public.visits where company_id = p_company),
    'maintenance_records', (select count(*) from public.maintenance_records where company_id = p_company),
    'attachments', (select count(*) from public.attachments where company_id = p_company),
    'catalog_items', (select count(*) from public.catalog_items where company_id = p_company),
    'memberships', (select count(*) from public.company_memberships where company_id = p_company),
    'active_memberships', (select count(*) from public.company_memberships where company_id = p_company and status = 'active'),
    'invitations', (select count(*) from public.company_invitations where company_id = p_company),
    'safety_systems', (select count(*) from public.safety_systems where company_id = p_company),
    'notifications', (select count(*) from public.notifications where company_id = p_company),
    'branding_history', (select count(*) from public.company_branding_history where company_id = p_company),
    'audit_entries', (select count(*) from public.company_audit_log where company_id = p_company)
  ) into r;
  v_ops := (r ->> 'customers')::int + (r ->> 'sites')::int + (r ->> 'technicians')::int + (r ->> 'devices')::int
    + (r ->> 'work_orders')::int + (r ->> 'visits')::int + (r ->> 'maintenance_records')::int + (r ->> 'attachments')::int
    + (r ->> 'catalog_items')::int;
  return r || jsonb_build_object('operational_records', v_ops, 'can_delete', v_ops = 0);
end $$;

-- ---------------------------------------------------------------------
-- 3) الحذف النهائي الآمن
-- ---------------------------------------------------------------------
create or replace function public.platform_delete_company(p_company uuid, p_confirm_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.companies; d jsonb; v_members jsonb;
begin
  perform public.require_platform_perm('platform.companies.delete');
  select * into v from public.companies where id = p_company for update;
  if v.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if v.status <> 'archived' then raise exception 'يجب أرشفة الشركة قبل حذفها' using errcode = 'P0001'; end if;
  if upper(btrim(coalesce(p_confirm_ref, ''))) <> v.ref_no then raise exception 'رقم التأكيد لا يطابق رقم الشركة' using errcode = '22023'; end if;
  d := public.platform_company_dependencies(p_company);
  if (d ->> 'operational_records')::int > 0 then
    raise exception 'للشركة سجلات تشغيلية (عملاء/أجهزة/زيارات/...)؛ تبقى مؤرشفة للحفاظ على السجلات التاريخية' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('email', email, 'role', role, 'status', status, 'joined', created_at) order by created_at), '[]'::jsonb)
    into v_members from public.company_memberships where company_id = p_company;
  perform public.company_audit(p_company, 'company_deleted', 'company', p_company,
    jsonb_build_object('name', v.name, 'ref_no', v.ref_no, 'counts', d, 'members', v_members));
  perform app_private.platform_audit('company_deleted', jsonb_build_object('company_id', p_company, 'name', v.name, 'ref_no', v.ref_no, 'counts', d));

  delete from public.notifications where company_id = p_company;
  delete from public.company_branding_history where company_id = p_company;
  delete from public.company_invitations where company_id = p_company;
  delete from public.company_memberships where company_id = p_company;
  delete from public.safety_systems where company_id = p_company;
  delete from public.companies where id = p_company;
end $$;

revoke all on function public.platform_update_company_details(uuid, jsonb), public.platform_company_dependencies(uuid) from public, anon;
grant execute on function public.platform_update_company_details(uuid, jsonb), public.platform_company_dependencies(uuid) to authenticated;
revoke all on function public.platform_delete_company(uuid, text) from public, anon;
grant execute on function public.platform_delete_company(uuid, text) to authenticated;

notify pgrst, 'reload schema';
