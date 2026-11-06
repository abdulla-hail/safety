import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/context";

/**
 * مسار رمز QR المطبوع على الجهاز: ‎/d/TOKEN
 * يتطلب جلسة (يحوّل proxy لتسجيل الدخول ثم يعود)، ثم يتحقق من صلاحية المستخدم في قاعدة البيانات.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/d/${token}`)}`, origin));
  }
  const { data } = await supabase.rpc("resolve_device_token", { p_token: token });
  const r = (data ?? { status: "invalid" }) as { status: string; device_id?: string; organization_id?: string };

  if (r.status === "ok" && r.device_id) {
    const res = NextResponse.redirect(new URL(`/devices/${r.device_id}`, origin));
    // تفعيل شركة الجهاز إن كان المستخدم عضوًا في أكثر من شركة (التحقق تم في قاعدة البيانات)
    if (r.organization_id) {
      res.cookies.set(ACTIVE_ORG_COOKIE, r.organization_id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    }
    return res;
  }
  const safe = token.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return NextResponse.redirect(new URL(`/scan?status=${encodeURIComponent(r.status)}&t=${safe}`, origin));
}
