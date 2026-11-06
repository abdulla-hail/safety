import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { getPlatformLogo } from "@/lib/platform-branding";
import { PLATFORM_PERMISSION_LABELS } from "@/lib/platform-permissions";
import PlatformMark from "@/components/PlatformMark";
import GoogleSignIn from "@/app/login/GoogleSignIn";
import AcceptAssistant from "./AcceptAssistant";

export const metadata: Metadata = { title: "دعوة مساعد مالك | عين السلامة", robots: { index: false } };

interface Landing {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  full_name?: string | null; permissions?: string[]; email_hint?: string; expires_at?: string; signed_in?: boolean; email_matches?: boolean | null;
}

const CLOSED: Record<string, string> = {
  accepted: "استُخدمت هذه الدعوة من قبل ولا يمكن استخدامها مرة أخرى.",
  revoked: "ألغى مالك المنصة هذه الدعوة.",
  expired: "انتهت صلاحية هذه الدعوة. اطلب من مالك المنصة دعوة جديدة.",
  invalid: "رابط الدعوة غير صالح. تأكد من نسخه كاملًا.",
};

/** دعوة مساعد المالك بهوية منصة «عين السلامة»؛ لا تُمنح الصفة إلا بعد القبول بالبريد المدعو نفسه. */
export default async function AssistantInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const supabase = await createClient();
  const [{ data, error }, logo] = await Promise.all([
    supabase.rpc("assistant_invitation_landing", { p_token: token }),
    getPlatformLogo(),
  ]);
  const p = (error ? { status: "invalid" } : data ?? { status: "invalid" }) as Landing;
  const here = `/assistant-invite/${encodeURIComponent(token)}`;

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-4 py-10">
      <section className="pop-enter relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand" aria-hidden="true" />
        <div className="text-center">
          <PlatformMark logoUrl={logo} className="mb-4 size-16" />
          <p className="text-sm text-slate-500">دعوة من مالك منصة عين السلامة</p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#1e3a5f]">الانضمام كمساعد لمالك المنصة</h1>
        </div>
        {p.status !== "pending" ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error ? "تعذر التحقق من الدعوة حاليًا؛ أعد المحاولة بعد قليل." : CLOSED[p.status] ?? CLOSED.invalid}</p>
        ) : (
          <>
            <dl className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm sm:grid-cols-2">
              {p.full_name && <div><dt className="text-xs text-slate-500">الاسم</dt><dd className="font-semibold">{p.full_name}</dd></div>}
              <div><dt className="text-xs text-slate-500">البريد المدعو</dt><dd className="font-semibold" dir="ltr">{p.email_hint}</dd></div>
              <div><dt className="text-xs text-slate-500">صالحة حتى</dt><dd className="font-semibold">{formatDateTime(p.expires_at ?? null)}</dd></div>
            </dl>
            <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm">
              <p className="font-bold text-slate-800">الصلاحيات الممنوحة لك</p>
              <ul className="mt-2 list-disc ps-5 leading-7 text-slate-700">
                {(p.permissions ?? []).map((k) => <li key={k}>{PLATFORM_PERMISSION_LABELS[k as keyof typeof PLATFORM_PERMISSION_LABELS] ?? k}</li>)}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">صفة المساعد منفصلة عن الشركات: لا تمنح عضوية في أي شركة ولا وصولًا لبياناتها التشغيلية. يستطيع المالك تعديلها أو إيقافها.</p>
            </div>
            <div className="mt-6 space-y-3">
              {!p.signed_in ? (
                <Suspense fallback={<div className="h-12 rounded-lg bg-slate-100" />}>
                  <GoogleSignIn next={here} label="تسجيل الدخول بحساب Google للمتابعة" />
                </Suspense>
              ) : p.email_matches ? (
                <AcceptAssistant token={token} />
              ) : (
                <>
                  <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">أنت مسجل ببريد غير البريد المدعو. سجّل الخروج ثم ادخل بحساب Google لذلك البريد.</p>
                  <form action="/auth/signout" method="post">
                    <input type="hidden" name="next" value={here} />
                    <button type="submit" className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">تسجيل الخروج والدخول بالبريد المدعو</button>
                  </form>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
