import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** المسارات المتاحة دون جلسة */
// صفحتا الدعوة تُعرضان قبل الدخول (بهوية الجهة الداعية) بعد التحقق من الرمز؛ القبول نفسه يتطلب الجلسة
// بيان التطبيق وأيقوناته وعامل الخدمة يطلبها المتصفح قبل الدخول أيضًا (تعرض هوية المنصة حينها)
const PUBLIC_PATHS = ["/s", "/login", "/auth/callback", "/invite", "/assistant-invite", "/app-manifest", "/app-icon", "/sw.js"];

export async function updateSession(request: NextRequest) {
  // عودة Google OAuth إلى عنوان الموقع الافتراضي (عندما لا يكون مسار العودة ضمن روابط Supabase المسموحة):
  // يُمرَّر الرمز إلى /auth/callback ليُستكمل الدخول بدل ضياعه في التحويل إلى صفحة الدخول
  const oauthCode = request.nextUrl.searchParams.get("code");
  if (oauthCode && request.nextUrl.pathname === "/") {
    const cb = request.nextUrl.clone();
    cb.pathname = "/auth/callback";
    cb.search = `?code=${encodeURIComponent(oauthCode)}`;
    return NextResponse.redirect(cb);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // نشر بلا متغيرات الاتصال (تُدمج وقت البناء): صفحة واضحة بدل Internal Server Error، وأسماء المتغيرات الناقصة فقط في السجل
  if (!url || !key) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter(Boolean).join(", ");
    console.error(`supabase config missing at build/runtime: ${missing}`);
    return new NextResponse(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عين السلامة</title></head>` +
      `<body style="font-family:system-ui,sans-serif;background:#f5f7fa;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">` +
      `<main style="max-width:28rem;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center">` +
      `<h1 style="font-size:1.25rem;color:#1e3a5f;margin:0 0 8px">المنصة غير متاحة مؤقتًا</h1>` +
      `<p style="color:#475569;line-height:1.8;margin:0">إعداد الاتصال بقاعدة البيانات غير مكتمل في هذا النشر. يُرجى إبلاغ مالك المنصة؛ لا حاجة لأي إجراء منك.</p>` +
      `</main></body></html>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "300", "cache-control": "no-store" } },
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // يحدّث الجلسة ويتحقق من توقيع الرمز
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!data?.claims && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (path !== "/") login.searchParams.set("next", `${path}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}
