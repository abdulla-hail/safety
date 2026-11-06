import type { FieldDef } from "@/components/ui/EntityForm";
import { TECHNICIAN_SPECIALTIES, technicianAvailability, toOptions } from "@/lib/labels";

export function technicianFields(members: { value: string; label: string }[]): FieldDef[] {
  return [
    { name: "full_name", label: "اسم الفني", required: true, wide: true },
    { name: "phone", label: "الجوال", type: "tel", dir: "ltr" },
    { name: "email", label: "البريد الإلكتروني", type: "email", dir: "ltr" },
    { name: "job_title", label: "المسمى الوظيفي" },
    { name: "hire_date", label: "تاريخ التعيين", type: "date" },
    { name: "availability", label: "التوفر", type: "select", required: true, options: toOptions(technicianAvailability) },
    { name: "is_active", label: "الحالة", type: "select", required: true, options: [{ value: "true", label: "نشط" }, { value: "false", label: "غير نشط" }] },
    { name: "user_id", label: "حساب الدخول المرتبط", type: "select", options: members,
      help: "اربط الفني بعضو في الشركة ليستلم إشعارات الإسناد ويرى مهامه." },
    { name: "specialties", label: "التخصصات", type: "checkboxes", options: toOptions(TECHNICIAN_SPECIALTIES) },
    { name: "notes", label: "ملاحظات", type: "textarea" },
  ];
}
