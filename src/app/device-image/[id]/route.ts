import { NextResponse } from "next/server";
import { ContextUnavailableError, getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";

/**
 * صورة الجهاز: يُطلبها المتصفح بعد عرض الصفحة فلا يؤخر توليد الرابط الموقّع تحميلَها.
 * الجهاز يُقرأ بصلاحيات المستخدم (RLS)، والتوقيع يخضع لسياسة قراءة التخزين؛ لا وصول لمن لا يرى الجهاز.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // تعذر جلب السياق مؤقتًا (انشغال القاعدة) ليس «لا توجد صورة»: 503 دون تخزين، فيعيد المتصفح الطلب لاحقًا
  const ctx = await getContext().catch((e: unknown) => (e instanceof ContextUnavailableError ? "unavailable" as const : Promise.reject(e)));
  if (ctx === "unavailable") return new NextResponse(null, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  if (!ctx?.active || !isUuid(id)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: d } = await supabase.from("devices").select("image_path").eq("id", id).eq("company_id", ctx.active.organization_id).maybeSingle();
  if (!d?.image_path) return new NextResponse(null, { status: 404 });
  const { data, error } = await supabase.storage.from("org-files").createSignedUrl(d.image_path, 3600);
  if (!data?.signedUrl) {
    if (error) console.error("device image sign failed:", error.message);
    return new NextResponse(null, { status: error ? 503 : 404, headers: { "Cache-Control": "no-store" } });
  }
  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, max-age=600");
  return res;
}
