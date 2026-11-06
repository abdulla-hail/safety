-- =====================================================================
-- التراجع عن 20261028000100_operations_permissions_branding.sql
-- حماية من فقد البيانات: يرفض التنفيذ كليًا إذا أُدخلت أي بيانات بعد الترحيل
-- (سجلات تشغيلية، إشعارات، مرفقات، هوية مخصصة، صلاحيات مخصصة، ملفات تخزين).
-- المسموح فقط: الكتالوج الافتراضي الذي أنشأه الترحيل نفسه دون تعديل.
-- بعد بدء الاستخدام الفعلي لا يُستخدم هذا الملف؛ يُعالج أي خلل بترحيل تصحيحي إضافي.
-- لا يمس companies/company_memberships/company_invitations/company_audit_log/safety_* إلا بإزالة ما أضافه هذا الترحيل.
-- =====================================================================
do $$
declare v_found text[] := '{}'; t text; v_has boolean;
begin
  foreach t in array array['customers', 'technicians', 'customer_sites', 'technician_customers', 'catalog_items', 'devices',
    'work_orders', 'work_order_technicians', 'work_order_devices', 'visits', 'visit_technicians', 'maintenance_records',
    'maintenance_record_technicians', 'attachments', 'notifications', 'company_branding_history'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into v_has;
      if v_has then v_found := array_append(v_found, (t)::text); end if;
    end if;
  end loop;
  -- أنظمة الكتالوج: يُسمح فقط بالسبعة الافتراضية لكل شركة دون تعديل
  if to_regclass('public.safety_systems') is not null and exists (
       select 1 from public.safety_systems s
       where s.created_by is not null or s.archived_at is not null or not s.is_active
          or not exists (select 1 from (values
               ('أنظمة الإنذار', 'لوحات الإنذار والكواشف ونقاط الكسر والصافرات', 180, 1),
               ('طفايات الحريق', 'الطفايات اليدوية والمتنقلة بأنواعها', 365, 2),
               ('أنظمة الرش الآلي', 'الرشاشات والصمامات وشبكات المياه', 180, 3),
               ('مضخات الحريق', 'المضخات الرئيسية والاحتياطية ومضخات الجوكي', 90, 4),
               ('إنارة الطوارئ', 'وحدات إنارة الطوارئ ولوحات المخارج', 180, 5),
               ('أنظمة الإطفاء بالغاز', 'FM-200 وCO2 والغازات النظيفة', 180, 6),
               ('الخراطيم وبكرات الحريق', 'بكرات الخراطيم وصناديق الحريق', 365, 7)) v(name, description, days, sort)
             where v.name = s.name and v.description is not distinct from s.description
               and v.days = s.default_interval_days and v.sort = s.sort_order)) then
    v_found := array_append(v_found, ('safety_systems')::text);
  end if;
  if exists (select 1 from public.company_memberships where permissions is not null) then v_found := array_append(v_found, ('company_memberships.permissions')::text); end if;
  if exists (select 1 from public.companies where logo_path is not null or stamp_path is not null or legal_name is not null or email is not null
       or website is not null or address is not null or vat_number is not null or license_no is not null or header_text is not null
       or footer_text is not null or signature_name is not null or signature_title is not null
       or primary_color <> '#1e3a5f' or secondary_color <> '#d98e04' or maintenance_alert_days <> 14) then
    v_found := array_append(v_found, ('companies.branding')::text);
  end if;
  if exists (select 1 from storage.objects where bucket_id in ('org-branding', 'org-files')) then v_found := array_append(v_found, ('storage.objects')::text); end if;
  if cardinality(v_found) > 0 then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل في %', array_to_string(v_found, '، ');
  end if;
end $$;

drop view if exists public.report_devices_by_system;
drop view if exists public.report_customer_summary;

drop policy if exists ays_branding_read on storage.objects;
drop policy if exists ays_branding_write on storage.objects;
drop policy if exists ays_branding_delete on storage.objects;
drop policy if exists ays_files_read on storage.objects;
drop policy if exists ays_files_write on storage.objects;
-- الحاويتان org-branding/org-files تبقيان (فارغتين): Supabase يمنع حذف الحاويات بـ SQL؛ تُحذفان من Storage API أو اللوحة عند الحاجة.

drop trigger if exists trg_companies_seed_catalog on public.companies;

drop table if exists public.notifications, public.attachments, public.maintenance_record_technicians, public.maintenance_records,
  public.visit_technicians, public.visits, public.work_order_devices, public.work_order_technicians, public.work_orders,
  public.devices, public.catalog_items, public.safety_systems, public.technician_customers, public.customer_sites,
  public.technicians, public.customers, public.company_branding_history, public.company_role_permissions,
  public.permission_definitions;

drop function if exists public.get_my_context();
drop function if exists public.resolve_device_token(text);
drop function if exists public.run_maintenance_alerts(uuid);
drop function if exists public.company_restore_branding(uuid);
drop function if exists public.company_update_branding(uuid, jsonb);
drop function if exists public.company_branding_snapshot(uuid);
drop function if exists public.company_set_member_permissions(uuid, text[]);
drop function if exists public.company_can_view_customer(uuid, uuid, text);
drop function if exists public.company_has_any_perm(uuid, text[]);
drop function if exists public.company_has_perm(uuid, text);
drop function if exists public.company_is_member(uuid);
drop function if exists public.company_member_row(uuid);
drop function if exists public.company_effective_permissions(text, text[]);

alter table public.company_memberships drop column if exists permissions;

alter table public.companies drop constraint if exists companies_colors_chk;
alter table public.companies drop constraint if exists companies_alert_days_chk;
alter table public.companies
  drop column if exists legal_name, drop column if exists email, drop column if exists website, drop column if exists address,
  drop column if exists vat_number, drop column if exists license_no, drop column if exists logo_path, drop column if exists stamp_path,
  drop column if exists primary_color, drop column if exists secondary_color, drop column if exists header_text,
  drop column if exists footer_text, drop column if exists signature_name, drop column if exists signature_title,
  drop column if exists show_logo_in_reports, drop column if exists show_contact_in_reports, drop column if exists show_stamp_in_reports,
  drop column if exists maintenance_alert_days, drop column if exists last_alert_run_at;

-- المخطط app_private أُنشئ بهذا الترحيل بالكامل
drop schema if exists app_private cascade;

notify pgrst, 'reload schema';
