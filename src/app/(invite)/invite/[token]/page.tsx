import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { companyRole, TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { PERMISSION_LABELS, permissionsByModule } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import GoogleSignIn from "@/app/login/GoogleSignIn";
import AcceptButton from "./AcceptButton";

export const metadata: Metadata = { title: "دعوة للانضمام إلى فريق شركة", robots: { index: false } };

interface Landing {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  kind?: string; role?: string; full_name?: string | null; job_title?: string | null; specialty?: string | null;
  permissions?: string[]; custom_permissions?: boolean;
  company_name?: string; company_status?: string; primary_color?: string; secondary_color?: string; header_text?: string | null;
  logo_path?: string | null; email_hint?: string; signed_in?: boolean; email_matches?: boolean | null; expires_at?: string;
}

const CLOSED: Record<string, { title: string; body: string }> = {
  accepted: { title: "استُخدمت هذه الدعوة", body: "قُبلت هذه الدعوة من قبل ولا يمكن استخدامها مرة أخرى. إن كنت أنت من قبلها فادخل إلى المنصة مباشرة." },
  revoked: { title: "أُلغيت هذه الدعوة", body: "ألغت الشركة هذه الدعوة. اطلب دعوة جديدة من مدير الشركة إن لزم." },
  expired: { title: "انتهت صلاحية الدعوة", body: "انتهت مدة هذه الدعوة. اطلب من مدير الشركة إعادة إرسالها." },
  invalid: { title: "رابط الدعوة غير صالح", body: "تأكد من نسخ الرابط كاملًا كما وصلك، أو اطلب رابطًا جديدًا من الجهة الداعية." },
};

/**
 * صفحة الدعوة بهوية الشركة الداعية (لا بهوية المنصة). تُعرض قبل الدخول بعد التحقق من الرمز في القاعدة؛
 * بلا رمز صالح لا يظهر أي شيء عن أي شركة. القبول يتطلب الدخول بالبريد المدعو، وتتحقق القاعدة من كل الشروط.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_landing", { p_token: token });
  const p = (error ? { status: "invalid" } : data ?? { status: "invalid" }) as Landing;
  const color = p.primary_color ?? "#1e3a5f";
  const accent = p.secondary_color ?? "#d98e04";
  const here = `/invite/${encodeURIComponent(token)}`;

  if (p.status !== "pending") {
    const m = CLOSED[p.status] ?? CLOSED.invalid;
    return (
      <Shell color={color} accent={accent}>
        {p.company_name && <p className="text-sm font-bold" style={{ color }}>{p.company_name}</p>}
        <h1 className="mt-1 text-xl font-extrabold text-slate-900">{m.title}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">{error ? "تعذر التحقق من الدعوة حاليًا؛ أعد المحاولة بعد قليل." : m.body}</p>
      </Shell>
    );
  }

  const specialties = (p.specialty ?? "").split(",").map((s) => TECHNICIAN_SPECIALTIES[s.trim()] ?? "").filter(Boolean);
  const perms = new Set(p.permissions ?? []);
  const groups = permissionsByModule().map((m) => ({ ...m, granted: m.permissions.filter((x) => perms.has(x.key)) })).filter((m) => m.granted.length);

  return (
    <Shell color={color} accent={accent}>
      <div className="flex flex-col items-center gap-3 text-center">
        {p.logo_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${here}/logo`} alt={`شعار ${p.company_name}`} className="h-20 w-auto max-w-48 object-contain" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-2xl text-2xl font-extrabold text-white" style={{ backgroundColor: color }} aria-hidden="true">
            {p.company_name?.trim().charAt(0)}
          </div>
        )}
        <div>
          <p className="text-sm text-slate-500">طلب انضمام إلى فريق شركة</p>
          <h1 className="text-2xl font-extrabold" style={{ color }}>{p.company_name}</h1>
          {p.header_text && <p className="mt-1 text-xs text-slate-500">{p.header_text}</p>}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm sm:grid-cols-2">
        {p.full_name && <Item k="الاسم في الدعوة" v={p.full_name} />}
        <Item k="الدور الوظيفي" v={companyRole[p.role ?? ""] ?? p.role ?? ""} />
        {p.job_title && <Item k="المسمى" v={p.job_title} />}
        {specialties.length > 0 && <Item k="التخصصات" v={specialties.join("، ")} />}
        <Item k="البريد المدعو" v={<span dir="ltr">{p.email_hint}</span>} />
        <Item k="صالحة حتى" v={formatDateTime(p.expires_at ?? null)} />
      </dl>

      {groups.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 p-4 text-sm" open={groups.length <= 3}>
          <summary className="cursor-pointer font-bold text-slate-800">الصلاحيات التي ستحصل عليها ({perms.size}){p.custom_permissions ? " — مخصصة لك" : ""}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="text-xs font-bold" style={{ color }}>{g.label}</p>
                <ul className="mt-1 list-disc ps-5 text-xs leading-6 text-slate-700">
                  {g.granted.map((x) => <li key={x.key}>{PERMISSION_LABELS[x.key]}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">لا تمنح الدعوة أي صلاحية غير المذكورة، ويمكن لمدير الشركة تعديلها لاحقًا.</p>
        </details>
      )}

      <div className="mt-6 space-y-3">
        {!p.signed_in ? (
          <>
            <p className="text-center text-sm text-slate-600">سجّل الدخول بحساب Google للبريد المدعو لقبول الدعوة.</p>
            <Suspense fallback={<div className="h-12 rounded-lg bg-slate-100" />}>
              <GoogleSignIn next={here} label="تسجيل الدخول بحساب Google للمتابعة" />
            </Suspense>
          </>
        ) : p.email_matches ? (
          <AcceptButton token={token} color={color} />
        ) : (
          <>
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm leading-7 text-amber-900">
              أنت مسجل الدخول ببريد غير البريد المدعو (<span dir="ltr">{p.email_hint}</span>). سجّل الخروج ثم ادخل بحساب Google لذلك البريد.
            </p>
            <form action="/auth/signout" method="post">
              <input type="hidden" name="next" value={here} />
              <button type="submit" className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                تسجيل الخروج والدخول بالبريد المدعو
              </button>
            </form>
          </>
        )}
      </div>
    </Shell>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold text-slate-800">{v}</dd></div>;
}

function Shell({ color, accent, children }: { color: string; accent: string; children: React.ReactNode }) {
  return (
    <main dir="rtl" className="min-h-screen bg-slate-100">
      <div className="h-36 sm:h-44" style={{ background: `linear-gradient(135deg, ${color}, ${accent})` }} aria-hidden="true" />
      <section className="mx-auto -mt-24 w-full max-w-xl px-4 pb-12 sm:-mt-28">
        <div className="pop-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">{children}</div>
        <p className="mt-4 text-center text-[11px] text-slate-500">رابط شخصي يُستخدم مرة واحدة · يُدار عبر منصة عين السلامة</p>
      </section>
    </main>
  );
}
