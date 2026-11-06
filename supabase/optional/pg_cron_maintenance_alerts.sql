-- اختياري: جدولة فحص مواعيد الصيانة يوميًا داخل Supabase باستخدام pg_cron (إضافة مجانية ضمن Postgres).
-- لا يُطبَّق تلقائيًا ضمن الترحيلات. فعّل الإضافة أولًا من: Database → Extensions → pg_cron
-- الفحص آمن للتكرار: الإشعارات تحمل مفتاح منع تكرار لكل جهاز وموعد.

create extension if not exists pg_cron;

-- كل يوم الساعة 05:00 بتوقيت UTC (08:00 بتوقيت الرياض)
select cron.schedule(
  'ays-maintenance-alerts',
  '0 5 * * *',
  $$ select app_private.run_all_maintenance_alerts(); $$
);

-- للإلغاء:
-- select cron.unschedule('ays-maintenance-alerts');
