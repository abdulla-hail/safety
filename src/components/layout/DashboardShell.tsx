"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar, { type NavItem } from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

interface DashboardShellProps {
  tenantName: string;
  userName: string;
  roleName: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  navItems: NavItem[];
  unreadCount: number;
  userId: string | null;
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
  canSearch: boolean;
  children: ReactNode;
}

export default function DashboardShell({
  tenantName, userName, roleName, avatarUrl, logoUrl, primaryColor, navItems, unreadCount, userId, orgs, activeOrgId, canSearch, children,
}: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const pathname = usePathname();
  // لون الشركة لهويتها فقط (القائمة الجانبية)؛ الأزرار والعناصر التفاعلية بلون المنصة الموحد
  const style = primaryColor ? ({ "--company": primaryColor } as CSSProperties) : undefined;

  return (
    <div className="min-h-screen" style={style}>
      <Sidebar open={menuOpen} onClose={closeMenu} tenantName={tenantName} logoUrl={logoUrl} items={navItems} />
      <div className="flex min-h-screen flex-col lg:ms-64 print:ms-0">
        <Topbar tenantName={tenantName} userName={userName} roleName={roleName} avatarUrl={avatarUrl}
                unreadCount={unreadCount} userId={userId} orgs={orgs} activeOrgId={activeOrgId} canSearch={canSearch}
                onMenuClick={() => setMenuOpen(true)} />
        {/* المفتاح بالمسار: يُعاد الظهور التدريجي عند الانتقال لصفحة أخرى فقط، لا عند الفلترة أو الحفظ */}
        <main key={pathname} className="page-enter flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
