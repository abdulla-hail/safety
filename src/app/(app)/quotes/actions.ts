"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { parseAmount } from "@/lib/money";
import { resolveBrand } from "@/lib/brands";
import { siteUrl } from "@/lib/codes";
import { documentEmail, loadCompanyMail, mailFailureText, sendCompanyMail } from "@/lib/company-mail";
import { fail, str, strOrNull, type ActionState } from "@/lib/action-state";

/** عرض سعر من معاينة منتهية (يعيد العرض القائم إن وُجد) */
export async function createQuoteFromVisit(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  const visit = str(fd, "visit_id");
  if (!ctx || !isUuid(visit)) return fail(prev, fd, "ليست لديك صلاحية إنشاء عروض الأسعار.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quotation_from_visit", { p_visit: visit });
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/quotes");
  redirect(`/quotes/${data as string}`);
}

/** عرض سعر يدوي لعميل (وفرعه اختياريًا) يبدأ «قيد الإعداد» */
export async function createManualQuote(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  if (!ctx) return fail(prev, fd, "ليست لديك صلاحية إنشاء عروض الأسعار.");
  const customer = str(fd, "customer_id");
  const site = str(fd, "site_id");
  if (!isUuid(customer)) return fail(prev, fd, "اختر العميل.", { customer_id: "مطلوب" });
  const supabase = await createClient();
  const valid = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("quotations").insert({
    company_id: ctx.orgId, customer_id: customer, site_id: isUuid(site) ? site : null, title: strOrNull(fd, "title") ?? "عرض سعر أعمال صيانة أنظمة السلامة",
    valid_until: valid,
  }).select("id").single();
  if (error) return fail(prev, fd, dbErrorMessage(error));
  revalidatePath("/quotes");
  redirect(`/quotes/${data.id}?ok=created`);
}

export async function updateQuote(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return fail(prev, fd, "ليست لديك صلاحية تعديل عروض الأسعار.");
  const issue = str(fd, "issue_date");
  const valid = str(fd, "valid_until");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue)) return fail(prev, fd, "تاريخ العرض مطلوب.", { issue_date: "مطلوب" });
  if (valid && valid < issue) return fail(prev, fd, "تاريخ انتهاء الصلاحية قبل تاريخ العرض.", { valid_until: "غير صالح" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("quotations").update({
    title: strOrNull(fd, "title"), issue_date: issue, valid_until: valid || null, vat_rate: str(fd, "vat") === "0" ? 0 : 15,
    notes: strOrNull(fd, "notes"), terms: strOrNull(fd, "terms"),
  }).eq("id", id).eq("company_id", ctx.orgId).select("id");
  if (error) return fail(prev, fd, dbErrorMessage(error));
  if (!data?.length) return fail(prev, fd, "العرض غير موجود أو لا تملك صلاحية تعديله.");
  revalidatePath(`/quotes/${id}`);
  return { ok: true, message: "حُفظت بيانات العرض.", attempt: (prev.attempt ?? 0) + 1 };
}

export interface LineState { ok: boolean; message: string; errors?: Record<string, string> }

export async function saveQuoteItem(input: { quoteId: string; id?: string; fields: Record<string, string> }): Promise<LineState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  if (!ctx || !isUuid(input.quoteId)) return { ok: false, message: "ليست لديك صلاحية تعديل عروض الأسعار." };
  const g = (k: string) => (typeof input.fields[k] === "string" ? input.fields[k].trim() : "");
  const errors: Record<string, string> = {};
  const description = g("description");
  if (description.length < 2) errors.description = "اكتب وصف البند";
  const qty = parseAmount(g("quantity") || "1");
  if (qty === null || qty <= 0) errors.quantity = "كمية غير صالحة";
  const price = parseAmount(g("unit_price") || "0");
  if (price === null) errors.unit_price = "سعر غير صالح";
  if (Object.keys(errors).length) return { ok: false, message: "راجع الحقول المعلَّمة؛ لم يُحفظ شيء.", errors };
  const supabase = await createClient();
  const brand = await resolveBrand(supabase, ctx.orgId, g("brand"), ctx.canAny("catalog.manage", "quotes.manage"));
  if (!brand.ok) return { ok: false, message: brand.message, errors: { brand: "اختر من القائمة" } };
  const row = { description: description.slice(0, 1000), quantity: qty, unit_price: price, brand_id: brand.id, brand: brand.name };
  const res = input.id && isUuid(input.id)
    ? await supabase.from("quotation_items").update(row).eq("id", input.id).eq("quotation_id", input.quoteId).select("id")
    : await supabase.from("quotation_items").insert({ ...row, company_id: ctx.orgId, quotation_id: input.quoteId, sort_order: Date.now() % 2_000_000_000 }).select("id");
  if (res.error) return { ok: false, message: dbErrorMessage(res.error) };
  if (!res.data?.length) return { ok: false, message: "البند غير موجود أو لا تملك صلاحية تعديله." };
  revalidatePath(`/quotes/${input.quoteId}`);
  return { ok: true, message: input.id ? "حُفظ تعديل البند." : "أُضيف البند." };
}

export async function deleteQuoteItem(input: { quoteId: string; id: string }): Promise<LineState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  if (!ctx || !isUuid(input.id)) return { ok: false, message: "ليست لديك صلاحية تعديل عروض الأسعار." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("quotation_items").delete().eq("id", input.id).eq("quotation_id", input.quoteId).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "البند غير موجود أو لا تملك صلاحية حذفه." };
  revalidatePath(`/quotes/${input.quoteId}`);
  return { ok: true, message: "حُذف البند." };
}

const STATUS = ["draft", "review", "sent", "accepted", "rejected"];

export async function setQuoteStatus(prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("quotes.manage", "quotes.create");
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!ctx || !isUuid(id) || !STATUS.includes(status)) return { ok: false, message: "ليست لديك صلاحية إدارة عروض الأسعار." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("quotation_set_status", { p_quote: id, p_status: status, p_note: strOrNull(fd, "note") });
  if (error) return { ok: false, message: dbErrorMessage(error), attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/quotes");
  const msg: Record<string, string> = { review: "أُرسل العرض للمراجعة؛ سيُشعَر المسؤول.", sent: "اعتُمد العرض وحُدّد كمرسل للعميل.", accepted: "سُجّل قبول العميل.", rejected: "سُجّل رفض العميل.", draft: "أُعيد العرض إلى «قيد الإعداد»." };
  return { ok: true, message: msg[status] ?? "حُدّثت حالة العرض.", attempt: (prev.attempt ?? 0) + 1 };
}

/** أرشفة العرض (لا حذف): يتيح إنشاء عرض جديد للمعاينة نفسها */
export async function archiveQuote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction("quotes.manage");
  const id = str(fd, "id");
  if (!ctx || !isUuid(id)) return { ok: false, message: "ليست لديك صلاحية إدارة عروض الأسعار." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("quotations").update({ archived_at: new Date().toISOString(), archived_by: ctx.user.id })
    .eq("id", id).eq("company_id", ctx.orgId).is("archived_at", null).select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "العرض غير موجود أو مؤرشف مسبقًا." };
  revalidatePath("/quotes");
  redirect("/quotes?ok=archived");
}

export interface ShareState { ok: boolean; message: string; url?: string; emailed?: boolean }

/**
 * رابط مشاركة للعميل (عرض سعر أو تقرير معاينة): الرمز يُعرض مرة واحدة ولا يُخزَّن إلا تجزئته؛ صالح للمدة المحددة وقابل للإلغاء.
 * إن أُدخل بريد العميل وكانت خدمة البريد مهيأة يُرسل إليه؛ وإلا يُعرض الرابط للنسخ أو واتساب دون ادعاء الإرسال.
 */
export async function createShareLink(input: { kind: "quote" | "survey"; id: string; days: number; email?: string; subject?: string }): Promise<ShareState> {
  const ctx = await orgForAction("quotes.manage", "visits.create", "visits.update", "reports.print");
  if (!ctx || !isUuid(input.id) || !["quote", "survey"].includes(input.kind)) return { ok: false, message: "ليست لديك صلاحية المشاركة." };
  const days = Number.isInteger(input.days) && input.days >= 1 && input.days <= 180 ? input.days : 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("share_create", { p_kind: input.kind, p_id: input.id, p_days: days });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  const url = `${await siteUrl()}/s/${data as string}`;
  const email = (input.email ?? "").trim();
  let emailed = false;
  let note = "";
  if (email) {
    if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(email)) return { ok: true, url, message: "أُنشئ الرابط، لكن البريد غير صالح فلم يُرسل." };
    // الإرسال من بريد الشركة الرسمي وبهويتها فقط (لا اسم المنصة)
    const [cfg, { data: co }] = await Promise.all([
      loadCompanyMail(supabase, ctx.orgId),
      supabase.from("companies").select("name, phone, email, primary_color").eq("id", ctx.orgId).maybeSingle(),
    ]);
    const company = cfg?.sender_name || co?.name || ctx.active.organization_name;
    const title = input.subject ?? (input.kind === "quote" ? "عرض سعر" : "تقرير معاينة");
    const m = documentEmail({ company, title, url, days, phone: co?.phone, email: cfg?.sender_email ?? co?.email, color: co?.primary_color });
    const r = await sendCompanyMail(cfg, { to: email, subject: `${title} — ${company}`, html: m.html, text: m.text });
    emailed = r.sent;
    if (!r.sent) note = ` ${mailFailureText(r)} انسخ الرابط وأرسله بنفسك.`;
  }
  revalidatePath(input.kind === "quote" ? `/quotes/${input.id}` : `/visits/${input.id}/survey`);
  return { ok: true, url, emailed, message: emailed ? `أُرسل الرابط إلى ${email}.` : `أُنشئ رابط المشاركة (صالح ${days} يومًا).${note}` };
}

export async function revokeShareLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await orgForAction();
  const id = str(fd, "link_id");
  const back = str(fd, "back");
  if (!ctx || !isUuid(id)) return { ok: false, message: "طلب غير صالح." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("share_revoke", { p_link: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (back.startsWith("/")) revalidatePath(back);
  return { ok: true, message: "أُلغي الرابط؛ لم يعد يفتح للعميل." };
}
