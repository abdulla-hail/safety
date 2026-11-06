-- التراجع عن 20261107000100_operational_links.sql: إزالة المفاتيح والفهارس المضافة فقط (لا بيانات تتأثر)
alter table public.maintenance_records drop constraint if exists mr_customer_fk;
alter table public.maintenance_records drop constraint if exists mr_site_fk;
alter table public.device_faults drop constraint if exists df_customer_fk;
alter table public.device_faults drop constraint if exists df_site_fk;
do $$ begin
  if to_regclass('public.visit_devices') is not null then
    alter table public.visit_devices drop constraint if exists vd_customer_fk;
    alter table public.visit_devices drop constraint if exists vd_site_fk;
  end if;
end $$;
alter table public.device_maintenance_cycles drop constraint if exists dmc_customer_fk;
alter table public.device_maintenance_cycles drop constraint if exists dmc_site_fk;
drop index if exists public.maintenance_records_site_idx;
drop index if exists public.device_faults_customer_idx;
drop index if exists public.device_faults_site_idx;
notify pgrst, 'reload schema';
