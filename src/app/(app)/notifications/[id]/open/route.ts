import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";

/** يحدد الإشعار كمقروء ثم ينتقل للصفحة المرتبطة (الصفحة نفسها تتحقق من الصلاحية). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = request.nextUrl.origin;
  if (!isUuid(id)) return NextResponse.redirect(new URL("/notifications", origin));
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("link, read_at").eq("id", id).maybeSingle();
  if (!data) return NextResponse.redirect(new URL("/notifications", origin));
  if (!data.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  const link = typeof data.link === "string" && data.link.startsWith("/") && !data.link.startsWith("//") ? data.link : "/notifications";
  return NextResponse.redirect(new URL(link, origin));
}
