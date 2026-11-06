import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/context";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // وجهة اختيارية بعد إعادة الدخول (مثل رابط دعوة)، مسار داخلي فقط
  const form = await request.formData().catch(() => null);
  const next = String(form?.get("next") ?? "");
  const login = new URL("/login", request.nextUrl.origin);
  if (next.startsWith("/") && !next.startsWith("//")) login.searchParams.set("next", next);
  const res = NextResponse.redirect(login, { status: 303 });
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
