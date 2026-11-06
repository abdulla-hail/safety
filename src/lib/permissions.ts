/**
 * كتالوج الصلاحيات التفصيلية (مطابق لجدول permission_definitions في قاعدة البيانات cgwn).
 * إدارة الأعضاء والدعوات ليست صلاحية قابلة للمنح: هي لمدير الشركة فقط (تفرضها دوال قاعدة البيانات).
 * الواجهة تستخدمه لإظهار/إخفاء العناصر فقط؛ التحقق الفعلي في الخادم وRLS.
 */

export const PERMISSION_MODULES = [
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

/** أدوار وظيفية وصفية: تُستخدم كقوالب جاهزة لاختيار الصلاحيات، ولا تمنح صلاحية بذاتها. */
export const JOB_ROLES = [
  { key: "manager", label: "مدير الشركة" },
  { key: "supervisor", label: "مشرف" },
  { key: "technician", label: "فني" },
  { key: "accountant", label: "محاسب" },
  { key: "storekeeper", label: "أمين مستودع" },
  { key: "viewer", label: "مستخدم اطلاع" },
] as const;

export const JOB_ROLE_LABELS: Record<string, string> = Object.fromEntries(JOB_ROLES.map((r) => [r.key, r.label]));

const VIEW_ALL: Permission[] = [
  "customers.view", "sites.view", "technicians.view", "catalog.view", "devices.view",
  "visits.view", "maintenance.view",
];

export const ROLE_PRESETS: Record<string, Permission[]> = {
  manager: ALL_PERMISSIONS.filter((p) => p !== "field.assigned"),
  supervisor: [
    ...VIEW_ALL,
    "customers.create", "customers.update", "sites.create", "sites.update",
    "assignments.manage", "devices.create", "devices.update", "devices.print",
    "visits.create", "visits.update", "maintenance.create",
    "faults.view", "faults.create", "faults.update", "visits.close_exception", "maintenance.reschedule", "quotes.view", "quotes.manage",
    "reports.view", "reports.print", "reports.export",
  ],
  technician: ["field.assigned", "catalog.view", "maintenance.create", "devices.print", "visits.update", "faults.create"],
  accountant: [...VIEW_ALL, "faults.view", "quotes.view", "reports.view", "reports.export", "reports.print"],
  storekeeper: ["catalog.view", "catalog.manage", "devices.view", "reports.view"],
  viewer: [...VIEW_ALL, "reports.view"],
};
