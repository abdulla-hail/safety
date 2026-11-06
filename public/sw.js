// عامل خدمة تطبيق «عين السلامة» المثبّت: يجعل المنصة قابلة للتثبيت فقط.
// لا يخزّن صفحات ولا بيانات ولا يدّعي العمل دون اتصال: كل طلب يذهب إلى الشبكة كما في المتصفح العادي.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
