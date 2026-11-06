
import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import PwaRegister from "@/components/pwa/PwaRegister";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "منصة إدارة صيانة أجهزة السلامة",
  description:
    "نظام لإدارة شركات صيانة أجهزة السلامة ومكافحة الحريق والعملاء والأجهزة والعقود والزيارات والفنيين.",
  // التطبيق المثبّت (PWA): البيان والأيقونات تُولَّد لكل مستخدم بهوية شركته النشطة (/app-manifest، /app-icon/[size])
  appleWebApp: { capable: true, title: "عين السلامة", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#1e3a5f" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <head>
        {/* البيان يُجلب بملفات تعريف الارتباط ليحمل اسم شركة المستخدم وشعارها */}
        <link rel="manifest" href="/app-manifest" crossOrigin="use-credentials" />
        <link rel="apple-touch-icon" href="/app-icon/180" />
      </head>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
