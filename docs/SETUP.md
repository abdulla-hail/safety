# دليل الإعداد والتشغيل — منصة «عين السلامة»

> لا يحتوي هذا الملف أي أسرار. لا تضع مفاتيح أو كلمات مرور في المستودع.

## 1. المتطلبات

- Node.js 24 أو أحدث (تم الاختبار على 24.22.1) و npm 11.
- مشروع Supabase القائم (المتغيرات في `.env.local`).

## 2. متغيرات البيئة

| الملف | المتغير | الاستخدام |
|---|---|---|
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | عنوان مشروع Supabase (عام) |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | المفتاح العام (publishable) — آمن في المتصفح لأن RLS مفعّل |
| `.env.local` (اختياري) | `NEXT_PUBLIC_SITE_URL` | العنوان العام للمنصة في الإنتاج، يُطبع داخل رموز QR. **يجب ضبطه قبل طباعة ملصقات حقيقية** حتى لا تحمل عنوانًا محليًا |
| `.env.migrate.local` | `DATABASE_URL` | رابط Postgres لتطبيق الترحيلات واختبارات RLS فقط. لا يُستخدم في التطبيق، ومستثنى من git |

لا يستخدم التطبيق مفتاح `service_role` إطلاقًا، لا في الخادم ولا في المتصفح.

## 3. تطبيق ترحيلات قاعدة البيانات

الترحيلات في `supabase/migrations/` إضافية فقط: لا تحذف جداول ولا بيانات، وتعمل بـ `if not exists`.

```bash
npm run db:inspect
```
يطبع بنية القاعدة الحالية (قراءة فقط) للمراجعة.

```bash
npm run db:migrate:dry
```
يجرّب كل ترحيل داخل معاملة ثم يتراجع عنها (لا تغيير فعلي).

```bash
npm run db:migrate
```
يطبّق الترحيلات بالترتيب، كل ملف في معاملة مستقلة، ويسجل المطبّق في `app_private.applied_migrations`.

بديل يدوي: انسخ محتوى كل ملف بالترتيب إلى Supabase → SQL Editor وشغّله.

بعد التطبيق:
```bash
npm run test:live
```
يشغّل اختبارات العزل والصلاحيات على القاعدة الفعلية داخل معاملة واحدة يُتراجع عنها؛ لا تبقى أي بيانات اختبار.

## 4. تسجيل الدخول عبر Google (مطلوب)

حاليًا مزود Google **غير مفعّل** في Supabase (تم التحقق من `/auth/v1/settings`). خطوات التفعيل:

### Google Cloud Console
1. APIs & Services → OAuth consent screen: اختر External، أضف اسم التطبيق والبريد، والنطاقات `openid`, `email`, `profile`.
2. Credentials → Create Credentials → OAuth client ID → النوع **Web application**.
3. **Authorized JavaScript origins**: `http://localhost:3000` وعنوان الإنتاج.
4. **Authorized redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback`
   (يظهر الرابط الدقيق في Supabase → Authentication → Providers → Google).
5. انسخ Client ID و Client Secret (لا تضعهما في المستودع).

### Supabase Dashboard
1. Authentication → Providers → Google: فعّل المزود والصق Client ID و Client Secret.
2. Authentication → URL Configuration:
   - **Site URL**: عنوان الإنتاج (أو `http://localhost:3000` أثناء التطوير).
   - **Redirect URLs**: أضف `http://localhost:3000/auth/callback` و `https://<domain>/auth/callback`.
3. يُنصح (اختياريًا) بتعطيل مزود Email في Providers بعد التأكد من دخول مالك المنصة بحساب Google، لأن المنصة لا تستخدم كلمات مرور محلية.
   - إذا كان لمالك المنصة حساب بريد/كلمة مرور قائم، فإن Supabase يربط هوية Google تلقائيًا بالحساب نفسه عند تطابق البريد الموثّق، فيبقى في `platform_admins`.

### لماذا لا يمنح Google وحده أي وصول؟
- الدخول يُنشئ جلسة فقط. الوصول لبيانات شركة يتطلب عضوية `active` في شركة `approved` غير منتهية، مع صلاحيات تفصيلية.
- العضوية تُنشأ فقط عبر: دعوة من مدير الشركة لبريد Google الموثّق نفسه، أو طلب انضمام يعتمده المدير، أو طلب تسجيل شركة يعتمده مالك المنصة.
- كل ذلك مفروض في قاعدة البيانات (RLS والدوال)، وليس في الواجهة فقط.

## 5. التخزين (الشعارات والمرفقات)

تُنشئ الترحيلات حاويتين **خاصتين** (غير عامة):
- `org-branding`: الشعارات والأختام. المسار يبدأ بمعرّف الشركة. القراءة لأعضاء الشركة، والكتابة لمن يملك `settings.branding`.
- `org-files`: صور ومرفقات الأجهزة والزيارات... القراءة فقط إن كان سجل المرفق مرئيًا للمستخدم وفق RLS.

تُعرض الملفات بروابط موقّعة مؤقتة (ساعة واحدة).

## 6. التنبيهات المجدولة

- يُشغَّل فحص مواعيد الصيانة تلقائيًا عند فتح لوحة التحكم (بحد أقصى مرة كل ساعة لكل شركة).
- للجدولة اليومية داخل Supabase دون خدمات مدفوعة: فعّل إضافة `pg_cron` ثم شغّل `supabase/optional/pg_cron_maintenance_alerts.sql`.
- الفحص آمن للتكرار: لكل جهاز وموعد مفتاح منع تكرار، فلا تتكرر الإشعارات.

## 7. الرسائل الخارجية (بريد / SMS / WhatsApp)

- البنية موجودة: جدول `outbound_messages` (الحالة، المحاولات، آخر خطأ، وقت الإرسال، المرجع) وإعداد `organizations.notification_settings`.
- **لا يوجد مزود مهيأ ولا يُرسل أي شيء حاليًا**. الإشعارات الداخلية تعمل باستقلال تام.
- للتفعيل لاحقًا: اختر مزودًا (مثل Resend/SendGrid للبريد أو مزود SMS معتمد)، وضع مفتاحه في متغيرات بيئة الخادم فقط (أو Supabase Edge Function secrets)، وأنشئ عاملًا يقرأ الرسائل `pending` ويحدّث حالتها. احترم موافقة المستلمين.

## 8. النسخ الاحتياطي والاستعادة

- لم يتم التحقق من خطة مشروع Supabase أو من تفعيل النسخ التلقائي (يتطلب صلاحية لوحة التحكم). راجع: Supabase → Database → Backups.
  - الخطة المجانية لا تتضمن نسخًا يومية قابلة للاستعادة من اللوحة؛ الخطط المدفوعة تتضمن نسخًا يومية و PITR اختياريًا.
- نسخ يدوي مجاني (يتطلب Supabase CLI أو `pg_dump`):
  ```bash
  pg_dump "$DATABASE_URL" --no-owner --schema=public --schema=app_private -Fc -f backup.dump
  ```
  ملفات التخزين لا تُنسخ بـ `pg_dump`؛ انسخها عبر Supabase CLI (`supabase storage cp`) أو واجهة Storage.
- الاستعادة (`pg_restore`) عملية استبدال حساسة: لا تُنفذ على الإنتاج دون نسخة حديثة وموافقة صريحة.
- البيانات التاريخية محمية تصميميًا: سجلات الصيانة والتدقيق لا تُعدّل ولا تُحذف، والحذف النهائي يُرفض عند وجود علاقات.

## 9. التشغيل والمعاينة المحلية

```bash
npm install
```
```bash
npm run dev
```
ثم افتح `http://localhost:3000`.

الاختبارات والبناء:
```bash
npm test
```
```bash
npm run typecheck
```
```bash
npm run lint
```
```bash
npm run build
```
