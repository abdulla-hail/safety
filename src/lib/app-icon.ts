import "server-only";

import sharp from "sharp";

/** مقاسات أيقونات التطبيق المثبّت: 180 (iPhone/iPad)، و192 و512 (Android وسطح المكتب) */
export const APP_ICON_SIZES = [180, 192, 512] as const;

const BRAND_BG = "#1e3a5f";
const BRAND_ACCENT = "#d98e04";

/** أيقونة افتراضية (درع المنصة) حين لا يوجد شعار للشركة ولا للمنصة */
function defaultIconSvg(size: number) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${BRAND_BG}"/>
    <path d="M50 18 L76 28 V48 C76 64 65 76 50 82 C35 76 24 64 24 48 V28 Z" fill="none" stroke="${BRAND_ACCENT}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M38 50 L47 59 L63 41" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`);
}

/**
 * أيقونة مربعة PNG بالمقاس المطلوب من شعار (PNG/JPEG/WebP/SVG بأي أبعاد): الشعار كاملًا داخل المربع على خلفية بيضاء.
 * maskable: هامش أكبر حتى لا يُقص الشعار حين يقصّ Android الأيقونة بشكل دائري (المنطقة الآمنة 80٪).
 * شعار تالف أو بصيغة غير مدعومة ⇒ الأيقونة الافتراضية بدل خطأ.
 */
export async function renderAppIcon(logo: Buffer | null, size: number, maskable = false): Promise<Buffer> {
  if (logo) {
    try {
      const inner = Math.round(size * (maskable ? 0.62 : 0.84));
      const fitted = await sharp(logo, { density: 300 }).resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png().toBuffer();
      return await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
        .composite([{ input: fitted, gravity: "center" }]).png().toBuffer();
    } catch (e) {
      console.error("app icon render failed:", (e as Error).message);
    }
  }
  return sharp(defaultIconSvg(size), { density: 300 }).resize(size, size).png().toBuffer();
}
