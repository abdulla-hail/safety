-- تراجع 20261109000300_rls_initplan: يعيد سياسات القراءة الثماني بنصها الحالي في القاعدة الحية (pg_policies، قراءة 2026-10-28)
-- ويحذف الدوال المساعدة. لا بيانات.
drop policy if exists ays_customers_select on public.customers;
create policy ays_customers_select on public.customers for select to authenticated using
  ((company_can_view_customer(company_id, id, 'customers'::text) OR (company_is_member(company_id) AND app_private.assigned_work_customer(id))));
drop policy if exists ays_customer_sites_select on public.customer_sites;
create policy ays_customer_sites_select on public.customer_sites for select to authenticated using
  ((company_can_view_site(company_id, customer_id, id, 'sites'::text) OR (company_is_member(company_id) AND app_private.assigned_work_site(id))));
drop policy if exists ays_devices_select on public.devices;
create policy ays_devices_select on public.devices for select to authenticated using
  ((company_can_view_site(company_id, customer_id, site_id, 'devices'::text) OR (company_is_member(company_id) AND app_private.assigned_work_device(id))));
drop policy if exists ays_dmc_select on public.device_maintenance_cycles;
create policy ays_dmc_select on public.device_maintenance_cycles for select to authenticated using
  (company_can_view_site(company_id, customer_id, site_id, 'devices'::text));
drop policy if exists ays_visits_select on public.visits;
create policy ays_visits_select on public.visits for select to authenticated using
  ((company_can_view_site(company_id, customer_id, site_id, 'visits'::text) OR (company_is_member(company_id) AND app_private.is_assigned_visit(id))));
drop policy if exists ays_wo_select on public.work_orders;
create policy ays_wo_select on public.work_orders for select to authenticated using
  ((company_can_view_site(company_id, customer_id, site_id, 'work_orders'::text) OR (company_is_member(company_id) AND app_private.is_assigned_work_order(id))));
drop policy if exists ays_mr_select on public.maintenance_records;
create policy ays_mr_select on public.maintenance_records for select to authenticated using
  ((company_can_view_site(company_id, customer_id, site_id, 'maintenance'::text) OR (company_is_member(company_id) AND ((visit_id IS NOT NULL) AND app_private.is_assigned_visit(visit_id)))));
drop policy if exists ays_df_select on public.device_faults;
create policy ays_df_select on public.device_faults for select to authenticated using
  ((company_can_view_site(company_id, customer_id, site_id, 'faults'::text) OR (company_is_member(company_id) AND (work_order_id IS NOT NULL) AND app_private.is_assigned_work_order(work_order_id))));

drop function if exists app_private.my_work_customers(), app_private.my_work_sites(), app_private.my_work_devices(),
  app_private.my_visits_any(), app_private.my_work_orders_any(), app_private.my_visits(), app_private.my_work_orders(),
  app_private.my_assigned_customers(), app_private.my_scope_sites(), app_private.my_scope_customers(),
  app_private.my_member_companies(), app_private.my_perm_companies(text);

notify pgrst, 'reload schema';
