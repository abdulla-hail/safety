import type { FieldDef } from "@/components/ui/EntityForm";
import { customerType, toOptions } from "@/lib/labels";

export const customerFields: FieldDef[] = [
  { name: "name", label: "اسم العميل", required: true, wide: true, maxLength: 200 },
  { name: "customer_type", label: "نوع العميل", type: "select", required: true, options: toOptions(customerType) },
  { name: "is_active", label: "الحالة", type: "select", required: true, options: [{ value: "true", label: "نشط" }, { value: "false", label: "غير نشط" }] },
  { name: "contact_name", label: "اسم جهة الاتصال" },
  { name: "phone", label: "رقم الهاتف", type: "tel", dir: "ltr" },
  { name: "email", label: "البريد الإلكتروني", type: "email", dir: "ltr" },
  { name: "city", label: "المدينة" },
  { name: "address", label: "العنوان", wide: true },
  { name: "commercial_registration", label: "السجل التجاري", dir: "ltr" },
  { name: "vat_number", label: "الرقم الضريبي", dir: "ltr" },
  { name: "notes", label: "ملاحظات", type: "textarea" },
];

export const siteFields: FieldDef[] = [
  { name: "name", label: "اسم الموقع / الفرع", required: true, wide: true },
  { name: "city", label: "المدينة" },
  { name: "district", label: "الحي" },
  { name: "address", label: "العنوان", wide: true },
  { name: "contact_name", label: "مسؤول الموقع" },
  { name: "contact_phone", label: "هاتف المسؤول", type: "tel", dir: "ltr" },
  { name: "notes", label: "ملاحظات", type: "textarea" },
];
