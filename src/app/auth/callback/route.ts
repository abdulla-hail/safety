import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { INVITE_NEXT_COOKIE, readCookiePath, safeInvitePath } from "@/lib/invite-next";

/** معالجة عودة Google OAuth: تبادل الرمز بجلسة ثم التوجيه للصفحة المناسبة. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const explicitNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  // رابط دعوة محفوظ قبل الدخول: يُستخدم إن عادت خدمة الدخول دون مسار العودة (وإلا يذهب المدعو إلى «لا توجد عضوية»)
  const savedInvite = safeInvitePath(readCookiePath(request.cookies.get(INVITE_NEXT_COOKIE)?.value));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  // دون وجهة محددة: الدعوة المحفوظة، ثم مالك المنصة إلى لوحة الشركات، وغيره إلى لوحة التحكم (التي تتحقق من العضوية بنفسها)
  let next = explicitNext && explicitNext !== "/dashboard" ? explicitNext : savedInvite ?? "/dashboard";
  if (next === "/dashboard") {
    const { data: isAdmin } = await supabase.rpc("is_platform_admin");
    if (isAdmin === true) next = "/platform-admin";
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
