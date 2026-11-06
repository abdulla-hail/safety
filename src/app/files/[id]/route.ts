import { NextResponse } from "next/server";
import { ContextUnavailableError, getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";

/**
 * ملف مرفق (صورة أو PDF): يطلبه المتصفح بعد عرض الصفحة، فلا تنتظر الصفحة توليد الروابط الموقعة (جولة كاملة ~350 مللي ثانية).
 * المرفق يُقرأ بصلاحيات المستخدم (RLS على attachments)، والتوقيع يخضع لسياسة قراءة التخزين؛ لا وصول لمن لا يرى المرفق.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext().catch((e: unknown) => (e instanceof ContextUnavailableError ? "unavailable" as const : Promise.reject(e)));
  if (ctx === "unavailable") return new NextResponse(null, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  if (!ctx?.active || !isUuid(id)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: a } = await supabase.from("attachments").select("storage_path").eq("id", id).eq("company_id", ctx.active.organization_id).maybeSingle();
  if (!a?.storage_path) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await supabase.storage.from("org-files").createSignedUrl(a.storage_path, 3600);
  if (!data?.signedUrl) {
    if (error) console.error("attachment sign failed:", error.message);
    return new NextResponse(null, { status: error ? 503 : 404, headers: { "Cache-Control": "no-store" } });
  }
  const res = NextResponse.redirect(data.signedUrl, 302);
  // المسار ثابت لكل مرفق: المتصفح يعيد استخدام التحويل 10 دقائق (أقل من عمر الرابط الموقع) دون طلبات جديدة
  res.headers.set("Cache-Control", "private, max-age=600");
  return res;
}
