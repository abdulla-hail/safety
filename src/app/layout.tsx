
import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
