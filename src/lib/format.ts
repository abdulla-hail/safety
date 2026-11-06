/** تنسيق التواريخ بالتقويم الميلادي وأرقام لاتينية وتوقيت الرياض. */

const TZ = "Asia/Riyadh";

const dateFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: TZ, year: "numeric", month: "short", day: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: TZ, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // تاريخ بلا وقت يُعامل كيوم محلي
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+03:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** قيمة input[type=datetime-local] بتوقيت الرياض */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** من input[type=datetime-local] (توقيت الرياض) إلى ISO */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00+03:00`).toISOString();
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** فترة الصيانة: بالأشهر للأجهزة الجديدة، وبالأيام للأجهزة القديمة التي لم تُحوَّل */
export function intervalLabel(months: number | null | undefined, days: number | null | undefined): string {
  if (months) return months === 1 ? "كل شهر" : months === 2 ? "كل شهرين" : months <= 10 ? `كل ${months} أشهر` : `كل ${months} شهرًا`;
  if (days) return `كل ${days} يوم`;
  return "—";
}

/** حالة الاستحقاق (مطابقة لـ maintenance_due_status في القاعدة) */
export function dueStatus(next: string | null | undefined, alertDays = 14): "none" | "overdue" | "due" | "due_soon" | "upcoming" {
  const d = daysUntil(next);
  if (d === null) return "none";
  return d < 0 ? "overdue" : d === 0 ? "due" : d <= alertDays ? "due_soon" : "upcoming";
}
