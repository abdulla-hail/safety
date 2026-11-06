# عين السلامة

منصة عربية لإدارة شركات صيانة أجهزة السلامة ومكافحة الحريق: الشركات وهويتها، المستخدمون والصلاحيات التفصيلية، الفنيون والعملاء والمواقع والإسناد، كتالوج أجهزة السلامة، الأجهزة برموز QR وباركود، أوامر العمل والزيارات والصيانة، التقارير والطباعة، الإشعارات وسجل التدقيق.

- التقنيات: Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + RLS) · Google OAuth.
- حالة التنفيذ والاختبارات: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- الإعداد (Google، الترحيلات، التخزين، النسخ الاحتياطي): [docs/SETUP.md](docs/SETUP.md)

## التشغيل المحلي

```bash
npm install
```
```bash
npm run dev
```

افتح http://localhost:3000

## الأوامر

| الأمر | الوصف |
|---|---|
| `npm test` | اختبارات قاعدة البيانات (Postgres مضمّن) واختبارات QR |
| `npm run test:live` | اختبارات العزل والصلاحيات على قاعدة Supabase الفعلية داخل معاملة يُتراجع عنها |
| `npm run db:inspect` | فحص بنية القاعدة (قراءة فقط) |
| `npm run db:migrate:dry` / `npm run db:migrate` | تجربة/تطبيق الترحيلات |
| `npm run typecheck` · `npm run lint` · `npm run build` | الجودة والبناء |
