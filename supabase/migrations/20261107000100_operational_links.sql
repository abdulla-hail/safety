-- =====================================================================
-- عين السلامة — روابط العميل/الموقع المفقودة (مشروع cgwnusudjhhxkwnqjzfr)
--
-- السبب: الأعمدة customer_id/site_id في سجلات الصيانة والبلاغات وبنود الزيارات ودورات الاستحقاق بلا مفتاح أجنبي،
-- فتفشل استعلامات الواجهة المضمّنة (customer:customers(name)، site:customer_sites(name)) بـ PGRST200
-- («تعذر تحميل التقرير»، وصفحة سجلات الصيانة الفارغة). القيم تُنسخ من الجهاز داخل القاعدة فهي صحيحة دائمًا.
-- يضيف المفاتيح فقط (يتحقق من الصفوف القائمة)؛ لا يحذف ولا يعدّل أي صف. لا يمس safety_*.
-- =====================================================================
do $$
declare r record;
begin
  for r in select * from (values
    ('maintenance_records', 'mr_customer_fk', 'customer_id', 'customers'),
    ('maintenance_records', 'mr_site_fk', 'site_id', 'customer_sites'),
    ('device_faults', 'df_customer_fk', 'customer_id', 'customers'),
    ('device_faults', 'df_site_fk', 'site_id', 'customer_sites'),
    ('visit_devices', 'vd_customer_fk', 'customer_id', 'customers'),
    ('visit_devices', 'vd_site_fk', 'site_id', 'customer_sites'),
    ('device_maintenance_cycles', 'dmc_customer_fk', 'customer_id', 'customers'),
    ('device_maintenance_cycles', 'dmc_site_fk', 'site_id', 'customer_sites')
  ) v(tbl, con, col, ref) loop
    continue when to_regclass('public.' || r.tbl) is null;
    continue when exists (select 1 from pg_constraint where conname = r.con and conrelid = ('public.' || r.tbl)::regclass);
    execute format('alter table public.%I add constraint %I foreign key (%I, company_id) references public.%I (id, company_id) on delete restrict',
      r.tbl, r.con, r.col, r.ref);
  end loop;
end $$;

create index if not exists maintenance_records_site_idx on public.maintenance_records (site_id);
create index if not exists device_faults_customer_idx on public.device_faults (customer_id);
create index if not exists device_faults_site_idx on public.device_faults (site_id);

notify pgrst, 'reload schema';
