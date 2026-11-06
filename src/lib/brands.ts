import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type BrandPick = { ok: true; id: string | null; name: string | null } | { ok: false; message: string };

/**
 * يحوّل اسم الماركة المكتوب إلى ماركة من قائمة الشركة: المطابقة بلا اعتبار لحالة الأحرف والمسافات؛
 * إن لم توجد تُضاف للقائمة لمن يملك الصلاحية (إدارة الكتالوج أو عروض الأسعار)، وإلا يُطلب اختيار ماركة موجودة.
 */
export async function resolveBrand(supabase: SupabaseClient, orgId: string, raw: string, canCreate: boolean): Promise<BrandPick> {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name) return { ok: true, id: null, name: null };
  const { data } = await supabase.from("brands").select("id, name").eq("company_id", orgId).ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1);
  if (data?.[0]) return { ok: true, id: data[0].id, name: data[0].name };
  if (!canCreate) return { ok: false, message: `الماركة «${name}» ليست في القائمة؛ اختر ماركة موجودة أو اطلب من المسؤول إضافتها.` };
  const ins = await supabase.from("brands").insert({ company_id: orgId, name }).select("id, name").single();
  if (ins.error) {
    // إضافة متزامنة بالاسم نفسه: نعيد قراءة الموجود
    const again = await supabase.from("brands").select("id, name").eq("company_id", orgId).ilike("name", name).limit(1);
    if (again.data?.[0]) return { ok: true, id: again.data[0].id, name: again.data[0].name };
    return { ok: false, message: "تعذرت إضافة الماركة." };
  }
  return { ok: true, id: ins.data.id, name: ins.data.name };
}

export async function brandNames(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await supabase.from("brands").select("name").eq("company_id", orgId).order("name").limit(500);
  return (data ?? []).map((b) => b.name);
}
