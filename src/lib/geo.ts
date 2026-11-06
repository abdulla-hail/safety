/** أدوات المواقع الجغرافية للفروع (بلا اعتماديات، تُختبر مباشرة) */
export interface LatLng { lat: number; lng: number }

export const DEFAULT_CENTER: LatLng = { lat: 24.7136, lng: 46.6753 }; // الرياض

export function validLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = typeof lat === "string" ? Number.parseFloat(lat) : typeof lat === "number" ? lat : NaN;
  const b = typeof lng === "string" ? Number.parseFloat(lng) : typeof lng === "number" ? lng : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

/**
 * إحداثيات من نص يلصقه المستخدم: «24.71, 46.67»، أو رابط خرائط Google بصيغه الشائعة (@lat,lng أو q= أو ll= أو !3d…!4d…).
 * الروابط المختصرة (maps.app.goo.gl) لا تحمل الإحداثيات فلا تُقرأ.
 */
export function parseLocation(text: string): LatLng | null {
  const s = decodeURIComponent(text.trim());
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)$/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) return validLatLng(m[1], m[2]);
  }
  return null;
}

export const directionsUrl = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
export const mapUrl = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
