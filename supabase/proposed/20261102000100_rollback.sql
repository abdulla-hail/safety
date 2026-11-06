-- =====================================================================
-- التراجع عن 20261102000100_device_location_transfers.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجد سجل نقل أو منح صلاحية النقل لعضو بتخصيص.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.device_transfers)
     or exists (select 1 from public.company_memberships where 'devices.transfer' = any (permissions))
     or exists (select 1 from public.company_invitations where 'devices.transfer' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد سجلات نقل أو صلاحيات نقل ممنوحة';
  end if;
end $$;

CREATE OR REPLACE FUNCTION app_private.devices_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; s_customer uuid;
begin
  if tg_op = 'UPDATE' and new.qr_token is distinct from old.qr_token then
    raise exception 'لا يمكن تغيير رمز الجهاز' using errcode = 'P0001';
  end if;
  if new.site_id is not null then
    select customer_id into s_customer from public.customer_sites where id = new.site_id;
    if s_customer is distinct from new.customer_id then raise exception 'الموقع المحدد لا يتبع العميل نفسه' using errcode = '23514'; end if;
  end if;
  if tg_op = 'INSERT' then
    if new.catalog_item_id is not null then
      select * into c from public.catalog_items where id = new.catalog_item_id;
      new.system_id := coalesce(new.system_id, c.system_id);
      if new.system_id is distinct from c.system_id then raise exception 'تعريف الجهاز لا يتبع النظام المحدد' using errcode = '23514'; end if;
      new.name := coalesce(nullif(btrim(new.name), ''), c.name);
      new.manufacturer := coalesce(nullif(btrim(new.manufacturer), ''), c.manufacturer);
      new.model := coalesce(nullif(btrim(new.model), ''), c.model);
      new.device_type := coalesce(nullif(btrim(new.device_type), ''), c.device_type);
      new.maintenance_interval_days := coalesce(new.maintenance_interval_days, c.default_interval_days);
    end if;
    if new.maintenance_interval_days is null and new.system_id is not null then
      select default_interval_days into new.maintenance_interval_days from public.safety_systems where id = new.system_id;
    end if;
    if new.next_maintenance_at is null and new.maintenance_interval_days is not null then
      new.next_maintenance_at := coalesce(new.last_maintenance_at, new.installed_at, current_date) + new.maintenance_interval_days;
    end if;
    insert into app_private.device_tokens (token, device_id, company_id) values (new.qr_token, new.id, new.company_id);
  end if;
  return new;
end $function$;

drop function if exists app_private.is_client_request();
drop trigger if exists trg_customer_sites_archive_devices on public.customer_sites;
drop function if exists app_private.sites_block_archive_with_devices();
drop function if exists public.device_move(uuid, uuid, text, timestamptz);
drop table if exists public.device_transfers;
delete from public.permission_definitions where key = 'devices.transfer';

notify pgrst, 'reload schema';
