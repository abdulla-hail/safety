import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { QuoteDoc, type QuoteDocData } from "@/components/print/Docs";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { isUuid } from "@/lib/list";

export const metadata = { title: "عرض سعر | طباعة" };

export default async function PrintQuote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("quotes.view", "quotes.manage");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: q }, b, items] = await Promise.all([
    supabase.from("quotations").select("ref_no, status, title, issue_date, valid_until, vat_rate, notes, terms, customer:customers(name, vat_number, phone), site:customer_sites(name, city, address), visit:visits(ref_no)")
      .eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("quotation_items").select("description, quantity, unit_price").eq("quotation_id", id).order("sort_order").order("created_at"),
  ]);
  if (!q || !b) notFound();
  const d: QuoteDocData = {
    ref_no: q.ref_no, status: q.status, title: q.title, issue_date: q.issue_date, valid_until: q.valid_until, vat_rate: Number(q.vat_rate), notes: q.notes, terms: q.terms,
    customer: q.customer as unknown as QuoteDocData["customer"], site: q.site as unknown as QuoteDocData["site"],
    visit_ref: (q.visit as unknown as { ref_no: string } | null)?.ref_no ?? null, items: items.data ?? [],
  };
  return (<><PrintToolbar note="لحفظ PDF: اختر «حفظ كـ PDF» في نافذة الطباعة." /><QuoteDoc b={b} d={d} /></>);
}
