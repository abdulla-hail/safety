import { createClient } from "@/lib/supabase/server";
import { hasPhase5 } from "@/lib/schema";
import { Suspense, type ReactNode } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import type { NavItem } from "@/components/layout/Sidebar";
import Flash from "@/components/ui/Flash";
import { requireUser, isUsable } from "@/lib/auth/context";
import { JOB_ROLE_LABELS } from "@/lib/permissions";

export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AppFrame>{children}</AppFrame>
    </Suspense>
  );
}

function ShellFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">
      جارٍ التحميل...
    </div>
  );
}

async function AppFrame({ children }: { children: ReactNode }) {
  // طلب واحد لقاعدة البيانات لكل صفحة (get_my_context)؛ الشعار يُحمَّل لاحقًا من المتصفح دون حجب العرض
  const [ctx, phase5] = await Promise.all([requireUser(), createClient().then(hasPhase5)]);
  const m = ctx.active;
  const can = (p: string) => ctx.permissions.has(p);
  const any = (...ps: string[]) => ps.some(can);
  const field = can("field.assigned");

  const items: NavItem[] = [];
  if (m) {
    items.push({ label: "لوحة التحكم", icon: "dashboard", href: "/dashboard" });
    // «عملي» القسم الرئيسي للعمل الميداني (الزيارات الدورية والطارئة والمسودات والبلاغات والمتابعات والسجل)؛
    // للفني الميداني لا تتكرر الزيارات والصيانة والبلاغات وأوامر العمل كأقسام مستقلة لأنها داخل «عملي» (الروابط المباشرة تبقى تعمل)
    if (field || any("visits.create")) items.push({ label: "عملي", icon: "clock", href: "/my-work" });
    const fieldOnly = field && !any("visits.view", "maintenance.view", "work_orders.view", "faults.view");
    if (any("customers.view") || field) items.push({ label: "العملاء", icon: "building", href: "/customers", section: "العمليات" });
    if (any("sites.view") || field) items.push({ label: "المواقع والفروع", icon: "mapPin", href: "/sites", section: "العمليات" });
    if (any("devices.view") || field) items.push({ label: "الأجهزة", icon: "shield", href: "/devices", section: "العمليات" });
    if (!fieldOnly && any("work_orders.view", "work_orders.create")) items.push({ label: "أوامر العمل", icon: "clipboard", href: "/work-orders", section: "العمليات" });
    if (!fieldOnly && any("visits.view", "visits.create")) items.push({ label: "الزيارات", icon: "calendar", href: "/visits", section: "العمليات" });
    if (!fieldOnly && any("maintenance.view")) items.push({ label: "سجلات الصيانة", icon: "wrench", href: "/maintenance", section: "العمليات" });
    if (phase5 && !fieldOnly && any("faults.view", "faults.create", "faults.update")) items.push({ label: "البلاغات والأعطال", icon: "shieldAlert", href: "/faults", section: "العمليات" });
    // الفنيون يُضافون ويُدارون من «فريق الشركة والدعوات»؛ يبقى الإسناد التشغيلي هنا
    if (any("assignments.manage")) items.push({ label: "إسناد الفنيين", icon: "link", href: "/assignments", section: "الفريق" });
    if (any("catalog.view", "catalog.manage")) items.push({ label: "كتالوج أجهزة السلامة", icon: "book", href: "/catalog", section: "الفريق" });
    if (any("reports.view")) items.push({ label: "التقارير", icon: "chart", href: "/reports", section: "التقارير" });
    if (any("settings.branding")) items.push({ label: "هوية الشركة", icon: "settings", href: "/settings/company", section: "الإدارة" });
    if (m.is_owner) items.push({ label: "سجل التدقيق", icon: "history", href: "/settings/audit", section: "الإدارة" });
    // إدارة أعضاء الشركة ودعواتهم (على جداول company_memberships / company_invitations) لمدير الشركة
    if (m.is_owner) items.push({ label: "فريق الشركة والدعوات", icon: "userCog", href: "/team", section: "الإدارة" });
  }
  items.push({ label: "الإشعارات", icon: "bell", href: "/notifications", section: m ? "الإدارة" : "" });
  if (ctx.platformPermissions.has("platform.companies.view")) items.push({ label: "إدارة الشركات (المنصة)", icon: "building", href: "/platform-admin", section: "المنصة" });
  if (ctx.platformRole === "owner") items.push({ label: "مساعدو المالك", icon: "userCog", href: "/platform-admin/assistants", section: "المنصة" });
  if (ctx.platformPermissions.has("platform.branding")) items.push({ label: "إعدادات المنصة", icon: "settings", href: "/platform-admin/settings", section: "المنصة" });
  if (!m && !ctx.platformRole) items.push({ label: "العضوية", icon: "users", href: "/onboarding" });

  // داخل شركة: شعارها (هويتها الخاصة)؛ خارجها (المالك والمساعد ومن بلا عضوية): شعار المنصة
  const logoUrl = m ? (m.logo_path ? `/company-logo?v=${encodeURIComponent(m.logo_path)}` : null) : ctx.platformLogoUrl;

  const roleName = m
    ? m.is_owner ? "مدير الشركة" : m.job_roles.map((r) => JOB_ROLE_LABELS[r] ?? r).join("، ") || "عضو"
    : ctx.platformRole === "owner" ? "مالك المنصة" : ctx.platformRole === "assistant" ? "مساعد المالك" : "بانتظار العضوية";

  return (
    <DashboardShell
      tenantName={m?.organization_name ?? (ctx.platformRole ? "إدارة المنصة" : "عين السلامة")}
      userName={ctx.user.name}
      roleName={roleName}
      avatarUrl={ctx.user.avatarUrl}
      logoUrl={logoUrl}
      primaryColor={m?.primary_color ?? null}
      navItems={items}
      unreadCount={ctx.unreadNotifications}
      orgs={ctx.memberships.filter(isUsable).map((x) => ({ id: x.organization_id, name: x.organization_name }))}
      activeOrgId={m?.organization_id ?? null}
      canSearch={!!m && (can("devices.view") || field)}
    >
      {children}
      <Flash />
    </DashboardShell>
  );
}
