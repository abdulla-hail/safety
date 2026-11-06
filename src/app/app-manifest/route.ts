import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { getPlatformLogo } from "@/lib/platform-branding";

/**
 * بيان تطبيق الويب (PWA) لكل مستخدم: اسم شركته النشطة ولونها وأيقونتها من شعارها، فيظهر التطبيق المثبّت بهوية الشركة.
 * قبل الدخول (أو لمالك المنصة دون شركة): اسم المنصة وشعارها. يُجلب بملفات تعريف الارتباط (crossorigin=use-credentials).
 */
export async function GET() {
  const ctx = await getContext().catch(() => null);
  const m = ctx?.active ?? null;
  const name = m?.organization_name ?? "عين السلامة";
  // يتغير مع الشركة أو شعارها ⇒ روابط أيقونات جديدة فيحدّثها المتصفح في التطبيق المثبّت
  const v = encodeURIComponent(m ? `${m.organization_id}:${m.logo_path ?? "none"}` : `platform:${ctx?.platformLogoUrl ?? (await getPlatformLogo().catch(() => null)) ?? "default"}`);
  const icon = (size: number, purpose: "any" | "maskable") =>
    ({ src: `/app-icon/${size}?v=${v}${purpose === "maskable" ? "&purpose=maskable" : ""}`, sizes: `${size}x${size}`, type: "image/png", purpose });
  const manifest = {
    id: "/",
    name,
    short_name: name.length > 14 ? name.slice(0, 14).trim() : name,
    description: m ? `منصة ${name} لإدارة صيانة أجهزة السلامة — عين السلامة` : "منصة إدارة صيانة أجهزة السلامة",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: m?.primary_color ?? "#1e3a5f",
    icons: [icon(192, "any"), icon(512, "any"), icon(512, "maskable")],
  };
  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, no-cache" },
  });
}
