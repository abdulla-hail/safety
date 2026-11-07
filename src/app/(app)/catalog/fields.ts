import type { FieldDef } from "@/components/ui/EntityForm";

const active = { name: "is_active", label: "حالة التفعيل", type: "select" as const, required: true,
  options: [{ value: "true", label: "مفعّل" }, { value: "false", label: "معطّل (لا يظهر عند تسجيل أجهزة جديدة)" }] };

export const systemFields: FieldDef[] = [
  { name: "name", label: "اسم النظام", required: true, wide: true, placeholder: "مثال: أنظمة الإنذار" },
  { name: "default_interval_days", label: "دورة الصيانة الافتراضية (يوم)", type: "number", min: 1, max: 3650 },
  { name: "sort_order", label: "ترتيب العرض", type: "number", min: 0 },
  active,
  { name: "description", label: "الوصف", type: "textarea" },
];

export const itemFields: FieldDef[] = [
  { name: "name", label: "اسم الجهاز / الموديل", required: true, wide: true, placeholder: "مثال: كاشف دخان بصري" },
  { name: "manufacturer", label: "الشركة المصنعة" },
  { name: "model", label: "الموديل", dir: "ltr" },
  { name: "device_type", label: "النوع", placeholder: "مثال: بودرة / CO2 / بصري / حراري" },
  { name: "default_interval_days", label: "دورة الصيانة (يوم)", type: "number", min: 1, max: 3650, help: "تُستخدم لحساب موعد الصيانة القادمة للأجهزة الجديدة." },
  active,
  { name: "description", label: "الوصف", type: "textarea" },
  { name: "specs", label: "الخصائص الفنية", type: "textarea", help: "سطر لكل خاصية بصيغة «الخاصية: القيمة»، مثل: السعة: 6 كجم" },
];

/** حقل «الشركة المصنعة» يقترح ماركات الكتالوج (ويقبل أي قيمة أخرى) */
export const withBrandSuggestions = (fields: FieldDef[], brands: string[]): FieldDef[] =>
  fields.map((x) => (x.name === "manufacturer" ? { ...x, suggestions: brands, help: brands.length ? "اختر من ماركات الكتالوج أو اكتب اسمًا آخر." : x.help } : x));
