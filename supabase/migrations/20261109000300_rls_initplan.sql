-- =====================================================================
-- عين السلامة — تسريع سياسات القراءة (RLS) دون تغيير ما يراه أي مستخدم (مشروع cgwnusudjhhxkwnqjzfr) — مقترح
--
-- السبب المقاس (scripts/perf/pglite-scale.mjs، 4000 جهاز): سياسات القراءة تستدعي دوال SECURITY DEFINER لكل صف
-- (company_can_view_site ← company_has_perm ← company_effective_permissions ...)، ودوال SECURITY DEFINER لا تُدمج في الاستعلام،
-- فيصير عدّ أجهزة الصفحة الواحدة مئات المللي ثواني ويزيد خطيًا مع البيانات (أسوأ للفني لأن كل الصفوف غير المرئية تمر بكل الفروع).
--
-- الحل: كل فرع من السياسة الحالية يُحسب مرة واحدة للاستعلام كمصفوفة معرّفات (select ...) = initplan، ثم مقارنة رخيصة لكل صف:
--   company_has_perm(company_id, P)                         ⇔ company_id = any(my_perm_companies(P))
--   company_has_perm(company_id,'field.assigned') and is_assigned_site(company_id, customer_id, site)
--                                                           ⇔ customer_id = any(my_scope_customers())            (إسناد العميل كاملًا)
--                                                              or customer_id/site = any(my_scope_sites())          (إسناد مواقع محددة)
--   company_has_perm(company_id,'field.assigned') and is_assigned_customer(company_id, id) ⇔ id = any(my_assigned_customers())
--   company_is_member(company_id) and assigned_work_device/site/customer(id)              ⇔ id = any(my_work_devices/sites/customers())
--   company_is_member(company_id) and is_assigned_visit(id) / is_assigned_work_order(id)   ⇔ id = any(my_visits()/my_work_orders())
-- الدوال القديمة تبقى كما هي (تستخدمها دوال أخرى). المطابقة مختبرة على PGlite: نفس الصفوف المرئية لكل مستخدم وجدول
-- قبل الترحيل وبعده (tests/cgwn/rls-initplan.test.mjs).
-- لا تغيير في البيانات ولا الكتابة (INSERT/UPDATE/DELETE) ولا safety_*.
-- =====================================================================

create or replace function app_private.my_perm_companies(p_perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.company_id), '{}') from public.company_memberships m join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
    and p_perm = any (public.company_effective_permissions(m.role, m.permissions))
$$;

create or replace function app_private.my_member_companies() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.company_id), '{}') from public.company_memberships m join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
$$;

-- إسنادات الفني الحالي في الشركات التي يملك فيها field.assigned (كما في company_can_view_site/is_assigned_site)
create or replace function app_private.my_scope_customers() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct tc.customer_id), '{}')
  from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
  where t.user_id = auth.uid() and t.archived_at is null
    and tc.company_id = any (app_private.my_perm_companies('field.assigned'))
    and not exists (select 1 from public.technician_customer_sites s where s.assignment_id = tc.id)
$$;

create or replace function app_private.my_scope_sites() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct tc.customer_id::text || '/' || s.site_id::text), '{}')
  from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
  join public.technician_customer_sites s on s.assignment_id = tc.id
  where t.user_id = auth.uid() and t.archived_at is null
    and tc.company_id = any (app_private.my_perm_companies('field.assigned'))
$$;

-- is_assigned_customer: أي إسناد للعميل (بمواقع محددة أو كاملًا)
create or replace function app_private.my_assigned_customers() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct tc.customer_id), '{}')
  from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
  where t.user_id = auth.uid() and t.archived_at is null
    and tc.company_id = any (app_private.my_perm_companies('field.assigned'))
$$;

-- العمل المعيَّن (is_assigned_work_order / is_assigned_visit) في شركات العضوية الفعالة
create or replace function app_private.my_work_orders() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct wt.work_order_id), '{}')
  from public.work_order_technicians wt join public.technicians t on t.id = wt.technician_id
  where t.user_id = auth.uid() and wt.company_id = any (app_private.my_member_companies())
$$;

create or replace function app_private.my_visits() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct vt.visit_id), '{}')
  from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id
  where t.user_id = auth.uid() and vt.company_id = any (app_private.my_member_companies())
$$;

-- كل الأوامر/الزيارات المعيَّنة لي بلا شرط عضوية (is_assigned_* نفسها لا تشترطها؛ الشرط يُطبق على صف الجدول المقروء)
create or replace function app_private.my_work_orders_any() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct wt.work_order_id), '{}')
  from public.work_order_technicians wt join public.technicians t on t.id = wt.technician_id where t.user_id = auth.uid()
$$;
create or replace function app_private.my_visits_any() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct vt.visit_id), '{}')
  from public.visit_technicians vt join public.technicians t on t.id = vt.technician_id where t.user_id = auth.uid()
$$;

-- assigned_work_device/site/customer: أوامر عمل غير مؤرشفة معيَّنة لي، أو زيارات معيَّنة لي
create or replace function app_private.my_work_devices() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.device_id), '{}') from (
    select d.device_id from public.work_order_devices d join public.work_orders w on w.id = d.work_order_id
    where w.archived_at is null and d.work_order_id = any (app_private.my_work_orders_any())
      and d.company_id = any (app_private.my_member_companies())
    union
    select d.device_id from public.visit_devices d
    where d.visit_id = any (app_private.my_visits_any()) and d.company_id = any (app_private.my_member_companies())
  ) x
$$;

create or replace function app_private.my_work_sites() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.site_id), '{}') from (
    select w.site_id, w.company_id from public.work_orders w where w.archived_at is null and w.id = any (app_private.my_work_orders_any())
    union
    select v.site_id, v.company_id from public.visits v where v.archived_at is null and v.id = any (app_private.my_visits_any())
  ) x where x.site_id is not null and x.company_id = any (app_private.my_member_companies())
$$;

create or replace function app_private.my_work_customers() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.customer_id), '{}') from (
    select w.customer_id, w.company_id from public.work_orders w where w.archived_at is null and w.id = any (app_private.my_work_orders_any())
    union
    select v.customer_id, v.company_id from public.visits v where v.archived_at is null and v.id = any (app_private.my_visits_any())
  ) x where x.company_id = any (app_private.my_member_companies())
$$;

revoke all on function app_private.my_perm_companies(text), app_private.my_member_companies(), app_private.my_scope_customers(),
  app_private.my_scope_sites(), app_private.my_assigned_customers(), app_private.my_work_orders(), app_private.my_visits(),
  app_private.my_work_devices(), app_private.my_work_sites(), app_private.my_work_customers(), app_private.my_work_orders_any(),
  app_private.my_visits_any() from public, anon;
grant execute on function app_private.my_perm_companies(text), app_private.my_member_companies(), app_private.my_scope_customers(),
  app_private.my_scope_sites(), app_private.my_assigned_customers(), app_private.my_work_orders(), app_private.my_visits(),
  app_private.my_work_devices(), app_private.my_work_sites(), app_private.my_work_customers(), app_private.my_work_orders_any(),
  app_private.my_visits_any() to authenticated;

-- ---------------------------------------------------------------------
-- السياسات (القراءة فقط). الفرع السريع للمدير أولًا؛ ترتيب OR يُنفَّذ كما هو فيتوقف عند أول فرع صحيح.
-- ---------------------------------------------------------------------
drop policy if exists ays_customers_select on public.customers;
create policy ays_customers_select on public.customers for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('customers.view'))::uuid[])
  or id = any ((select app_private.my_assigned_customers())::uuid[])
  or id = any ((select app_private.my_work_customers())::uuid[]));

drop policy if exists ays_customer_sites_select on public.customer_sites;
create policy ays_customer_sites_select on public.customer_sites for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('sites.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || id::text) = any ((select app_private.my_scope_sites())::text[])
  or id = any ((select app_private.my_work_sites())::uuid[]));

drop policy if exists ays_devices_select on public.devices;
create policy ays_devices_select on public.devices for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('devices.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[])
  or id = any ((select app_private.my_work_devices())::uuid[]));

drop policy if exists ays_dmc_select on public.device_maintenance_cycles;
create policy ays_dmc_select on public.device_maintenance_cycles for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('devices.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[]));

drop policy if exists ays_visits_select on public.visits;
create policy ays_visits_select on public.visits for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('visits.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[])
  or id = any ((select app_private.my_visits())::uuid[]));

drop policy if exists ays_wo_select on public.work_orders;
create policy ays_wo_select on public.work_orders for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('work_orders.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[])
  or id = any ((select app_private.my_work_orders())::uuid[]));

drop policy if exists ays_mr_select on public.maintenance_records;
create policy ays_mr_select on public.maintenance_records for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('maintenance.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[])
  or visit_id = any ((select app_private.my_visits())::uuid[]));

drop policy if exists ays_df_select on public.device_faults;
create policy ays_df_select on public.device_faults for select to authenticated using (
  company_id = any ((select app_private.my_perm_companies('faults.view'))::uuid[])
  or customer_id = any ((select app_private.my_scope_customers())::uuid[])
  or (customer_id::text || '/' || site_id::text) = any ((select app_private.my_scope_sites())::text[])
  or work_order_id = any ((select app_private.my_work_orders())::uuid[]));

notify pgrst, 'reload schema';
