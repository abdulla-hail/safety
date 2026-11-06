import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import { card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requirePlatform } from "@/lib/auth/context";
import { getPlatformLogo } from "@/lib/platform-branding";
import PlatformLogoForm from "./PlatformLogoForm";

export const metadata: Metadata = { title: "إعدادات المنصة | عين السلامة" };

/** شعار المنصة: بصلاحية platform.branding المستقلة فقط (المالك، أو مساعد مُنحها صراحة). */
export default async function PlatformSettingsPage() {
  await requirePlatform("platform.branding");
  const current = await getPlatformLogo();
  return (
    <div className="space-y-6">
      <PageHeader title="إعدادات المنصة" crumbs={[{ label: "إدارة الشركات", href: "/platform-admin" }, { label: "إعدادات المنصة" }]}
        description="شعار «عين السلامة» يظهر في صفحة الدخول وفي واجهات المنصة ودعوات مساعد المالك. صفحات الشركات ودعواتها ومستنداتها تبقى بهوية كل شركة." />
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>شعار المنصة</h2></div>
        <div className="p-5"><PlatformLogoForm currentUrl={current} /></div>
      </section>
    </div>
  );
}
