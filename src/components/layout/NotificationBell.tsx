"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";

interface Toast { id: string; title: string; body: string | null; link: string | null }

/**
 * جرس الإشعارات الفوري: اشتراك Supabase Realtime في إشعارات المستخدم نفسه (RLS يمنع غيرها)، فيزيد العدّاد ويظهر تنبيه
 * منبثق لحظة وقوع الحدث دون تحديث الصفحة. إن تعذر الاتصال الفوري (شبكة/جدار ناري) يُحدَّث العدّاد كل دقيقة وعند العودة للتبويب.
 */
export default function NotificationBell({ userId, initialCount }: { userId: string | null; initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  // القيمة من الخادم بعد كل تنقل/تحديث هي المرجع
  useEffect(() => { const t = setTimeout(() => setCount(initialCount), 0); return () => clearTimeout(t); }, [initialCount]);

  useEffect(() => {
    if (!userId) return;
    let supabase: ReturnType<typeof createClient>;
    try { supabase = createClient(); } catch { return; }
    let live = false;
    let stopped = false;
    const refresh = async () => {
      const { count: n, error } = await supabase.from("notifications").select("id", { count: "exact", head: true })
        .eq("recipient_user_id", userId).is("read_at", null);
      if (!error && n !== null && !stopped) setCount(n);
    };
    const channel = supabase.channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, (payload) => {
        const n = payload.new as { id: string; title: string; body: string | null; link: string | null; read_at: string | null };
        if (n.read_at) return;
        setCount((c) => c + 1);
        setToasts((t) => [...t.slice(-2), { id: n.id, title: n.title, body: n.body, link: n.link }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 8000);
        // الصفحات التي تعرض الإشعارات أو الملخص تتحدث تلقائيًا
        if (/^\/(notifications|dashboard)/.test(pathRef.current)) router.refresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, () => { void refresh(); })
      .subscribe((status) => { live = status === "SUBSCRIBED"; });
    const poll = setInterval(() => { if (!live && document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return (
    <>
      <Link href="/notifications" className="icon-hover relative rounded-full p-2 text-slate-600 transition hover:bg-brand-soft hover:text-brand-strong"
            aria-label={count > 0 ? `الإشعارات (${count} غير مقروءة)` : "الإشعارات"}>
        <Icon name="bell" className="size-5" />
        {count > 0 && (
          <span className="pop-enter absolute -end-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden">
        {toasts.map((t) => (
          <div key={t.id} className="pop-enter pointer-events-auto rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{t.title}</p>
              <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-700" aria-label="إغلاق">×</button>
            </div>
            {t.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.body}</p>}
            <Link href={`/notifications/${t.id}/open`} prefetch={false} className="mt-1 inline-block text-xs font-semibold text-brand-strong underline">فتح</Link>
          </div>
        ))}
      </div>
    </>
  );
}
