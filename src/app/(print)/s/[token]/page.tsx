import type { Metadata } from "next";
import { cache } from "react";
import ShareToolbar from "./ShareToolbar";
import { QuoteDoc, SurveyDoc, type QuoteDocData, type SurveyDocData } from "@/components/print/Docs";
import { createClient } from "@/lib/supabase/server";
import type { Branding } from "@/lib/branding";

// طلب واحد للمستند يتشاركه العنوان والصفحة
const load = cache(async (token: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shared_document", { p_token: token });
  return { s: (data ?? { status: "invalid" }) as Shared, error, supabase };
});

// العنوان من هوية الشركة المرسلة (لا اسم المنصة) — انظر generateMetadata
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { s } = await load(token);
  const name = s.company?.name ?? "";
  const doc = s.kind === "quote" ? "عرض سعر" : "تقرير معاينة";
  return { title: s.status === "ok" ? `${doc} ${String(s.doc?.ref_no ?? "")} — ${name}` : "مستند", robots: { index: false, follow: false } };
}

type Company = { name: string; legal_name: string | null; phone: string | null; email: string | null; website: string | null; city: string | null; address: string | null;
  vat_number: string | null; commercial_registration: string | null; license_no: string | null; logo_path: string | null; primary_color: string | null;
  header_text: string | null; footer_text: string | null };
type Shared = { status: string; kind?: "quote" | "survey"; expires_at?: string; company?: Company; doc?: Record<string, unknown> };

const MESSAGES: Record<string, string> = {
  invalid: "الرابط غير صحيح أو لم يعد موجودًا.",
  revoked: "أُلغي هذا الرابط من قبل الشركة. تواصل معها للحصول على رابط جديد.",
  expired: "انتهت صلاحية هذا الرابط. تواصل مع الشركة للحصول على رابط جديد.",
  unavailable: "المستند غير متاح حاليًا.",
};

/**
 * عرض المستند للعميل عبر رابط المشاركة دون حساب: القاعدة تتحقق من الرمز (تجزئة فقط) والصلاحية والإلغاء،
 * وتعيد بيانات هذا المستند وحده. الصور والشعار بروابط موقّعة قصيرة تسمح بها سياسة التخزين ما دام الرابط ساريًا.
 */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { s, error, supabase } = await load(token);
  if (error || s.status !== "ok" || !s.company || !s.doc) {
    return (
      <main className="mx-auto max-w-lg p-8 pt-24 text-center" dir="rtl">
        <h1 className="text-xl font-bold">تعذر فتح المستند</h1>
        <p className="mt-3 text-slate-700">{error ? "تعذر الاتصال حاليًا؛ أعد المحاولة بعد قليل." : MESSAGES[s.status] ?? MESSAGES.invalid}</p>
      </main>
    );
  }
  const c = s.company;
  const doc = s.doc;
  const photoRows = (doc.photos as { path: string; name: string; mime: string | null; item_id: string | null }[] | undefined) ?? [];
  const paths = [...photoRows.filter((p) => p.mime?.startsWith("image/")).map((p) => p.path)];
  const [logo, signed] = await Promise.all([
    c.logo_path ? supabase.storage.from("org-branding").createSignedUrl(c.logo_path, 3600) : null,
    paths.length ? supabase.storage.from("org-files").createSignedUrls(paths, 3600) : null,
  ]);
  const urlOf = new Map((signed?.data ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  const b: Branding = {
    id: "", ref_no: null, name: c.name, legal_name: c.legal_name, phone: c.phone, email: c.email, website: c.website, city: c.city, address: c.address,
    vat_number: c.vat_number, license_no: c.license_no, commercial_registration: c.commercial_registration,
    primary_color: c.primary_color ?? "#0f766e", secondary_color: c.primary_color ?? "#0f766e", header_text: c.header_text, footer_text: c.footer_text,
    signature_name: null, signature_title: null, show_logo_in_reports: !!c.logo_path, show_contact_in_reports: true, show_stamp_in_reports: false,
    logo_path: c.logo_path, stamp_path: null, logoUrl: logo?.data?.signedUrl ?? null, stampUrl: null,
  };
  const title = s.kind === "quote" ? `عرض سعر ${String(doc.ref_no)}` : `تقرير معاينة ${String(doc.ref_no)}`;

  return (
    <>
      <ShareToolbar title={title} company={c.name} expires={s.expires_at ?? null} phone={c.phone} photos={paths.length > 0} />
      {s.kind === "quote"
        ? <QuoteDoc b={b} d={{ ...(doc as unknown as QuoteDocData), vat_rate: Number(doc.vat_rate ?? 0) }} />
        : <SurveyDoc b={b} d={{
            ...(doc as unknown as SurveyDocData), vat_rate: Number((s as unknown as { totals?: { vat_rate?: number } }).totals?.vat_rate ?? 0),
            technicians: (doc.technicians as string[] | undefined) ?? [],
            photos: photoRows.map((p) => ({ url: urlOf.get(p.path) ?? null, name: p.name, mime: p.mime, item_id: p.item_id })),
          }} />}
    </>
  );
}
