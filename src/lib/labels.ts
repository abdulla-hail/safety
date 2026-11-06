import type { BadgeTone } from "@/components/ui/StatusBadge";

type LabelMap = Record<string, { label: string; tone: BadgeTone }>;

export const deviceStatus: LabelMap = {
  operational: { label: "سليم", tone: "success" },
  needs_maintenance: { label: "يحتاج صيانة", tone: "warning" },
  faulty: { label: "معطل", tone: "danger" },
  under_repair: { label: "تحت الإصلاح", tone: "warning" },
  out_of_service: { label: "خارج الخدمة", tone: "danger" },
  expired: { label: "منتهي الصلاحية", tone: "danger" },
  replaced: { label: "مستبدل", tone: "neutral" },
  decommissioned: { label: "مستبعد", tone: "neutral" },
};

export const visitType: Record<string, string> = {
  periodic: "دورية", emergency: "طارئة", repair: "إصلاح", reinspection: "إعادة فحص", installation: "تركيب", other: "أخرى",
};

export const visitOutcome: LabelMap = {
  completed: { label: "مكتملة", tone: "success" },
  completed_with_issues: { label: "مكتملة بملاحظات", tone: "warning" },
  incomplete: { label: "غير مكتملة", tone: "danger" },
  follow_up_required: { label: "تحتاج متابعة", tone: "warning" },
};

export const maintenanceKind: Record<string, string> = {
  periodic: "صيانة دورية", corrective: "تصحيحية / إصلاح", follow_up: "متابعة / إعادة فحص", installation: "تركيب", other: "أخرى",
};

export const faultStatus: LabelMap = {
  open: { label: "مفتوح", tone: "danger" },
  in_progress: { label: "قيد المعالجة", tone: "warning" },
  awaiting_verification: { label: "بانتظار التحقق", tone: "info" },
  closed: { label: "مغلق", tone: "success" },
  cancelled: { label: "ملغى", tone: "neutral" },
};

export const faultSeverity: LabelMap = {
  low: { label: "منخفضة", tone: "neutral" },
  medium: { label: "متوسطة", tone: "info" },
  high: { label: "عالية", tone: "warning" },
  critical: { label: "حرجة", tone: "danger" },
};

export const faultSource: Record<string, string> = {
  technician: "الفني", customer: "العميل", inspection: "نتيجة فحص", other: "أخرى",
};

export const workOrderStatus: LabelMap = {
  new: { label: "جديد", tone: "info" },
  scheduled: { label: "مجدول", tone: "info" },
  in_progress: { label: "قيد التنفيذ", tone: "warning" },
  on_hold: { label: "معلّق", tone: "neutral" },
  completed: { label: "مكتمل", tone: "success" },
  cancelled: { label: "ملغى", tone: "neutral" },
};

export const workOrderPriority: LabelMap = {
  low: { label: "منخفضة", tone: "neutral" },
  medium: { label: "متوسطة", tone: "info" },
  high: { label: "عالية", tone: "warning" },
  critical: { label: "حرجة", tone: "danger" },
};

export const workOrderType: Record<string, string> = {
  preventive: "صيانة دورية",
  corrective: "صيانة تصحيحية",
  inspection: "فحص",
  installation: "تركيب",
  emergency: "طارئ",
};

export const visitStatus: LabelMap = {
  scheduled: { label: "مجدولة", tone: "info" },
  in_progress: { label: "قيد التنفيذ", tone: "warning" },
  completed: { label: "مكتملة", tone: "success" },
  cancelled: { label: "ملغاة", tone: "neutral" },
  missed: { label: "فائتة", tone: "danger" },
};

export const maintenanceAction: Record<string, string> = {
  installation: "تركيب",
  inspection: "فحص",
  test: "اختبار",
  cleaning: "تنظيف",
  refill: "إعادة تعبئة",
  part_replacement: "استبدال قطعة",
  repair: "إصلاح",
  decommission: "استبعاد",
};

export const maintenanceResult: LabelMap = {
  pass: { label: "سليم", tone: "success" },
  pass_with_notes: { label: "سليم مع ملاحظات", tone: "warning" },
  fail: { label: "غير سليم", tone: "danger" },
};

export const customerType: Record<string, string> = {
  company: "شركة",
  government: "جهة حكومية",
  individual: "فرد",
};

export const technicianAvailability: LabelMap = {
  available: { label: "متاح", tone: "success" },
  busy: { label: "مشغول", tone: "warning" },
  on_leave: { label: "في إجازة", tone: "neutral" },
};

export const memberStatus: LabelMap = {
  active: { label: "نشط", tone: "success" },
  pending: { label: "بانتظار الاعتماد", tone: "warning" },
  suspended: { label: "موقوف", tone: "danger" },
  rejected: { label: "مرفوض", tone: "neutral" },
};

export const organizationStatus: LabelMap = {
  pending: { label: "بانتظار الموافقة", tone: "warning" },
  approved: { label: "معتمدة", tone: "success" },
  rejected: { label: "مرفوضة", tone: "neutral" },
  suspended: { label: "موقوفة", tone: "danger" },
};

/** حالات جدول companies (مطابقة لقيد companies_status_check) */
export const companyStatus: LabelMap = {
  pending: { label: "بانتظار قبول دعوة المدير", tone: "warning" },
  active: { label: "نشطة", tone: "success" },
  suspended: { label: "موقوفة", tone: "danger" },
  archived: { label: "مؤرشفة", tone: "neutral" },
};

/** أدوار جدول company_memberships */
export const companyRole: Record<string, string> = {
  company_manager: "مدير الشركة",
  supervisor: "مشرف",
  technician: "فني",
  accountant: "محاسب",
  storekeeper: "أمين مستودع",
};

export const companyMemberStatus: LabelMap = {
  active: { label: "نشط", tone: "success" },
  suspended: { label: "معطّل", tone: "warning" },
  removed: { label: "مُزال", tone: "neutral" },
};

export const companyInvitationKind: Record<string, string> = {
  member: "عضو",
  manager: "مدير الشركة",
  manager_transfer: "نقل الإدارة",
  email_change: "تغيير بريد",
};

export const companyAuditAction: Record<string, string> = {
  company_created: "إنشاء الشركة",
  company_updated: "تعديل بيانات الشركة",
  company_status: "تغيير حالة الشركة",
  company_deleted: "حذف الشركة",
  invitation_created: "إنشاء دعوة",
  invitation_revoked: "إلغاء دعوة",
  invitation_accepted: "قبول دعوة",
  member_updated: "تعديل بيانات عضو",
  member_role: "تغيير دور عضو",
  member_status: "تغيير حالة عضو",
};

export const invitationStatus: LabelMap = {
  pending: { label: "بانتظار القبول", tone: "warning" },
  accepted: { label: "مقبولة", tone: "success" },
  revoked: { label: "ملغاة", tone: "neutral" },
  expired: { label: "منتهية", tone: "neutral" },
};

export const TECHNICIAN_SPECIALTIES: Record<string, string> = {
  alarm: "أنظمة الإنذار",
  extinguishers: "طفايات الحريق",
  sprinklers: "أنظمة الرش الآلي",
  pumps: "مضخات الحريق",
  emergency_lighting: "إنارة الطوارئ",
  gas_suppression: "الإطفاء بالغاز",
  hose_reels: "الخراطيم والبكرات",
};

export const auditAction: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  archive: "أرشفة",
  restore: "استعادة",
  status_change: "تغيير حالة",
  assign: "إسناد",
  unassign: "إلغاء إسناد",
  invite: "دعوة",
  revoke_invitation: "إلغاء دعوة",
  invitation_accepted: "قبول دعوة",
  permission_change: "تغيير صلاحيات",
  member_status: "تغيير حالة عضوية",
};

export const auditEntity: Record<string, string> = {
  organization: "الشركة",
  customer: "عميل",
  technician: "فني",
  site: "موقع",
  safety_system: "نظام سلامة",
  catalog_item: "تعريف جهاز",
  device: "جهاز",
  work_order: "أمر عمل",
  visit: "زيارة",
  maintenance: "سجل صيانة",
  attachment: "مرفق",
  technician_customer: "إسناد فني لعميل",
  work_order_technician: "تعيين فني لأمر عمل",
  visit_technician: "تعيين فني لزيارة",
  work_order_device: "ربط جهاز بأمر عمل",
  member: "عضوية",
  invitation: "دعوة",
};

export function toOptions(map: Record<string, string | { label: string }>) {
  return Object.entries(map).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
}
