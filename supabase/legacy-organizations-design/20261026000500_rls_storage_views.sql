-- =====================================================================
-- عين السلامة — الترحيل 5: سياسات RLS والتخزين وعروض التقارير
-- السياسات مبنية على الصلاحيات التفصيلية (has_perm) وليس على اسم الدور.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) تفعيل RLS وسحب صلاحيات anon من الجداول الجديدة
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'organization_members', 'platform_admins', 'customers', 'technicians',
    'organization_branding_history', 'permission_definitions', 'member_permissions', 'organization_invitations',
    'customer_sites', 'technician_customers', 'safety_systems', 'catalog_items', 'devices',
    'work_orders', 'work_order_technicians', 'work_order_devices', 'visits', 'visit_technicians',
    'maintenance_records', 'maintenance_record_technicians', 'attachments', 'audit_logs',
    'notifications', 'outbound_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array array[
    'organization_branding_history', 'permission_definitions', 'member_permissions', 'organization_invitations',
    'customer_sites', 'technician_customers', 'safety_systems', 'catalog_items', 'devices',
    'work_orders', 'work_order_technicians', 'work_order_devices', 'visits', 'visit_technicians',
    'maintenance_records', 'maintenance_record_technicians', 'attachments', 'audit_logs',
    'notifications', 'outbound_messages']
  loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- الجداول التي تُدار عبر الدوال فقط (لا كتابة مباشرة من الواجهة)
revoke insert, update, delete on table public.audit_logs from authenticated;
revoke insert, update, delete on table public.member_permissions from authenticated;
revoke insert, update, delete on table public.organization_invitations from authenticated;
revoke insert, update, delete on table public.organization_branding_history from authenticated;
revoke insert, update, delete on table public.permission_definitions from authenticated;
revoke insert, update, delete on table public.outbound_messages from authenticated;
revoke insert, delete on table public.notifications from authenticated;
revoke update, delete on table public.maintenance_records from authenticated;
revoke update, delete on table public.maintenance_record_technicians from authenticated;

-- ---------------------------------------------------------------------
-- مساعد لإنشاء السياسات بشكل متسق
-- ---------------------------------------------------------------------
create or replace function app_private.reset_policy(p_table text, p_name text, p_cmd text, p_using text, p_check text)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  if p_cmd = 'INSERT' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', p_name, p_table, p_check);
  elsif p_cmd = 'UPDATE' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   p_name, p_table, p_using, coalesce(p_check, p_using));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)', p_name, p_table, p_cmd, p_using);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الشركات والعضويات
-- ---------------------------------------------------------------------
select app_private.reset_policy('organizations', 'ays_org_select', 'SELECT',
  'app_private.is_platform_admin() or exists (select 1 from public.organization_members m where m.organization_id = organizations.id and m.user_id = auth.uid())', null);

select app_private.reset_policy('organization_members', 'ays_members_select', 'SELECT',
  'user_id = auth.uid() or public.has_perm(organization_id, ''users.view'') or app_private.is_platform_admin()', null);

select app_private.reset_policy('member_permissions', 'ays_member_perms_select', 'SELECT',
  'public.has_perm(organization_id, ''users.view'') or exists (select 1 from public.organization_members m where m.id = member_permissions.member_id and m.user_id = auth.uid())', null);

select app_private.reset_policy('permission_definitions', 'ays_perm_defs_select', 'SELECT', 'true', null);

select app_private.reset_policy('organization_invitations', 'ays_invitations_select', 'SELECT',
  'public.has_perm(organization_id, ''users.view'')', null);

select app_private.reset_policy('organization_branding_history', 'ays_branding_history_select', 'SELECT',
  'public.has_perm(organization_id, ''settings.branding'')', null);

-- ---------------------------------------------------------------------
-- 2) الوحدات التشغيلية
-- ---------------------------------------------------------------------
-- العملاء
select app_private.reset_policy('customers', 'ays_customers_select', 'SELECT',
  'public.can_view_customer_data(organization_id, id, ''customers'')', null);
select app_private.reset_policy('customers', 'ays_customers_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''customers.create'')');
select app_private.reset_policy('customers', 'ays_customers_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''customers.update'', ''customers.archive''])', null);
select app_private.reset_policy('customers', 'ays_customers_delete', 'DELETE',
  'public.has_perm(organization_id, ''customers.delete'')', null);

-- الفنيون
select app_private.reset_policy('technicians', 'ays_technicians_select', 'SELECT',
  'public.has_any_perm(organization_id, array[''technicians.view'', ''assignments.manage'', ''work_orders.assign'', ''visits.create'', ''visits.update'', ''maintenance.create'']) or (user_id = auth.uid() and public.is_org_member(organization_id))', null);
select app_private.reset_policy('technicians', 'ays_technicians_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''technicians.create'')');
select app_private.reset_policy('technicians', 'ays_technicians_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''technicians.update'', ''technicians.archive''])', null);
select app_private.reset_policy('technicians', 'ays_technicians_delete', 'DELETE',
  'public.has_perm(organization_id, ''technicians.delete'')', null);

-- المواقع
select app_private.reset_policy('customer_sites', 'ays_sites_select', 'SELECT',
  'public.can_view_customer_data(organization_id, customer_id, ''sites'')', null);
select app_private.reset_policy('customer_sites', 'ays_sites_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''sites.create'')');
select app_private.reset_policy('customer_sites', 'ays_sites_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''sites.update'', ''sites.archive''])', null);
select app_private.reset_policy('customer_sites', 'ays_sites_delete', 'DELETE',
  'public.has_perm(organization_id, ''sites.delete'')', null);

-- الإسناد
select app_private.reset_policy('technician_customers', 'ays_tc_select', 'SELECT',
  'public.has_any_perm(organization_id, array[''assignments.manage'', ''customers.view'', ''technicians.view'']) or app_private.is_assigned_customer(organization_id, customer_id)', null);
select app_private.reset_policy('technician_customers', 'ays_tc_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''assignments.manage'')');
select app_private.reset_policy('technician_customers', 'ays_tc_update', 'UPDATE',
  'public.has_perm(organization_id, ''assignments.manage'')', null);
select app_private.reset_policy('technician_customers', 'ays_tc_delete', 'DELETE',
  'public.has_perm(organization_id, ''assignments.manage'')', null);

-- كتالوج أجهزة السلامة
select app_private.reset_policy('safety_systems', 'ays_systems_select', 'SELECT',
  'public.has_any_perm(organization_id, array[''catalog.view'', ''catalog.manage'', ''devices.create'', ''devices.update''])', null);
select app_private.reset_policy('safety_systems', 'ays_systems_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''catalog.manage'')');
select app_private.reset_policy('safety_systems', 'ays_systems_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''catalog.manage'', ''catalog.archive''])', null);
select app_private.reset_policy('safety_systems', 'ays_systems_delete', 'DELETE',
  'public.has_perm(organization_id, ''catalog.delete'')', null);

select app_private.reset_policy('catalog_items', 'ays_catalog_select', 'SELECT',
  'public.has_any_perm(organization_id, array[''catalog.view'', ''catalog.manage'', ''devices.create'', ''devices.update''])', null);
select app_private.reset_policy('catalog_items', 'ays_catalog_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''catalog.manage'')');
select app_private.reset_policy('catalog_items', 'ays_catalog_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''catalog.manage'', ''catalog.archive''])', null);
select app_private.reset_policy('catalog_items', 'ays_catalog_delete', 'DELETE',
  'public.has_perm(organization_id, ''catalog.delete'')', null);

-- الأجهزة
select app_private.reset_policy('devices', 'ays_devices_select', 'SELECT',
  'public.can_view_customer_data(organization_id, customer_id, ''devices'')', null);
select app_private.reset_policy('devices', 'ays_devices_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''devices.create'')');
select app_private.reset_policy('devices', 'ays_devices_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''devices.update'', ''devices.archive''])', null);
select app_private.reset_policy('devices', 'ays_devices_delete', 'DELETE',
  'public.has_perm(organization_id, ''devices.delete'')', null);

-- أوامر العمل (الفني يرى ما عُيّن له)
create or replace function app_private.is_assigned_work_order(p_wo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_order_technicians wt join public.technicians t on t.id = wt.technician_id
                 where wt.work_order_id = p_wo and t.user_id = auth.uid())
$$;
create or replace function app_private.is_assigned_visit(p_visit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id
                 where vt.visit_id = p_visit and t.user_id = auth.uid())
$$;

select app_private.reset_policy('work_orders', 'ays_wo_select', 'SELECT',
  'public.can_view_customer_data(organization_id, customer_id, ''work_orders'') or (public.is_org_member(organization_id) and app_private.is_assigned_work_order(id))', null);
select app_private.reset_policy('work_orders', 'ays_wo_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''work_orders.create'')');
select app_private.reset_policy('work_orders', 'ays_wo_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''work_orders.update'', ''work_orders.archive'', ''work_orders.approve''])', null);
select app_private.reset_policy('work_orders', 'ays_wo_delete', 'DELETE',
  'public.has_perm(organization_id, ''work_orders.delete'')', null);

select app_private.reset_policy('work_order_technicians', 'ays_wot_select', 'SELECT',
  'exists (select 1 from public.work_orders w where w.id = work_order_technicians.work_order_id)', null);
select app_private.reset_policy('work_order_technicians', 'ays_wot_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''work_orders.assign'')');
select app_private.reset_policy('work_order_technicians', 'ays_wot_delete', 'DELETE',
  'public.has_perm(organization_id, ''work_orders.assign'')', null);

select app_private.reset_policy('work_order_devices', 'ays_wod_select', 'SELECT',
  'exists (select 1 from public.work_orders w where w.id = work_order_devices.work_order_id)', null);
select app_private.reset_policy('work_order_devices', 'ays_wod_insert', 'INSERT', null,
  'public.has_any_perm(organization_id, array[''work_orders.create'', ''work_orders.update''])');
select app_private.reset_policy('work_order_devices', 'ays_wod_delete', 'DELETE',
  'public.has_perm(organization_id, ''work_orders.update'')', null);

-- الزيارات
select app_private.reset_policy('visits', 'ays_visits_select', 'SELECT',
  'public.can_view_customer_data(organization_id, customer_id, ''visits'') or (public.is_org_member(organization_id) and app_private.is_assigned_visit(id))', null);
select app_private.reset_policy('visits', 'ays_visits_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''visits.create'')');
select app_private.reset_policy('visits', 'ays_visits_update', 'UPDATE',
  'public.has_any_perm(organization_id, array[''visits.update'', ''visits.archive''])', null);
select app_private.reset_policy('visits', 'ays_visits_delete', 'DELETE',
  'public.has_perm(organization_id, ''visits.delete'')', null);

select app_private.reset_policy('visit_technicians', 'ays_vt_select', 'SELECT',
  'exists (select 1 from public.visits v where v.id = visit_technicians.visit_id)', null);
select app_private.reset_policy('visit_technicians', 'ays_vt_insert', 'INSERT', null,
  'public.has_any_perm(organization_id, array[''visits.create'', ''visits.update''])');
select app_private.reset_policy('visit_technicians', 'ays_vt_delete', 'DELETE',
  'public.has_perm(organization_id, ''visits.update'')', null);

-- سجلات الصيانة
select app_private.reset_policy('maintenance_records', 'ays_mr_select', 'SELECT',
  'public.can_view_customer_data(organization_id, customer_id, ''maintenance'')', null);
select app_private.reset_policy('maintenance_records', 'ays_mr_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''maintenance.create'') and exists (select 1 from public.devices d where d.id = maintenance_records.device_id)');
select app_private.reset_policy('maintenance_record_technicians', 'ays_mrt_select', 'SELECT',
  'exists (select 1 from public.maintenance_records r where r.id = maintenance_record_technicians.record_id)', null);
select app_private.reset_policy('maintenance_record_technicians', 'ays_mrt_insert', 'INSERT', null,
  'public.has_perm(organization_id, ''maintenance.create'')');

-- المرفقات: العرض يتبع صلاحية عرض الوحدة؛ الإضافة تتبع صلاحية التعديل/الإنشاء
select app_private.reset_policy('attachments', 'ays_attachments_select', 'SELECT',
  'public.has_any_perm(organization_id, array[app_private.attachment_module(entity_type) || ''.view'', ''field.assigned''])', null);
select app_private.reset_policy('attachments', 'ays_attachments_insert', 'INSERT', null,
  'public.has_any_perm(organization_id, array[app_private.attachment_module(entity_type) || ''.update'', app_private.attachment_module(entity_type) || ''.create'', ''catalog.manage''])');
select app_private.reset_policy('attachments', 'ays_attachments_update', 'UPDATE',
  'public.has_perm(organization_id, app_private.attachment_module(entity_type) || ''.archive'')', null);
select app_private.reset_policy('attachments', 'ays_attachments_delete', 'DELETE',
  'public.has_perm(organization_id, app_private.attachment_module(entity_type) || ''.delete'')', null);

-- سجل التدقيق
select app_private.reset_policy('audit_logs', 'ays_audit_select', 'SELECT',
  'public.has_perm(organization_id, ''audit.view'')', null);

-- الإشعارات: المستلم فقط
select app_private.reset_policy('notifications', 'ays_notifications_select', 'SELECT',
  'recipient_user_id = auth.uid()', null);
select app_private.reset_policy('notifications', 'ays_notifications_update', 'UPDATE',
  'recipient_user_id = auth.uid()', null);

-- الرسائل الخارجية: عرض فقط لمن يدير المستخدمين
select app_private.reset_policy('outbound_messages', 'ays_outbound_select', 'SELECT',
  'public.has_perm(organization_id, ''users.manage'')', null);

-- ---------------------------------------------------------------------
-- 3) التخزين: حاويات خاصة، والمسار يبدأ دائمًا بمعرّف الشركة
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-branding', 'org-branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-files', 'org-files', false, 10485760)
on conflict (id) do nothing;

create or replace function app_private.storage_org(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function app_private.storage_org(text) to authenticated;
grant execute on function app_private.attachment_module(text) to authenticated;
grant execute on function app_private.is_platform_admin() to authenticated;
grant execute on function app_private.is_assigned_customer(uuid, uuid) to authenticated;
grant execute on function app_private.is_assigned_work_order(uuid) to authenticated;
grant execute on function app_private.is_assigned_visit(uuid) to authenticated;

drop policy if exists ays_branding_read on storage.objects;
create policy ays_branding_read on storage.objects for select to authenticated
  using (bucket_id = 'org-branding' and public.is_org_member(app_private.storage_org(name)));
drop policy if exists ays_branding_write on storage.objects;
create policy ays_branding_write on storage.objects for insert to authenticated
  with check (bucket_id = 'org-branding' and public.has_perm(app_private.storage_org(name), 'settings.branding'));
drop policy if exists ays_branding_update on storage.objects;
create policy ays_branding_update on storage.objects for update to authenticated
  using (bucket_id = 'org-branding' and public.has_perm(app_private.storage_org(name), 'settings.branding'));
drop policy if exists ays_branding_delete on storage.objects;
create policy ays_branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-branding' and public.has_perm(app_private.storage_org(name), 'settings.branding'));

-- قراءة ملفات org-files مسموحة فقط إن كان سجل المرفق مرئيًا للمستخدم (RLS على attachments)
drop policy if exists ays_files_read on storage.objects;
create policy ays_files_read on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and exists (select 1 from public.attachments a where a.storage_path = name));
drop policy if exists ays_files_write on storage.objects;
create policy ays_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'org-files' and public.has_any_perm(app_private.storage_org(name),
    array['devices.update', 'devices.create', 'customers.update', 'sites.update', 'work_orders.update',
          'visits.update', 'maintenance.create', 'catalog.manage', 'technicians.update']));

-- ---------------------------------------------------------------------
-- 4) عروض التقارير (security_invoker: تخضع لسياسات RLS للمستخدم)
-- ---------------------------------------------------------------------
create or replace view public.report_devices_by_system with (security_invoker = on) as
select d.organization_id,
       d.system_id,
       coalesce(s.name, 'غير مصنف') as system_name,
       d.status,
       count(*)::int as device_count,
       count(*) filter (where d.next_maintenance_at < (now() at time zone 'Asia/Riyadh')::date)::int as overdue_count
from public.devices d
left join public.safety_systems s on s.id = d.system_id
where d.archived_at is null
group by d.organization_id, d.system_id, s.name, d.status;

create or replace view public.report_technician_assignments with (security_invoker = on) as
select t.organization_id, t.id as technician_id, t.ref_no, t.full_name, t.is_active,
       count(tc.customer_id)::int as customer_count
from public.technicians t
left join public.technician_customers tc on tc.technician_id = t.id
where t.archived_at is null
group by t.organization_id, t.id, t.ref_no, t.full_name, t.is_active;

create or replace view public.report_customer_summary with (security_invoker = on) as
select c.organization_id, c.id as customer_id, c.ref_no, c.name, c.city, c.is_active, c.archived_at,
       (select count(*) from public.customer_sites s where s.customer_id = c.id and s.archived_at is null)::int as site_count,
       (select count(*) from public.devices d where d.customer_id = c.id and d.archived_at is null)::int as device_count,
       (select count(*) from public.devices d where d.customer_id = c.id and d.archived_at is null
          and d.next_maintenance_at < (now() at time zone 'Asia/Riyadh')::date)::int as overdue_count,
       (select count(*) from public.technician_customers tc where tc.customer_id = c.id)::int as technician_count
from public.customers c;

revoke all on public.report_devices_by_system, public.report_technician_assignments, public.report_customer_summary from anon;
grant select on public.report_devices_by_system, public.report_technician_assignments, public.report_customer_summary to authenticated;
