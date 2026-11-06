
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * قياس اختياري (AYS_PERF_LOG=1 عند تشغيل الخادم): يسجل زمن كل طلب إلى Supabase ومساره فقط
 * (بلا معاملات استعلام أو رؤوس أو مفاتيح)، لمعرفة عدد الجولات في كل صفحة وهل هي متوازية.
 */
async function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const t = performance.now();
  const res = await fetch(input, init);
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  console.log(`[perf] ${Date.now()} ${init?.method ?? "GET"} ${url.pathname} ${res.status} ${Math.round(performance.now() - t)}ms`);
  return res;
}

export async function createClient() {
  // بيانات المستخدم تُقرأ دائمًا وقت الطلب (لا تدخل في الصفحات المعدّة مسبقًا)
  await connection();
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("بيانات اتصال Supabase غير مكتملة في .env.local");
  }

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    ...(process.env.AYS_PERF_LOG === "1" ? { global: { fetch: timedFetch } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // قد لا يسمح مكوّن Server Component بتعديل ملفات الارتباط.
          // يتولى proxy.ts تحديث الجلسة.
        }
      },
    },
  });
}
