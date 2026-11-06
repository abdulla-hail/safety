# ملخص التسليم — «عين السلامة» (محدّث 2026-10-26)

## البيئة والقواعد الإلزامية
- المشروع: `C:\Users\Public\Projects\safety-maintenance-platform` — Next.js 16.4.2 (cacheComponents، Turbopack)، React 19، TypeScript، Tailwind 4، Supabase. اقرأ `AGENTS.md` و`node_modules/next/dist/docs/` قبل كتابة كود (إصدار مختلف).
- قاعدة Supabase الوحيدة: `cgwnusudjhhxkwnqjzfr` (ain-alsalama-test، منطقة سيول ap-northeast-2). **لا تُمس**: المشروع `jweg…`، Hostinger، المتجر، جداول/دوال `safety_*`.
- الأسرار: `.env.local` (رابط ومفتاح publishable عامان)، `.env.migrate.local` (`DATABASE_URL` للترحيلات فقط). لا تُطبع أبدًا.
- المستخدم يشغّل `npm run dev` على المنفذ 3000؛ اربط المعاينة بإعداد `existing` في `.claude/launch.json` ولا تشغّل خادمًا آخر. تسجيل الدخول بـ Google يجريه المستخدم بنفسه داخل لوحة المعاينة (لا تُدخل بيانات دخول).
- **أي تغيير على القاعدة**: فحص قراءة ← `node scripts/db/restore-point-cgwn.mjs` ← `node scripts/db/apply-cgwn.mjs <migration> <rollback> --dry-run` ← شرح الأثر وموافقة صريحة ← `--apply` ← `npm run db:cgwn:verify` و`db:cgwn:verify-ops` و`db:cgwn:verify-workflows` (كلها متراجع عنها). ملف التراجع يُولَّد من تعريفات القاعدة الحية قبل الترحيل (انظر `scripts/db/gen-rollback-00*.mjs`) ويرفض عند وجود بيانات جديدة. لا تستخدم `db:migrate`. لا تحذف بيانات ولا تعدّل بيانات حقيقية للاختبار.
- تطبيق الترحيلات يقفل جداول دقيقة أو أكثر؛ نفّذه حين لا يُستخدم التطبيق (سبّب سابقًا مهلة `get_my_context` ظهرت كأخطاء صلاحيات).
- يتواصل المستخدم بالعربية، ويريد تقارير صادقة تميّز المختبر فعليًا عن غير المختبر، وموافقة قبل أي ترحيل أو رفع خارجي.

## الترحيلات المطبّقة (`supabase/migrations/`) — التراجع في `supabase/proposed/`
1. `20261027000100` الشركات والعضويات والدعوات والتدقيق.
2. `20261028000100` الجداول التشغيلية بـ `company_id`، الصلاحيات حسب الدور + تخصيص العضو، الهوية، الإشعارات، التخزين `org-branding`/`org-files`، `get_my_context`.
3. `20261029000100` صورة الجهاز `devices.image_path` (مسار `{company}/device-image/{device}/`)، ربط عضوية الفني تلقائيًا بسجل الفني، صلاحيات مخصصة في الدعوة.
4. `20261030000100` مساعدو المالك وصلاحيات `platform.*`؛ حارس دوال المنصة السبع صار `require_platform_perm`.
5. `20261031000100` صفحة الدعوة بهوية الشركة (`invitation_landing`)، شعار المنصة (`platform_settings` + حاوية عامة `platform-branding` + صلاحية `platform.branding`)، دعوات مساعد المالك من المالك فقط (أُغلق مسار الطلب)، `platform_audit_log`.
- **معلّق بانتظار قرار المستخدم**: `supabase/proposed/20261027000200_owner_and_member_visibility.sql` (يعيد تعريف دالتي `safety_*` قديمتين — نبّه لذلك).
- **طُبّقت 2026-10-27 بموافقة المستخدم (نحو 06:07–06:50 UTC، نقطة استعادة `.backups/restore-point-20261027-060636`):** م5 `20261105000100_visits_faults_history` (تجربة جافة 50/50، تطبيق 44/44)، م5ب `20261106000100_visit_inspections` (53/53، 47/47)، و`20261107000100_operational_links` (مفاتيح العميل/الموقع المفقودة التي كانت تُفشل الاستعلامات المضمّنة بـ PGRST200؛ 55/55، 49/49). ملفات التراجع في `supabase/proposed/`. اختبار التدفق الحي المتراجع عنه: `npm run db:cgwn:verify-visit-flow` (29/29).
- **طُبّق أيضًا:** `20261108000100_work_order_execution` (55/55، 49/49، نقطة استعادة `restore-point-20261027-073141`)؛ اختبار حي: `npm run db:cgwn:verify-wo-flow` (28/28).
- سكربتات تحقق قديمة تُدخل `maintenance_records` مباشرة أو تفترض ما قبل م5 (`verify-cgwn-faults/-schedule/-fixes/-devices/-assignments`) تفشل الآن بالتصميم وتحتاج تحديثًا لمسار الزيارة؛ `verify-cgwn-workflows` حُدّث (127/127). اختبار م5ب على PGlite: `tests/cgwn/visit-inspections.test.mjs`. الواجهة تكشفهما بـ `hasPhase5`/`hasInspections` في `src/lib/schema.ts`.

- **طُبّق (2026-11-06، بموافقة المستخدم):** `20261110000100_surveys_quotes_maps` — المعاينات وبنودها، عروض الأسعار، روابط المشاركة مع العميل، إحداثيات الفروع. اختبارات PGlite `tests/cgwn/surveys-quotes.test.mjs` (8/8)؛ تجربة حية 55/55 ثم تطبيق 49/49؛ verify 18/18، verify-ops 14/14، verify-workflows 127/127؛ نقطة استعادة `restore-point-20261106-163537`. التطبيق: `node scripts/db/apply-cgwn.mjs supabase/migrations/20261110000100_surveys_quotes_maps.sql supabase/proposed/20261110000100_rollback.sql --apply`. واجهة أوامر العمل أُزيلت (الجداول باقية).
- **ترحيلات 2026-10-28 (التفاصيل في `docs/PERF_AND_PURGE_2026-10-28.md`)**: `20261109000200_fk_indexes` (37 فهرسًا) و`20261109000300_rls_initplan` **مطبّقتان** (تحقق قراءة فقط 2026-11-06: 37/37 فهرسًا، والسياسات بصيغة initplan)؛ `20261109000100_company_purge` (الحذف الكامل للشركة) **ما زال مقترحًا غير مطبّق** في `supabase/proposed/`. التراجع لكلٍّ في `supabase/proposed/*_rollback.sql`. اختبارات PGlite: `tests/cgwn/company-purge.test.mjs`، `tests/cgwn/rls-initplan.test.mjs`؛ قياس الحجم: `scripts/perf/pglite-scale.mjs`.

## التطبيق (أهم النقاط)
- السياق: `src/lib/auth/context.ts` — `getClaims` + `get_my_context` مع ذاكرة 30 ث لكل جلسة، `invalidateMyContext()` بعد العمليات الذاتية، وعند تعذر الاتصال: إعادة محاولة ثم آخر سياق معروف ثم `ContextUnavailableError` (لا تُعرض كـ«لا صلاحية»). `platformRole`/`platformPermissions` للمالك والمساعد.
- الأداء: كل طلب إلى Supabase ≈350–400 مللي ثانية (القاعدة في سيول؛ RTT 332 مقابل ≈131 لفرانكفورت) ⇒ تجنّب الطلبات المتتابعة؛ الصفحات بجولة متوازية واحدة واستعلامات مضمّنة. السياق يُعرض من الذاكرة ويُحدَّث في الخلفية حتى 5 دقائق، وفحوص المخطط نهائية بعد أول «مطبّق». `AYS_PERF_LOG=1` يسجل زمن كل طلب Supabase. أدوات القياس `scripts/perf/` (منها `measure-prod-vs-dev`، `measure-regions`، `measure-parallel`، `pglite-scale`).
- الأقسام: لوحة المالك `/platform-admin` (+ `/assistants`، `/settings` لشعار المنصة)، فريق الشركة `/team` (دعوات، فلاتر، تحديد، طباعة `/print/team`، تصدير `/team/export`)، الفنيون عبر الفريق فقط (`/technicians` يحوّل)، الدعوات العامة `/invite/[token]` و`/assistant-invite/[token]` في `src/app/(invite)`.
- الطباعة: `src/components/print/PrintDocument.tsx` (ترويسة/تذييل متكرران، أرقام صفحات)، الملصقات `/print/labels` (A4 ستة ملصقات)، بيانات الأجهزة `/print/devices`.
- التصميم: اللون التفاعلي `#D98E04` من متغيرات `src/app/globals.css` (`--brand*`)؛ هوية الشركة في `--company` (القائمة الجانبية والمستندات فقط)؛ حركات CSS فقط مع `prefers-reduced-motion`.
- البريد: لا خدمة مهيأة؛ `src/lib/mail.ts` يرسل عبر Resend فقط إن ضُبط `RESEND_API_KEY` و`MAIL_FROM`، وإلا تُعرض الروابط للنسخ دون ادعاء الإرسال.

## الاختبارات (آخر تشغيل)
`npm test` 97/97 (2026-10-28) · TypeScript ✓ · Lint ✓ · Build ✓ · حي متراجع عنه: دعوات 18/18، تشغيل 14/14، دورات عمل 124/124.

## النشر التجريبي على Vercel (متوقف عند خطوة المستخدم)
- `.vercelignore` قائمة سماح (src، public، package.json، package-lock.json، next.config.ts، tsconfig.json، eslint.config.mjs، vercel.json)؛ `vercel.json` بمنطقة `icn1`. بناء نسخة معزولة بهذه الملفات فقط نجح، و169 ملفًا بلا أسرار.
- الخطوة التالية للمستخدم: `npx --yes vercel@latest login` ثم `npx --yes vercel@latest deploy --dry` ومراجعة القائمة معه قبل أي رفع.
- قبل أن يعمل الدخول من الرابط: إضافة `https://<النطاق>.vercel.app/**` إلى Redirect URLs في Supabase Auth (يفعلها المستخدم). متغيرات Vercel: `NEXT_PUBLIC_SUPABASE_URL`، `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`، و`NEXT_PUBLIC_SITE_URL` (موصى به)؛ لا تُضف `DATABASE_URL`.
- عائق: حد طلب Vercel 4.5 م.ب (صور الأجهزة حتى 5 م.ب والمرفقات حتى 10 م.ب ستفشل فوقه).

## لم يُختبر عمليًا بعد (يحتاج جلسة/حسابات)
الصفحات المسجّلة بعد التصميم الجديد؛ إضافة موقع والتقارير والطباعة والتصدير بحساب المدير؛ حفظ الهوية والشعارات؛ فلاتر الفريق وCSV؛ دعوة فني وقبولها؛ دعوة مساعد مالك؛ الطباعة الفعلية. التفاصيل الكاملة في آخر أقسام `IMPLEMENTATION_STATUS.md`.
