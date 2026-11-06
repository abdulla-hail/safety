// تشغيل اختبارات العزل والصلاحيات على قاعدة Supabase الفعلية (يتطلب .env.migrate.local).
// كل العمليات داخل معاملة واحدة يُتراجع عنها في النهاية؛ لا تبقى أي بيانات اختبار.
process.env.LIVE_DB = "1";
await import("./platform.test.mjs");
