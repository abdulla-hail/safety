import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { SurveyDoc, type SurveyDocData } from "@/components/print/Docs";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { isUuid } from "@/lib/list";

export const metadata = { title: "تقرير معاينة | طباعة" };

/** تقرير المعاينة للطباعة أو الحفظ PDF (من «طباعة» في المتصفح ← حفظ كـ PDF). الفني يطبع معاينات نطاقه فقط (RLS). */
export default async function PrintSurvey({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print", "field.assigned", "visits.view");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: v }, b, techs, items, files] = await Promise.all([
    supabase.from("visits").select("ref_no, visit_type, scheduled_start, actual_end, closed_at, summary, recommendations, technician_notes, survey_vat, customer:customers(name, phone), site:customer_sites(name, city, address, latitude, longitude)")
      .eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("visit_technicians").select("technician:technicians(full_name)").eq("visit_id", id),
    supabase.from("survey_items").select("id, title, issue_type, description, quantity, unit_price, device:devices(name, ref_no)").eq("visit_id", id).order("sort_order").order("created_at"),
    supabase.from("attachments").select("id, file_name, mime_type, survey_item_id").eq("entity_type", "visit").eq("entity_id", id).is("archived_at", null).order("created_at"),
  ]);
  if (!v || !b || v.visit_type !== "survey") notFound();
  type It = { id: string; title: string; issue_type: string; description: string | null; quantity: number; unit_price: number; device: { name: string; ref_no: string } | null };
  const d: SurveyDocData = {
    ref_no: v.ref_no, scheduled_start: v.scheduled_start, actual_end: v.actual_end, summary: v.summary, recommendations: v.recommendations,
    technician_notes: v.technician_notes, vat_rate: v.survey_vat ? 15 : 0, draft: !v.closed_at,
    customer: v.customer as unknown as SurveyDocData["customer"], site: v.site as unknown as SurveyDocData["site"],
    technicians: ((techs.data ?? []) as unknown as { technician: { full_name: string } | null }[]).map((t) => t.technician?.full_name ?? "").filter(Boolean),
    items: ((items.data ?? []) as unknown as It[]).map((i) => ({ ...i, device: i.device?.name ?? null, device_ref: i.device?.ref_no ?? null })),
    photos: (files.data ?? []).map((f) => ({ url: `/files/${f.id}`, name: f.file_name, mime: f.mime_type, item_id: f.survey_item_id })),
  };
  return (<><PrintToolbar note="لحفظ PDF: اختر «حفظ كـ PDF» في نافذة الطباعة." /><SurveyDoc b={b} d={d} /></>);
}
