/**
 * كتالوج الصلاحيات التفصيلية (مطابق لجدول permission_definitions في قاعدة البيانات cgwn).
 * الدوران: مدير (company_manager) وفني (technician). المدير الأساسي يملك كل الصلاحيات دائمًا؛ المديرون الآخرون كل الصلاحيات
 * افتراضيًا أو ما يحدده لهم المدير الأساسي. إدارة الفريق صلاحية team.manage (للمديرين)، وإدارة المديرين للمدير الأساسي وحده.
 * صلاحيات الإدارة (MANAGEMENT_PERMISSIONS) لا تُحسب للفني أبدًا (تفرضها قاعدة البيانات).
 * الواجهة تستخدمه لإظهار/إخفاء العناصر فقط؛ التحقق الفعلي في الخادم وRLS.
 */

export const PERMISSION_MODULES = [
  { key: "team", label: "الفريق والدعوات" },
  { key: "customers", label: "العملاء" },
  { key: "sites", label: "مواقع العملاء" },
  { key: "technicians", label: "الفنيون" },
  { key: "assignments", label: "الإسناد" },
  { key: "field", label: "العمل الميداني" },
  { key: "catalog", label: "كتالوج أجهزة السلامة" },
  { key: "devices", label: "الأجهزة" },
  { key: "visits", label: "الزيارات والمعاينات" },
  { key: "quotes", label: "عروض الأسعار" },
  { key: "maintenance", label: "الصيانة" },
  { key: "faults", label: "البلاغات والأعطال" },
  { key: "reports", label: "التقارير" },
  { key: "settings", label: "هوية الشركة" },
  { key: "audit", label: "سجل التدقيق" },
] as const;

export const PERMISSIONS = [
  ["team.manage", "إدارة الفريق والدعوات (الفنيون)"],
  ["customers.view", "عرض جميع العملاء"],
  ["customers.create", "إضافة عميل"],
  ["customers.update", "تعديل عميل"],
  ["customers.archive", "أرشفة واستعادة العملاء"],
  ["customers.delete", "حذف عميل نهائيًا"],
  ["sites.view", "عرض جميع المواقع"],
  ["sites.create", "إضافة موقع"],
  ["sites.update", "تعديل موقع"],
  ["sites.archive", "أرشفة واستعادة المواقع"],
  ["sites.delete", "حذف موقع نهائيًا"],
  ["technicians.view", "عرض الفنيين"],
  ["technicians.create", "إضافة فني"],
  ["technicians.update", "تعديل فني"],
  ["technicians.archive", "أرشفة واستعادة الفنيين"],
  ["technicians.delete", "حذف فني نهائيًا"],
  ["assignments.manage", "إسناد الفنيين والعملاء"],
  ["field.assigned", "عرض بيانات العملاء المسندين إليّ فقط"],
  ["catalog.view", "عرض كتالوج أجهزة السلامة"],
  ["catalog.manage", "إدارة كتالوج أجهزة السلامة"],
  ["catalog.archive", "أرشفة واستعادة عناصر الكتالوج"],
  ["catalog.delete", "حذف عناصر الكتالوج نهائيًا"],
  ["devices.view", "عرض جميع الأجهزة"],
  ["devices.create", "تسجيل جهاز"],
  ["devices.update", "تعديل جهاز"],
  ["devices.archive", "أرشفة واستعادة الأجهزة"],
  ["devices.delete", "حذف جهاز نهائيًا"],
  ["devices.print", "طباعة ملصقات الأجهزة"],
  ["devices.transfer", "نقل جهاز إلى عميل آخر"],
  ["visits.view", "عرض جميع الزيارات"],
  ["visits.create", "جدولة زيارة"],
  ["visits.update", "تعديل زيارة وحالتها"],
  ["visits.archive", "أرشفة واستعادة الزيارات"],
  ["visits.delete", "حذف زيارة نهائيًا"],
  ["visits.close_exception", "إغلاق زيارة غير مكتملة باستثناء موثق"],
  ["maintenance.view", "عرض جميع سجلات الصيانة"],
  ["maintenance.create", "تسجيل عملية صيانة"],
  ["maintenance.correct", "تصحيح سجل صيانة معتمد (بسبب موثق)"],
  ["maintenance.reschedule", "تعديل موعد الصيانة القادمة يدويًا بسبب موثق"],
  ["faults.view", "عرض جميع البلاغات والأعطال"],
  ["faults.create", "تسجيل بلاغ عطل"],
  ["faults.update", "إدارة البلاغات وإغلاقها"],
  ["quotes.view", "عرض عروض الأسعار"],
  ["quotes.manage", "إنشاء عروض الأسعار وتعديلها وإرسالها"],
  ["quotes.create", "إنشاء عروض أسعار ضمن النطاق وإرسالها للمراجعة"],
  ["reports.view", "الاطلاع على التقارير"],
  ["reports.export", "تصدير التقارير"],
  ["reports.print", "طباعة التقارير والمستندات"],
  ["settings.branding", "إدارة الهوية البصرية وبيانات التقارير"],
  ["audit.view", "الاطلاع على سجل التدقيق"],
] as const;

export type Permission = (typeof PERMISSIONS)[number][0];

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(PERMISSIONS);

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map(([k]) => k);

/** available: مفاتيح permission_definitions في القاعدة الحالية؛ صلاحيات ترحيل لم يُطبَّق بعد لا تُعرض (كانت تُرفض عند الحفظ) */
export function permissionsByModule(available?: readonly string[]) {
  const ok = (k: string) => !available || available.includes(k);
  return PERMISSION_MODULES.map((m) => ({
    ...m,
    permissions: PERMISSIONS.filter(([k]) => k.startsWith(`${m.key}.`) && ok(k)).map(([key, label]) => ({ key, label })),
  }));
}

/** صلاحيات إدارة الشركة والفريق: للمديرين فقط، ولا تظهر في صلاحيات الفني */
export const MANAGEMENT_PERMISSIONS: readonly string[] = ["team.manage", "settings.branding", "audit.view"];

/** الدوران الوحيدان في الشركة */
export const JOB_ROLES = [
  { key: "manager", label: "مدير" },
  { key: "technician", label: "فني" },
] as const;

/** تسميات للعرض؛ أدوار قديمة (إن وُجدت في سجلات سابقة) تظهر بتسمية عامة دون أن تكون خيارًا */
export const JOB_ROLE_LABELS: Record<string, string> = { manager: "مدير", technician: "فني", supervisor: "عضو", accountant: "عضو", storekeeper: "عضو", viewer: "عضو" };

/** القالب الافتراضي لكل دور (المرجع الفعلي في قاعدة البيانات: company_effective_permissions) */
export const ROLE_PRESETS: Record<string, Permission[]> = {
  manager: ALL_PERMISSIONS.filter((p) => p !== "field.assigned"),
  technician: ["field.assigned", "catalog.view", "maintenance.create", "devices.print", "visits.update", "faults.create", "quotes.create"],
};
