"use client";

import { useEffect } from "react";

/** تسجيل عامل الخدمة الذي يجعل المنصة قابلة للتثبيت (لا تخزين ولا عمل دون اتصال) */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("sw register failed:", e));
  }, []);
  return null;
}
