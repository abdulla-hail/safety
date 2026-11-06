import "server-only";

import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** رابط عام لشعار المنصة؛ ?v= يتغير مع كل حفظ فيظهر الشعار الجديد فورًا دون ذاكرة متصفح قديمة */
export function platformLogoUrl(path: string | null | undefined, updatedAt?: string | null) {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/platform-branding/${path.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(updatedAt ?? "")}`;
}

let cached: { at: number; url: string | null } | null = null;

/** شعار المنصة للصفحات العامة (الدخول والدعوات): من دالة عامة، مع ذاكرة 30 ثانية تُبطل عند الحفظ */
export async function getPlatformLogo(): Promise<string | null> {
  // قيمة وقت التشغيل (قد يتغير الشعار)؛ تُقرأ عند الطلب لا أثناء التصيير المسبق
  await connection();
  if (cached && Date.now() - cached.at < 30_000) return cached.url;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_public_settings");
  if (error) return cached?.url ?? null;
  const s = (data ?? {}) as { logo_path?: string | null; logo_updated_at?: string | null };
  cached = { at: Date.now(), url: platformLogoUrl(s.logo_path, s.logo_updated_at) };
  return cached.url;
}

export function invalidatePlatformLogo() {
  cached = null;
}
