/** صلاحيات إدارة المنصة (منفصلة تمامًا عن صلاحيات الشركات). المرجع: جدول platform_permission_definitions. */
export const PLATFORM_PERMISSIONS = [
  "platform.companies.view", "platform.companies.create", "platform.companies.update",
  "platform.companies.status", "platform.companies.invitations", "platform.companies.delete", "platform.branding",
] as const;

export const PLATFORM_PERMISSION_LABELS: Record<(typeof PLATFORM_PERMISSIONS)[number], string> = {
  "platform.companies.view": "عرض الشركات وأعضائها ودعواتها وسجل تدقيقها",
  "platform.companies.create": "تسجيل شركة جديدة ودعوة مديرها",
  "platform.companies.update": "تعديل بيانات الشركات",
  "platform.companies.status": "تفعيل الشركات وإيقافها وأرشفتها",
  "platform.companies.invitations": "دعوات مديري الشركات ونقل الإدارة",
  "platform.companies.delete": "حذف الشركات المؤرشفة نهائيًا",
  "platform.branding": "تغيير شعار المنصة (صلاحية مستقلة)",
};

export const assistantInvitationStatus: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "بانتظار القبول", tone: "warning" },
  accepted: { label: "مقبولة", tone: "success" },
  revoked: { label: "ملغاة", tone: "danger" },
  expired: { label: "منتهية", tone: "neutral" },
};

export const assistantStatus: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "نشط", tone: "success" },
  suspended: { label: "معطّل", tone: "warning" },
  revoked: { label: "ملغى", tone: "danger" },
};

export const assistantRequestStatus: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "قيد المراجعة", tone: "warning" },
  approved: { label: "مقبول", tone: "success" },
  rejected: { label: "مرفوض", tone: "danger" },
  cancelled: { label: "ملغى", tone: "neutral" },
};
