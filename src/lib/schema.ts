import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * كشف الترحيلات المقترحة غير المطبّقة بعد، حتى لا ترسل الواجهة أعمدة أو إجراءات غير موجودة (كان ذلك يُفشل تسجيل الجهاز
 * والصيانة برسالة عامة). بعد تطبيق الترحيل تتفعل الحقول والشاشات الجديدة تلقائيًا خلال دقيقة دون تعديل الكود.
 * فشل الفحص لأسباب أخرى (شبكة) لا يغيّر آخر نتيجة معروفة.
 * الأداء: نتيجة «مطبّق» نهائية طوال عمر الخادم (الترحيلات لا تُلغى أثناء التشغيل؛ إعادة تشغيل الخادم بعد أي تراجع)،
 * وإلا كان كل فحص طلبًا متتابعًا إضافيًا (~350 مللي ثانية) قبل بيانات الصفحة كل دقيقة. «غير مطبّق» يُعاد فحصه كل دقيقة.
 */
const TTL_MS = 60_000;
const known = new Map<string, { at: number; value: boolean }>();
const fresh = (k: { at: number; value: boolean } | undefined) => !!k && (k.value || Date.now() - k.at < TTL_MS);

async function tableExists(supabase: SupabaseClient, table: string): Promise<boolean> {
  const k = known.get(table);
  if (fresh(k)) return k!.value;
  // طلب GET بلا صفوف (limit 0) لا HEAD: خادم PostgREST الحالي يعيد 204 بلا خطأ لطلب HEAD على جدول غير موجود،
  // فكان الكشف يعتبر الترحيل مطبّقًا ويطلب أعمدة غير موجودة («تعذر تحميل الزيارات/البلاغات/السجل»)
  const { error, status } = await supabase.from(table).select("id").limit(0);
  if (!error && status >= 200 && status < 300) known.set(table, { at: Date.now(), value: true });
  else if (error?.code === "PGRST205" || error?.code === "42P01") known.set(table, { at: Date.now(), value: false });
  else console.error(`schema check for ${table} failed:`, status, error?.code ?? "", error?.message ?? "");
  return known.get(table)?.value ?? false;
}

/** م5 (20261105000100): البلاغات، قراءات الفحص، صور قبل/بعد، نوع الزيارة ونتيجتها */
export function hasPhase5(supabase: SupabaseClient): Promise<boolean> {
  return tableExists(supabase, "device_faults");
}

/** م5ج (20261108000100): تنفيذ أوامر العمل، تقرير الزيارة، بلاغات أثناء الزيارة، تصنيف الصور وحذفها */
export async function hasWorkOrderExecution(supabase: SupabaseClient): Promise<boolean> {
  const k = known.get("wo-exec");
  if (fresh(k)) return k!.value;
  const { error, status } = await supabase.from("visits").select("technician_notes").limit(0);
  if (!error && status >= 200 && status < 300) known.set("wo-exec", { at: Date.now(), value: true });
  else if (error?.code === "42703" || error?.code === "PGRST204") known.set("wo-exec", { at: Date.now(), value: false });
  else console.error("schema check for work-order execution failed:", status, error?.code ?? "", error?.message ?? "");
  return known.get("wo-exec")?.value ?? false;
}

/** م5ب (20261106000100): تنفيذ الزيارة جهازًا جهازًا، المسودات، الإغلاق والاستثناء، سجل تغيير المواعيد */
export function hasInspections(supabase: SupabaseClient): Promise<boolean> {
  return tableExists(supabase, "visit_devices");
}

/** م8 (20261112000100): نص موقع الفرع كما أدخله المستخدم (customer_sites.location_text) */
export async function hasLocationText(supabase: SupabaseClient): Promise<boolean> {
  const k = known.get("site-location-text");
  if (fresh(k)) return k!.value;
  const { error, status } = await supabase.from("customer_sites").select("location_text").limit(0);
  if (!error && status >= 200 && status < 300) known.set("site-location-text", { at: Date.now(), value: true });
  else if (error?.code === "42703" || error?.code === "PGRST204") known.set("site-location-text", { at: Date.now(), value: false });
  else console.error("schema check for site location text failed:", status, error?.code ?? "", error?.message ?? "");
  return known.get("site-location-text")?.value ?? false;
}

/** أعمدة الفرع مع نص الموقع إن كان الترحيل مطبّقًا */
export const withLocationText = (cols: string, has: boolean) => (has ? `${cols}, location_text` : cols);
