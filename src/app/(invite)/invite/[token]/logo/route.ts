import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * شعار الشركة الداعية لصفحة الدعوة: يُتحقق من الرمز أولًا (دعوة معلّقة سارية)، ثم يُوقّع الشعار الحالي فقط.
 * سياسة التخزين نفسها لا تسمح بغير شعار شركة لديها دعوة معلّقة سارية.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_landing", { p_token: decodeURIComponent(token) });
  const path = (data as { status?: string; logo_path?: string | null } | null)?.status === "pending" ? (data as { logo_path?: string | null }).logo_path : null;
  if (!path) return new NextResponse(null, { status: 404 });
  const { data: signed } = await supabase.storage.from("org-branding").createSignedUrl(path, 600);
  if (!signed?.signedUrl) return new NextResponse(null, { status: 404 });
  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}
