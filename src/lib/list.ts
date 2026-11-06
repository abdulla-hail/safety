/** أدوات القوائم: قراءة معايير البحث والتصفية والترتيب وترقيم الصفحات من الرابط. */

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 20;

export function param(sp: SearchParams, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function params(sp: SearchParams, key: string): string[] {
  const v = sp[key];
  return (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

export function pageOf(sp: SearchParams): number {
  const n = Number.parseInt(param(sp, "page"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function rangeOf(page: number, size = PAGE_SIZE): [number, number] {
  const from = (page - 1) * size;
  return [from, from + size - 1];
}

/** إزالة الأحرف التي تكسر صيغة فلاتر PostgREST */
export function cleanSearch(q: string): string {
  return q.replace(/[,()%*\\"':]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** شرط بحث ilike على عدة أعمدة بصيغة or() */
export function orIlike(columns: string[], q: string): string | null {
  const term = cleanSearch(q);
  if (!term) return null;
  return columns.map((c) => `${c}.ilike.*${term}*`).join(",");
}

export function sortOf<T extends string>(sp: SearchParams, allowed: readonly T[], fallback: T) {
  const s = param(sp, "sort") as T;
  const dir = param(sp, "dir") === "asc";
  return { column: allowed.includes(s) ? s : fallback, ascending: dir };
}

export const ARCHIVE_SCOPES = ["active", "archived", "all"] as const;
export type ArchiveScope = (typeof ARCHIVE_SCOPES)[number];

export function archiveScope(sp: SearchParams): ArchiveScope {
  const v = param(sp, "archived");
  return v === "archived" || v === "all" ? v : "active";
}

/** يبني رابطًا يحافظ على المعايير الحالية مع تعديل بعضها */
export function withParams(base: string, sp: SearchParams, changes: Record<string, string | number | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
  }
  for (const [k, v] of Object.entries(changes)) {
    u.delete(k);
    if (v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
