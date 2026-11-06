import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getPlatformLogo } from "@/lib/platform-branding";
import { APP_ICON_SIZES, renderAppIcon } from "@/lib/app-icon";

/**
 * أيقونة التطبيق المثبّت: شعار الشركة النشطة للمستخدم (من الحاوية الخاصة بجلسته وسياسة التخزين)،
 * وإلا شعار المنصة، وإلا الأيقونة الافتراضية. ?v= في الرابط (من الـ manifest) يتغير مع تغيّر الشركة أو شعارها،
 * فيأخذ المتصفح الأيقونة الجديدة عند تحديث التطبيق المثبّت.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!(APP_ICON_SIZES as readonly number[]).includes(size)) return new NextResponse(null, { status: 404 });
  const maskable = req.nextUrl.searchParams.get("purpose") === "maskable";

  let logo: Buffer | null = null;
  let degraded = false;
  try {
    const ctx = await getContext();
    const m = ctx?.active;
    if (m?.logo_path) {
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from("org-branding").download(m.logo_path);
      if (data) logo = Buffer.from(await data.arrayBuffer());
      else if (error) degraded = true;
    }
    if (!logo) {
      const url = ctx?.platformLogoUrl ?? (await getPlatformLogo());
      if (url) {
        const r = await fetch(url);
        if (r.ok) logo = Buffer.from(await r.arrayBuffer());
        else degraded = true;
      }
    }
  } catch (e) {
    // تعذر الاتصال مؤقتًا: أيقونة افتراضية دون تخزين، فيُعاد طلب الصحيحة لاحقًا
    console.error("app icon source failed:", (e as Error).message);
    degraded = true;
  }
  const png = await renderAppIcon(logo, size, maskable);
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": degraded ? "no-store" : "private, max-age=3600" },
  });
}
