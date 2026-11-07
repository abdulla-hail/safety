import "server-only";
import { isShortMapsUrl, parseLocation, type LatLng } from "@/lib/geo";

const ALLOWED = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;

/**
 * محاولة (أفضل جهد) لمعرفة إحداثيات رابط خرائط Google المختصر بتتبع إعادة التوجيه، دون تحميل الصفحة.
 * تقتصر على نطاقات Google (لا طلبات لعناوين أخرى)، بمهلة قصيرة؛ أي فشل يعيد null ولا يمنع حفظ النص.
 */
export async function resolveShortMapsUrl(text: string, timeoutMs = 4000): Promise<LatLng | null> {
  if (!isShortMapsUrl(text)) return null;
  let url = text.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 5; hop++) {
      const host = new URL(url).hostname;
      if (!ALLOWED.test(host)) return null;
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal, cache: "no-store",
        headers: { "user-agent": "Mozilla/5.0 (compatible; location-resolver)" } });
      const loc = res.headers.get("location");
      void res.body?.cancel().catch(() => {});
      if (!loc) return parseLocation(url);
      url = new URL(loc, url).toString();
      const p = parseLocation(url);
      if (p) return p;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
