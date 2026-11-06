/** تحويل أخطاء Supabase/Postgres إلى رسائل عربية واضحة دون كشف تفاصيل داخلية. */

interface DbError {
  code?: string;
  message?: string;
}

// رسائل عربية تولّدها دوالنا في قاعدة البيانات عمدًا (آمنة للعرض)
const ARABIC = /[؀-ۿ]/;

export function dbErrorMessage(error: DbError | null | undefined, fallback = "تعذر تنفيذ العملية. حاول مرة أخرى."): string {
  if (!error) return fallback;
  switch (error.code) {
    case "23503":
    case "23001":
      return "لا يمكن الحذف لأن السجل مرتبط بسجلات أخرى (مثل الأجهزة أو الصيانة أو الزيارات). يمكنك أرشفته بدلًا من ذلك.";
    case "23505":
      return "توجد بيانات مكررة: السجل أو العلاقة موجودة مسبقًا.";
    case "23514":
    case "22023":
    case "P0001":
    case "P0002":
    case "40001":
      return error.message && ARABIC.test(error.message) ? error.message : "البيانات المدخلة غير صالحة.";
    case "42501":
      return error.message && ARABIC.test(error.message) ? error.message : "ليست لديك صلاحية لتنفيذ هذه العملية.";
    case "22P02":
      return "قيمة غير صالحة في أحد الحقول.";
    case "PGRST116":
      return "السجل غير موجود أو لا تملك صلاحية الوصول إليه.";
    case "57014":
    case "55P03":
      return "قاعدة البيانات مشغولة مؤقتًا ولم تكتمل العملية؛ لم يُحفظ شيء. أعد المحاولة بعد لحظات.";
    case "PGRST204":
    case "PGRST200":
    case "42703":
      // عمود أو علاقة غير موجودة: الكود يسبق ترحيلًا لم يُطبَّق
      console.error("db schema mismatch:", error.code, error.message);
      return "تعذر الحفظ لأن قاعدة البيانات لا تدعم أحد الحقول المرسلة بعد. أبلغ مدير المنصة.";
    default:
      // السبب الداخلي في سجل الخادم فقط (الرمز والرسالة دون بيانات المستخدم) لتشخيص الرسالة العامة
      console.error("db error:", error.code ?? "unknown", error.message ?? "");
      return fallback;
  }
}

/**
 * فشل تحميل بيانات صفحة: يُسجَّل السبب الحقيقي في سجل الخادم (الرمز والرسالة والتفاصيل والتلميح من PostgREST،
 * دون بيانات المستخدم)، ويُعاد نص قصير بالرمز يُعرض بجانب رسالة التعذر لتسهيل التشخيص.
 */
export function logLoadError(scope: string, error: (DbError & { details?: string | null; hint?: string | null }) | null | undefined): string {
  if (!error) return "";
  console.error(`load failed [${scope}]:`, error.code ?? "unknown", error.message ?? "", error.details ?? "", error.hint ?? "");
  return error.code ? ` (الرمز ${error.code})` : "";
}

export function isRelationError(error: DbError | null | undefined) {
  return error?.code === "23503" || error?.code === "23001";
}
