import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** رابط مؤقت لملف في حاوية خاصة؛ يخضع لسياسات التخزين للمستخدم الحالي. */
export async function signedUrl(supabase: SupabaseClient, bucket: string, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

/**
 * روابط موقّعة لعدة ملفات في طلب واحد (للطباعة والتقارير): المتصفح يحمّل الصور مباشرة دون تحويل لكل صورة،
 * فلا تفشل الصور عند طباعة تقرير بصور كثيرة. ما يتعذر توقيعه يُرجع null (يُعرض بديله /files/[id]).
 */
export async function signedUrls(supabase: SupabaseClient, bucket: string, paths: string[], seconds = 3600): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, seconds);
  if (error || !data) return new Map();
  return new Map(data.filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string]));
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function safeFileName(name: string) {
  const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "bin").toLowerCase();
  const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
  return `${base}.${ext}`;
}
