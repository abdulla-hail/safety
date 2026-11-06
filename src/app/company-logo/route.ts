import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

/**
 * شعار الشركة النشطة للمستخدم: رابط موقّع مؤقت من حاوية خاصة، يُطلب من المتصفح بعد عرض الصفحة.
 * المسار المطلوب يأتي في v (يتغير مع كل شعار جديد فلا يُعرض شعار قديم من ذاكرة المتصفح)،
 * ويُقبل فقط إن كان داخل مجلد شركة المستخدم؛ وسياسة التخزين تسمح لأعضاء الشركة فقط.
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  const org = ctx?.active?.organization_id;
  const requested = req.nextUrl.searchParams.get("v") ?? ctx?.active?.logo_path ?? "";
  if (!org || !requested.startsWith(`${org}/`) || requested.includes("..")) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.storage.from("org-branding").createSignedUrl(requested, 3600);
  if (!data?.signedUrl) return new NextResponse(null, { status: 404 });
  const res = NextResponse.redirect(data.signedUrl, 302);
  // آمن للتخزين لأن الرابط يتضمن المسار نفسه؛ الشعار الجديد له رابط جديد
  res.headers.set("Cache-Control", "private, max-age=600");
  return res;
}
