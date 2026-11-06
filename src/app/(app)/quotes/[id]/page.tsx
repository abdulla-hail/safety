import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ActionButton from "@/components/ui/ActionButton";
import EntityForm from "@/components/ui/EntityForm";
import Flash from "@/components/ui/Flash";
import ShareBox from "@/components/share/ShareBox";
import { QuoteItems } from "@/components/pricing/SurveyItems";
import { btnDangerOutline, btnPrimary, btnSecondary, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { formatDate, formatDateTime, isFuture } from "@/lib/format";
import { auditAction, quoteStatus } from "@/lib/labels";
import { brandNames } from "@/lib/brands";
import { archiveQuote, revokeShareLink, setQuoteStatus, updateQuote } from "../actions";

export const metadata = { title: "عرض سعر | عين السلامة" };

type Q = {
  id: string; ref_no: string; status: string; title: string | null; issue_date: string; valid_until: string | null; vat_rate: number; notes: string | null; terms: string | null;
  sent_at: string | null; decided_at: string | null; decision_note: string | null; archived_at: string | null; visit_id: string | null;
  created_by: string | null; created_at: string; submitted_at: string | null; approved_by: string | null; approved_at: string | null;
  customer: { id: string; name: string; email: string | null } | null; site: { id: string; name: string } | null; visit: { ref_no: string } | null;
};

/** عرض السعر: تعديل البيانات والبنود والأسعار ما دام «قيد الإعداد»، ثم مرسل ← مقبول/مرفوض. الطباعة والمشاركة في أي وقت. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("quotes.view", "quotes.manage", "quotes.create");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const isManager = ctx.can("quotes.manage");
  const [{ data: raw }, items, links, brands, techs, history] = await Promise.all([
    supabase.from("quotations").select("id, ref_no, status, title, issue_date, valid_until, vat_rate, notes, terms, sent_at, decided_at, decision_note, archived_at, visit_id, created_by, created_at, submitted_at, approved_by, approved_at, "
      + "customer:customers(id, name, email), site:customer_sites(id, name), visit:visits(ref_no)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("quotation_items").select("id, description, quantity, unit_price, brand").eq("quotation_id", id).order("sort_order").order("created_at"),
    isManager ? supabase.from("share_links").select("id, created_at, expires_at, revoked_at").eq("company_id", ctx.orgId).eq("kind", "quote").eq("entity_id", id).order("created_at", { ascending: false }).limit(10) : null,
    brandNames(supabase, ctx.orgId),
    supabase.from("technicians").select("user_id, full_name").eq("company_id", ctx.orgId).not("user_id", "is", null),
    // سجل الإنشاء والتعديلات (يظهر لمن يملك قراءة سجل التدقيق)
    supabase.from("company_audit_log").select("id, action, actor_user_id, actor_email, details, created_at").eq("company_id", ctx.orgId)
      .eq("target_type", "quotation").eq("target_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const q = raw as unknown as Q | null;
  if (!q) notFound();
  const manage = isManager && !q.archived_at;
  const owner = !q.archived_at && ctx.can("quotes.create") && q.created_by === ctx.user.id;
  const draft = q.status === "draft";
  // التعديل: المسؤول في «قيد الإعداد» و«بانتظار المراجعة»، والفني لمسودته فقط
  const canEdit = (manage && (draft || q.status === "review")) || (owner && draft);
  const lines = items.data ?? [];
  const activeLinks = (links?.data ?? []).filter((l) => !l.revoked_at && isFuture(l.expires_at));
  const techName = new Map((techs.data ?? []).map((x) => [x.user_id as string, x.full_name]));
  const nameOf = (uid: string | null, email?: string | null) => !uid ? "النظام" : uid === ctx.user.id ? "أنت" : techName.get(uid) ?? email ?? "عضو في الشركة";
  const createdEntry = (history.data ?? []).find((h) => h.action === "create");
  const back = `/quotes/${id}`;
  const st = (status: string, label: string, cls = btnSecondary, confirm?: string) =>
    <ActionButton action={setQuoteStatus} hidden={{ id, status }} label={label} className={cls} confirm={confirm} />;

  return (
    <div className="space-y-5">
      <Flash />
      <PageHeader title={`عرض سعر ${q.ref_no}`} crumbs={[{ label: "عروض الأسعار", href: "/quotes" }, { label: q.ref_no }]}
        description={<>{q.customer ? <Link href={`/customers/${q.customer.id}`} className={link}>{q.customer.name}</Link> : "—"}
          {q.site && ` · ${q.site.name}`}{q.visit_id && q.visit && <> · من <Link href={`/visits/${q.visit_id}/survey`} className={link}>معاينة {q.visit.ref_no}</Link></>}</>}
        actions={<Link href={`/print/quote/${id}`} target="_blank" className={btnSecondary}>طباعة / PDF</Link>} />

      <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StatusBadge {...(quoteStatus[q.status] ?? { label: q.status, tone: "neutral" })} />
          {q.archived_at && <StatusBadge label="مؤرشف" tone="neutral" />}
          {q.sent_at && <span>أُرسل: {formatDateTime(q.sent_at)}</span>}
          {q.decided_at && <span>القرار: {formatDateTime(q.decided_at)}</span>}
          {q.decision_note && <span className="text-slate-600">«{q.decision_note}»</span>}
          <span className="text-slate-600">أنشأه: <b>{nameOf(q.created_by, createdEntry?.actor_email)}</b> في {formatDateTime(q.created_at)}</span>
          {q.submitted_at && <span className="text-slate-600">أُرسل للمراجعة: {formatDateTime(q.submitted_at)}</span>}
          {q.approved_at && <span className="text-slate-600">اعتمده: <b>{nameOf(q.approved_by)}</b> في {formatDateTime(q.approved_at)}</span>}
        </div>
        {(manage || owner) && (
          <div className="flex flex-wrap gap-2">
            {draft && owner && !manage && st("review", "إرسال للمراجعة", btnPrimary, "إرسال العرض للمسؤول للمراجعة والاعتماد؟ لن تتمكن من تعديله حتى يُعاد إليك.")}
            {q.status === "review" && owner && !manage && st("draft", "سحب من المراجعة للتعديل")}
          </div>
        )}
        {manage && (
          <div className="flex flex-wrap gap-2">
            {q.status === "review" && <>{st("sent", "اعتماد وإرسال للعميل", btnPrimary, "اعتماد العرض وتحديده كمرسل للعميل؟")}{st("draft", "إعادة للفني للتعديل")}</>}
            {draft && st("sent", "اعتماد كمرسل للعميل", btnPrimary, "تحديد العرض كمرسل؟ تتجمد البنود والأسعار (يمكن إرجاعه للإعداد لاحقًا).")}
            {q.status === "sent" && <>{st("accepted", "قبِل العميل", btnPrimary)}{st("rejected", "رفض العميل", btnDangerOutline)}{st("draft", "إرجاع للإعداد")}</>}
            {(q.status === "accepted" || q.status === "rejected") && st("draft", "إرجاع للإعداد", btnSecondary, "إرجاع العرض إلى «قيد الإعداد» للتعديل؟")}
          </div>
        )}
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>البنود والأسعار ({lines.length})</h2>
          {!canEdit && <span className="text-xs text-slate-500">{q.status === "review" && owner ? "بانتظار مراجعة المسؤول" : "للتعديل: «إرجاع للإعداد»"}</span>}</div>
        <div className="p-4"><QuoteItems quoteId={id} lines={lines} vatRate={Number(q.vat_rate)} locked={!canEdit} brands={brands} canAddBrand={ctx.canAny("catalog.manage", "quotes.manage")} /></div>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>بيانات العرض</h2></div>
        <div className="p-5">
          {canEdit ? (
            <EntityForm action={updateQuote} submitLabel="حفظ بيانات العرض"
              initial={{ id, title: q.title ?? "", issue_date: q.issue_date, valid_until: q.valid_until ?? "", vat: Number(q.vat_rate) > 0 ? "15" : "0", notes: q.notes ?? "", terms: q.terms ?? "" }}
              fields={[
                { name: "id", label: "", type: "hidden" },
                { name: "title", label: "عنوان العرض", wide: true, maxLength: 200 },
                { name: "issue_date", label: "تاريخ العرض", type: "date", required: true },
                { name: "valid_until", label: "صالح حتى", type: "date" },
                { name: "vat", label: "ضريبة القيمة المضافة", type: "select", required: true, options: [{ value: "15", label: "تشمل 15٪" }, { value: "0", label: "بدون ضريبة" }] },
                { name: "notes", label: "ملاحظات للعميل", type: "textarea", wide: true },
                { name: "terms", label: "الشروط والأحكام (مدة التنفيذ، الدفع، الضمان...)", type: "textarea", wide: true },
              ]} />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">العنوان</dt><dd>{q.title ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">التاريخ / الصلاحية</dt><dd>{formatDate(q.issue_date)} — {q.valid_until ? formatDate(q.valid_until) : "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">ملاحظات</dt><dd className="whitespace-pre-line">{q.notes ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">الشروط</dt><dd className="whitespace-pre-line">{q.terms ?? "—"}</dd></div>
            </dl>
          )}
        </div>
      </section>

      {manage && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>إرسال ومشاركة العرض مع العميل</h2></div>
          <div className="space-y-4 p-5">
            {draft && <p className="text-xs text-amber-700">العرض ما زال «قيد الإعداد»؛ سيرى العميل آخر نسخة محفوظة. بعد الإرسال اضغط «اعتماد كمرسل للعميل».</p>}
            <ShareBox kind="quote" id={id} title={`عرض سعر ${q.ref_no} — ${q.customer?.name ?? ""}`} customerEmail={q.customer?.email} />
            {activeLinks.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
                {activeLinks.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>رابط أُنشئ {formatDate(l.created_at)} · ينتهي {formatDate(l.expires_at)}</span>
                    <ActionButton action={revokeShareLink} hidden={{ link_id: l.id, back }} label="إلغاء الرابط" confirm="إلغاء هذا الرابط؟"
                      className={`${btnDangerOutline} !px-2 !py-0.5 !text-[10px]`} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {(history.data ?? []).length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>سجل الإنشاء والتعديلات</h2></div>
          <ul className="divide-y divide-slate-100 text-xs">
            {(history.data ?? []).map((h) => {
              const d = (h.details ?? {}) as { name?: string; changes?: Record<string, { from: unknown; to: unknown }> };
              const ch = d.changes ? Object.entries(d.changes).filter(([k]) => !["updated_at"].includes(k)).map(([k, v]) => `${k}: ${String(v.from ?? "—")} ← ${String(v.to ?? "—")}`).join(" · ") : "";
              return (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                  <span><b>{auditAction[h.action] ?? h.action}</b>{d.name && h.action.startsWith("item") ? ` — ${d.name}` : ""}{ch && <span className="block text-slate-500" dir="auto">{ch}</span>}</span>
                  <span className="text-slate-500">{nameOf(h.actor_user_id, h.actor_email)} · {formatDateTime(h.created_at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {manage && (
        <div className="flex justify-end">
          <ActionButton action={archiveQuote} hidden={{ id }} label="أرشفة العرض" className={btnDangerOutline}
            confirm="أرشفة هذا العرض؟ يبقى محفوظًا في «المؤرشفة»، ويمكن إنشاء عرض جديد من المعاينة نفسها." />
        </div>
      )}
    </div>
  );
}
