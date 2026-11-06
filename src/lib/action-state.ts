/** حالة نتيجة Server Action تُعاد للنموذج. */
export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** القيم المدخلة لإعادة تعبئة النموذج عند الخطأ */
  values?: Record<string, string | string[]>;
  /** يزيد مع كل محاولة لإعادة تهيئة الحقول بالقيم المحفوظة */
  attempt?: number;
  /** رابط دعوة أُنشئ للتو (يُعرض مرة واحدة فقط؛ لا يُخزَّن الرمز في قاعدة البيانات) */
  invite?: { url: string; email: string; expiresAt: string; label: string };
}

export const initialActionState: ActionState = { attempt: 0 };

export function formValues(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 || key.endsWith("[]") ? all : (all[0] ?? "");
  }
  return out;
}

export function fail(prev: ActionState, fd: FormData, message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors, values: formValues(fd), attempt: (prev.attempt ?? 0) + 1 };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function strOrNull(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

export function list(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

export function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function bool(fd: FormData, key: string): boolean {
  const v = str(fd, key);
  return v === "on" || v === "true" || v === "1";
}
