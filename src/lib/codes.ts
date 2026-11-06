import "server-only";

import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import { headers } from "next/headers";

/**
 * عنوان المنصة المستخدم داخل رموز QR. يُفضّل ضبط NEXT_PUBLIC_SITE_URL في الإنتاج
 * حتى لا تُطبع ملصقات تحمل عنوانًا محليًا.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export function deviceScanPath(token: string) {
  return `/d/${token}`;
}

/** رمز QR بصيغة SVG؛ تصحيح أخطاء M مناسب للملصقات الصغيرة مع هامش هادئ. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
}

/** باركود Code 128 بصيغة SVG للرمز نفسه (يُقرأ بماسحات الباركود التقليدية). */
export function barcodeSvg(text: string): string {
  return bwipjs.toSVG({ bcid: "code128", text, scale: 2, height: 10, includetext: false, paddingwidth: 4, paddingheight: 2 });
}

/**
 * باركود يملأ صندوقه في الملصقات: يتمدد أفقيًا ورأسيًا بنسبة واحدة لكل الأعمدة،
 * فتبقى نسب عرض الأعمدة (وهي ما يقرؤه الماسح) صحيحة، مع منطقة هادئة 10 وحدات على الجانبين.
 */
export function barcodeSvgFill(text: string): string {
  return bwipjs.toSVG({ bcid: "code128", text, scale: 2, height: 10, includetext: false, paddingwidth: 10, paddingheight: 0 })
    .replace("<svg ", '<svg preserveAspectRatio="none" ');
}
