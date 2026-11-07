/** أدوات المواقع الجغرافية للفروع (بلا اعتماديات، تُختبر مباشرة) */
export interface LatLng { lat: number; lng: number }

export const DEFAULT_CENTER: LatLng = { lat: 24.7136, lng: 46.6753 }; // الرياض

export function validLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = typeof lat === "string" ? Number.parseFloat(lat) : typeof lat === "number" ? lat : NaN;
  const b = typeof lng === "string" ? Number.parseFloat(lng) : typeof lng === "number" ? lng : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const NUM = String.raw`(\d{1,3}(?:[.,]\d+)?)`;
/** درجات ودقائق وثوانٍ: 24°44'12.8"N 46°50'06.9"E (تقبل ′ ″ ’ ” وغياب الثواني، والاتجاه قبل الرقم أو بعده) */
const DMS_PART = String.raw`([NSEWشجقغ])?\s*(\d{1,3})\s*[°º˚]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’ʹ]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”ʺ]|''|′′))?\s*([NSEWشجقغ])?`;

function dmsValue(deg: string, min?: string, sec?: string) {
  const n = (x?: string) => (x ? Number.parseFloat(x.replace(",", ".")) : 0);
  return n(deg) + n(min) / 60 + n(sec) / 3600;
}
const NEG = new Set(["S", "W", "ج", "غ"]);
const LNG_DIR = new Set(["E", "W", "ق", "غ"]);

export function parseDms(text: string): LatLng | null {
  const re = new RegExp(`${DMS_PART}[\\s,،;]+${DMS_PART}`, "i");
  const m = text.toUpperCase().match(re);
  if (!m) return null;
  const parts = [
    // صيغة «N 24°… E 46°…»: اتجاه الجزء الثاني قد يُلتقط لاحقةً للجزء الأول
    { v: dmsValue(m[2], m[3], m[4]), dir: (m[1] ?? m[5] ?? "").toUpperCase() },
    { v: dmsValue(m[7], m[8], m[9]), dir: (m[6] ?? m[10] ?? (m[1] && m[5] ? m[5] : "")).toUpperCase() },
  ].map((p) => ({ ...p, v: NEG.has(p.dir) ? -p.v : p.v }));
  // إن جاء خط الطول أولًا (E/W) يُعاد الترتيب
  const [a, b] = LNG_DIR.has(parts[0].dir) && !LNG_DIR.has(parts[1].dir) ? [parts[1], parts[0]] : parts;
  return validLatLng(a.v, b.v);
}

/**
 * إحداثيات من نص يلصقه المستخدم: «24.71, 46.67»، أو «24.736° N, 46.835° E»، أو درجات ودقائق وثوانٍ، أو رابط خرائط Google
 * بصيغه الشائعة (@lat,lng أو q= أو ll= أو !3d…!4d…). الروابط المختصرة (maps.app.goo.gl) لا تحمل الإحداثيات فلا تُقرأ هنا.
 */
export function parseLocation(text: string): LatLng | null {
  const s = safeDecode((text ?? "").trim());
  if (!s) return null;
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination|center|daddr|sll)=(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /^\(?\s*(-?\d{1,3}\.\d+)\s*[,،\s]\s*(-?\d{1,3}\.\d+)\s*\)?$/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) return validLatLng(m[1], m[2]);
  }
  // عشري مع رمز الدرجة والاتجاه: 24.7368° N, 46.8352° E
  const dd = s.toUpperCase().match(new RegExp(`${NUM}\\s*[°º]?\\s*([NS])[\\s,،]+${NUM}\\s*[°º]?\\s*([EW])`));
  if (dd) {
    const lat = Number.parseFloat(dd[1].replace(",", ".")) * (dd[2] === "S" ? -1 : 1);
    const lng = Number.parseFloat(dd[3].replace(",", ".")) * (dd[4] === "W" ? -1 : 1);
    return validLatLng(lat, lng);
  }
  if (/[°º˚]/.test(s)) return parseDms(s);
  return null;
}

export type LocationKind = "empty" | "coordinates" | "short_link" | "map_link" | "link" | "address";

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co"];
const MAP_HOSTS = /(^|\.)google\.[a-z.]+$|^maps\.google\.|^goo\.gl$|^maps\.app\.goo\.gl$/i;

function asUrl(s: string): URL | null {
  if (!/^https?:\/\//i.test(s)) return null;
  try { return new URL(s); } catch { return null; }
}

/** رابط خرائط مختصر يحتاج فتحه (إعادة توجيه) لمعرفة الإحداثيات */
export function isShortMapsUrl(text: string): boolean {
  const u = asUrl((text ?? "").trim());
  return !!u && SHORT_HOSTS.includes(u.hostname.toLowerCase()) && (u.hostname !== "goo.gl" || u.pathname.startsWith("/maps"));
}

/** نوع ما أدخله المستخدم في حقل الموقع — للعرض والإرشاد فقط، ولا يمنع الحفظ أبدًا */
export function classifyLocation(text: string | null | undefined): LocationKind {
  const s = (text ?? "").trim();
  if (!s) return "empty";
  const u = asUrl(s);
  if (u) return isShortMapsUrl(s) ? "short_link" : MAP_HOSTS.test(u.hostname) ? (parseLocation(s) ? "coordinates" : "map_link") : "link";
  return parseLocation(s) ? "coordinates" : "address";
}

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  empty: "", coordinates: "إحداثيات", short_link: "رابط خرائط مختصر", map_link: "رابط خرائط", link: "رابط", address: "عنوان / وصف نصي",
};

export const directionsUrl = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
export const mapUrl = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const searchUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/**
 * رابط فتح الموقع في خرائط Google بحسب المتاح: الإحداثيات المحفوظة، ثم إحداثيات داخل النص، ثم الرابط كما أدخله المستخدم
 * (http/https فقط)، ثم البحث بالنص (عنوان وطني أو وصف)، ثم بالعنوان المكتوب في الفرع. null إن لم يوجد شيء.
 */
export function locationHref(site: { latitude?: number | null; longitude?: number | null; location_text?: string | null; address?: string | null; district?: string | null; city?: string | null }): string | null {
  const p = validLatLng(site.latitude, site.longitude);
  if (p) return mapUrl(p);
  const t = (site.location_text ?? "").trim();
  if (t) {
    const fromText = parseLocation(t);
    if (fromText) return mapUrl(fromText);
    const u = asUrl(t);
    if (u) return u.toString();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return searchUrl(t);
  }
  const addr = [site.address, site.district, site.city].map((x) => (x ?? "").trim()).filter(Boolean).join("، ");
  return addr ? searchUrl(addr) : null;
}

/** رابط الاتجاهات: بالإحداثيات إن وُجدت (من الحقل أو النص)، وإلا بالنص/العنوان */
export function directionsHref(site: Parameters<typeof locationHref>[0]): string | null {
  const p = validLatLng(site.latitude, site.longitude) ?? parseLocation(site.location_text ?? "");
  if (p) return directionsUrl(p);
  const t = (site.location_text ?? "").trim();
  const q = t && !asUrl(t) ? t : [site.address, site.district, site.city].map((x) => (x ?? "").trim()).filter(Boolean).join("، ");
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null;
}
