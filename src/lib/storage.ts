import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** رابط مؤقت لملف في حاوية خاصة؛ يخضع لسياسات التخزين للمستخدم الحالي. */
export async function signedUrl(supabase: SupabaseClient, bucket: string, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function safeFileName(name: string) {
  const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "bin").toLowerCase();
  const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
  return `${base}.${ext}`;
}
