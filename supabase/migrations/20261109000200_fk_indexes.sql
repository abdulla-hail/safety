-- =====================================================================
-- عين السلامة — فهارس المفاتيح الأجنبية الناقصة (مشروع cgwnusudjhhxkwnqjzfr) — مقترح، لا يُطبَّق دون موافقة
--
-- فحص قراءة فقط للقاعدة الحية (scripts/db/inspect-company-graph.mjs، 2026-10-28): 41 مفتاحًا أجنبيًا بين جداول التشغيل بلا فهرس
-- يبدأ بعمودها. الأثر مع نمو البيانات:
--   - الاستعلامات المصفّاة بها (زيارات الموقع، سجلات زيارة، بلاغات أمر العمل/الزيارة، دورات موقع/عميل...) تمسح الجدول كاملًا.
--   - حذف/أرشفة صف أب (جهاز، موقع، عميل، فني، زيارة، أمر عمل) يفحص كل جدول ابن بمسح كامل لكل صف محذوف،
--     فيصير الحذف الكامل للشركة O(صفوف × صفوف).
-- القاعدة اليوم شبه فارغة، فالإنشاء فوري؛ create index داخل معاملة يقفل الكتابة على الجدول لحظة الإنشاء فقط.
-- لا تغيير في البيانات ولا الصلاحيات ولا السياسات. لا يمس safety_* (عدا safety_systems التابع للكتالوج كما في م1).
-- =====================================================================

-- الشركة (الاستعلامات والحذف الكامل حسب company_id)
create index if not exists attachments_company_idx on public.attachments (company_id);
create index if not exists device_due_changes_company_idx on public.device_due_changes (company_id);
create index if not exists device_fault_events_company_idx on public.device_fault_events (company_id);
create index if not exists device_maintenance_cycles_company_idx on public.device_maintenance_cycles (company_id);
create index if not exists maintenance_corrections_company_idx on public.maintenance_corrections (company_id);
create index if not exists notifications_company_idx on public.notifications (company_id);
create index if not exists technician_assignment_events_company_idx on public.technician_assignment_events (company_id);
create index if not exists technician_customer_sites_company_idx on public.technician_customer_sites (company_id);
create index if not exists technician_customers_company_idx on public.technician_customers (company_id);
create index if not exists visit_devices_company_idx on public.visit_devices (company_id);

-- الموقع والعميل
create index if not exists visits_site_idx on public.visits (site_id);
create index if not exists work_orders_site_idx on public.work_orders (site_id);
create index if not exists visit_devices_site_idx on public.visit_devices (site_id);
create index if not exists visit_devices_customer_idx on public.visit_devices (customer_id);
create index if not exists device_maintenance_cycles_site_idx on public.device_maintenance_cycles (site_id);
create index if not exists device_maintenance_cycles_customer_idx on public.device_maintenance_cycles (customer_id);
create index if not exists device_transfers_from_site_idx on public.device_transfers (from_site_id);
create index if not exists device_transfers_to_site_idx on public.device_transfers (to_site_id);
create index if not exists device_transfers_from_customer_idx on public.device_transfers (from_customer_id);
create index if not exists device_transfers_to_customer_idx on public.device_transfers (to_customer_id);

-- الزيارة وأمر العمل والبلاغ
create index if not exists maintenance_records_visit_idx on public.maintenance_records (visit_id);
create index if not exists maintenance_records_work_order_idx on public.maintenance_records (work_order_id);
create index if not exists maintenance_records_fault_idx on public.maintenance_records (fault_id);
create index if not exists device_faults_visit_idx on public.device_faults (visit_id);
create index if not exists device_faults_work_order_idx on public.device_faults (work_order_id);
create index if not exists device_faults_assigned_technician_idx on public.device_faults (assigned_technician_id);
create index if not exists visits_work_order_idx on public.visits (work_order_id);
create index if not exists visit_devices_fault_idx on public.visit_devices (fault_id);

-- الجهاز والفني والكتالوج
create index if not exists work_order_devices_device_idx on public.work_order_devices (device_id);
create index if not exists devices_replaced_by_idx on public.devices (replaced_by_device_id);
create index if not exists devices_system_idx on public.devices (system_id);
create index if not exists devices_catalog_item_idx on public.devices (catalog_item_id);
create index if not exists maintenance_record_technicians_technician_idx on public.maintenance_record_technicians (technician_id);
create index if not exists visit_devices_technician_idx on public.visit_devices (technician_id);
create index if not exists visit_devices_follow_up_technician_idx on public.visit_devices (follow_up_technician_id);
create index if not exists technicians_user_idx on public.technicians (user_id);
create index if not exists company_invitations_membership_idx on public.company_invitations (membership_id);
