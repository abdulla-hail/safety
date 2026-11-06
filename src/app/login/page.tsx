import type { Metadata } from "next";
import { Suspense } from "react";
import PlatformMark from "@/components/PlatformMark";
import { getPlatformLogo } from "@/lib/platform-branding";
import GoogleSignIn from "./GoogleSignIn";

export const metadata: Metadata = { title: "تسجيل الدخول | عين السلامة" };

async function Logo() {
  return <PlatformMark logoUrl={await getPlatformLogo()} className="mb-4 size-16" />;
}

export default function LoginPage() {
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-4 py-10">
      <section className="pop-enter w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9 relative">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand" aria-hidden="true" />
        <div className="mb-8 text-center">
          <Suspense fallback={<PlatformMark logoUrl={null} className="mb-4 size-16" />}>
            <Logo />
          </Suspense>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">عين السلامة</h1>
          <p className="mt-2 text-sm text-slate-500">منصة إدارة شركات صيانة أجهزة السلامة</p>
        </div>
        <Suspense fallback={<div className="h-12 rounded-lg bg-slate-100" />}>
          <GoogleSignIn />
        </Suspense>
        <p className="mt-6 text-center text-xs leading-6 text-slate-500">
          الدخول متاح فقط بحساب Google. لا يمنح تسجيل الدخول وحده أي وصول لبيانات الشركات؛
          يجب أن تكون مدعوًا أو أن يعتمد مدير الشركة عضويتك.
        </p>
      </section>
    </main>
  );
}
