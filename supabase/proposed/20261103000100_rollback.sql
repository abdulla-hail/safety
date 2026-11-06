-- =====================================================================
-- التراجع عن 20261103000100_assignment_scope_history.sql (مولَّد من تعريفات وسياسات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجد نطاق مواقع أو فني أساسي أو أحداث إسناد بعد الترحيل.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.technician_customer_sites)
     or exists (select 1 from public.technician_customers where is_primary)
     or exists (select 1 from public.technician_assignment_events where reason is distinct from 'قائم قبل تفعيل سجل الإسناد') then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد إسنادات أو أحداث أُنشئت بعد الترحيل';
  end if;
end $$;

drop policy if exists ays_customer_sites_select on public.customer_sites;
create policy ays_customer_sites_select on public.customer_sites as permissive for select to "authenticated" using (company_can_view_customer(company_id, customer_id, 'sites'::text));
drop policy if exists ays_devices_select on public.devices;
create policy ays_devices_select on public.devices as permissive for select to "authenticated" using (company_can_view_customer(company_id, customer_id, 'devices'::text));
drop policy if exists ays_mr_select on public.maintenance_records;
create policy ays_mr_select on public.maintenance_records as permissive for select to "authenticated" using (company_can_view_customer(company_id, customer_id, 'maintenance'::text));
drop policy if exists ays_visits_select on public.visits;
create policy ays_visits_select on public.visits as permissive for select to "authenticated" using ((company_can_view_customer(company_id, customer_id, 'visits'::text) OR (company_is_member(company_id) AND app_private.is_assigned_visit(id))));
drop policy if exists ays_wo_select on public.work_orders;
create policy ays_wo_select on public.work_orders as permissive for select to "authenticated" using ((company_can_view_customer(company_id, customer_id, 'work_orders'::text) OR (company_is_member(company_id) AND app_private.is_assigned_work_order(id))));
drop policy if exists ays_dt_select on public.device_transfers;
create policy ays_dt_select on public.device_transfers as permissive for select to "authenticated" using ((( SELECT company_has_perm(device_transfers.company_id, 'devices.view'::text) AS company_has_perm) OR ((from_customer_id = to_customer_id) AND ( SELECT company_has_perm(device_transfers.company_id, 'field.assigned'::text) AS company_has_perm) AND app_private.is_assigned_customer(company_id, to_customer_id))));
drop policy if exists ays_attachments_select on public.attachments;
create policy ays_attachments_select on public.attachments as permissive for select to "authenticated" using (company_has_any_perm(company_id, ARRAY[(app_private.attachment_module(entity_type) || '.view'::text), 'field.assigned'::text]));

CREATE OR REPLACE FUNCTION public.resolve_device_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d record; v_token text := upper(btrim(p_token));
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthenticated'); end if;
  if v_token !~ '^[A-Z0-9]{8,32}$' then return jsonb_build_object('status', 'invalid'); end if;
  select id, company_id, customer_id, archived_at into d from public.devices where qr_token = v_token;
  if d.id is null then
    if exists (select 1 from app_private.device_tokens where token = v_token) then return jsonb_build_object('status', 'removed'); end if;
    return jsonb_build_object('status', 'not_found');
  end if;
  if not public.company_can_view_customer(d.company_id, d.customer_id, 'devices') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'device_id', d.id, 'organization_id', d.company_id, 'archived', d.archived_at is not null);
end $function$;

CREATE OR REPLACE FUNCTION app_private.run_maintenance_alerts_for(p_company uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d record; r record; v_days integer; v_today date := (now() at time zone 'Asia/Riyadh')::date; n integer := 0;
begin
  select maintenance_alert_days into v_days from public.companies where id = p_company and status = 'active';
  if v_days is null then return 0; end if;
  for d in select id, ref_no, name, customer_id, next_maintenance_at from public.devices
           where company_id = p_company and archived_at is null and status <> 'decommissioned'
             and next_maintenance_at is not null and next_maintenance_at <= v_today + v_days loop
    for r in select m.user_id from public.company_memberships m
             where m.company_id = p_company and m.status = 'active'
               and 'devices.view' = any (public.company_effective_permissions(m.role, m.permissions))
             union
             select t.user_id from public.technician_customers tc join public.technicians t on t.id = tc.technician_id
             where tc.customer_id = d.customer_id and t.user_id is not null and t.archived_at is null loop
      if d.next_maintenance_at < v_today then
        perform app_private.notify(p_company, r.user_id, 'maintenance_overdue', 'صيانة متأخرة: ' || d.name || ' (' || d.ref_no || ')',
          'كان موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'), '/devices/' || d.id, 'device', d.id,
          'overdue:' || d.id || ':' || d.next_maintenance_at);
      else
        perform app_private.notify(p_company, r.user_id, 'maintenance_due', 'صيانة قادمة: ' || d.name || ' (' || d.ref_no || ')',
          'موعد الصيانة ' || to_char(d.next_maintenance_at, 'YYYY-MM-DD'), '/devices/' || d.id, 'device', d.id,
          'due:' || d.id || ':' || d.next_maintenance_at);
      end if;
      n := n + 1;
    end loop;
  end loop;
  update public.companies set last_alert_run_at = now() where id = p_company;
  return n;
end $function$;

drop function if exists app_private.device_responsible_users(uuid);
drop function if exists app_private.attachment_entity_visible(text, uuid);
drop function if exists public.assignment_set_primary(uuid, uuid, text);
drop function if exists public.assignment_remove(uuid, uuid, text);
drop function if exists public.assignment_set(uuid, uuid, uuid[], text);
drop trigger if exists trg_technician_customers_events on public.technician_customers;
drop function if exists app_private.log_assignment();
drop table if exists public.technician_assignment_events;
drop index if exists public.technician_customers_one_primary;
drop table if exists public.technician_customer_sites;
drop function if exists app_private.tcs_clear_primary();
drop function if exists app_private.log_assignment_site();
drop function if exists app_private.tcs_before_insert();
drop function if exists public.company_can_view_site(uuid, uuid, uuid, text);
drop function if exists app_private.is_assigned_site(uuid, uuid, uuid);

notify pgrst, 'reload schema';
