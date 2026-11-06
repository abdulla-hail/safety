import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ActionButton from "@/components/ui/ActionButton";
import EntityForm from "@/components/ui/EntityForm";
import Flash from "@/components/ui/Flash";
import UploadForm from "@/components/attachments/UploadForm";
import SafeImage from "@/components/attachments/SafeImage";
import ShareBox from "@/components/share/ShareBox";
import { SurveyItems } from "@/components/pricing/SurveyItems";
import { btnDangerOutline, btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { logLoadError } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { formatDate, formatDateTime, isFuture } from "@/lib/format";
import { quoteStatus, surveyIssue, visitStatus } from "@/lib/labels";
import { directionsUrl } from "@/lib/geo";
import { sar, totals } from "@/lib/money";
import { brandNames } from "@/lib/brands";
import VisitReport from "../run/VisitReport";
import { completeSurvey, reopenSurvey, setSurveyVat, startSurvey } from "../../survey-actions";
import { createQuoteFromVisit, revokeShareLink } from "../../../quotes/actions";
import { deleteAttachment } from "../../../attachments/actions";

export const metadata = { title: "زيارة معاينة | عين السلامة" };

type V = {
  id: string; ref_no: string; visit_type: string; status: string; closed_at: string | null; scheduled_start: string; actual_start: string | null; actual_end: string | null;
  notes: string | null; summary: string | null; recommendations: string | null; technician_notes: string | null; survey_vat: boolean; updated_at: string;
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  site: { id: string; name: string; city: string | null; address: string | null; contact_name: string | null; contact_phone: string | null; latitude: number | null; longitude: number | null;
    devices: { id: string; name: string; ref_no: string; archived_at: string | null }[] } | null;
};

/**
 * زيارة المعاينة في شاشة واحدة: البدء، تسجيل الأجهزة/الأنظمة ومشاكلها وتكلفتها، الصور، النتيجة والتوصيات، ثم الإنهاء.
 * بعد الإنهاء: تقرير قابل للطباعة/PDF والمشاركة، وتحويله إلى عرض سعر بضغطة.
 */
export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("visits.view", "visits.create", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const canQuote = ctx.canAny("quotes.manage", "quotes.create");
  const [{ data: raw }, techs, items, files, quotes, links, brands] = await Promise.all([
    supabase.from("visits").select("id, ref_no, visit_type, status, closed_at, scheduled_start, actual_start, actual_end, notes, summary, recommendations, technician_notes, survey_vat, updated_at, "
      + "customer:customers(id, name, email, phone), site:customer_sites(id, name, city, address, contact_name, contact_phone, latitude, longitude, devices(id, name, ref_no, archived_at))")
      .eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("visit_technicians").select("technician:technicians(full_name, phone)").eq("company_id", ctx.orgId).eq("visit_id", id),
    supabase.from("survey_items").select("id, title, issue_type, description, quantity, unit_price, device_id, brand, sort_order").eq("company_id", ctx.orgId).eq("visit_id", id).order("sort_order").order("created_at"),
    supabase.from("attachments").select("id, file_name, mime_type, survey_item_id, photo_stage, created_by, created_at").eq("company_id", ctx.orgId).eq("entity_type", "visit").eq("entity_id", id).order("created_at"),
    ctx.canAny("quotes.view", "quotes.manage", "quotes.create") ? supabase.from("quotations").select("id, ref_no, status").eq("company_id", ctx.orgId).eq("visit_id", id).is("archived_at", null) : null,
    supabase.from("share_links").select("id, created_at, expires_at, revoked_at").eq("company_id", ctx.orgId).eq("kind", "survey").eq("entity_id", id).order("created_at", { ascending: false }).limit(10),
    brandNames(supabase, ctx.orgId),
  ]);
  const v = raw as unknown as V | null;
  if (!v) notFound();
  if (v.visit_type !== "survey") redirect(`/visits/${id}`);

  const closed = !!v.closed_at;
  const cancelled = v.status === "cancelled";
  const canWork = ctx.can("visits.update") && !closed && !cancelled;
  const lines = (items.data ?? []) as { id: string; title: string; issue_type: string; description: string | null; quantity: number; unit_price: number; device_id: string | null; brand: string | null }[];
  const vatRate = v.survey_vat ? 15 : 0;
  const t = totals(lines, vatRate);
  const devices = (v.site?.devices ?? []).filter((d) => !d.archived_at).map((d) => ({ value: d.id, label: `${d.name} (${d.ref_no})` }));
  const photos = files.data ?? [];
  const itemName = new Map(lines.map((l) => [l.id, l.title]));
  const quote = quotes?.data?.[0] ?? null;
  const techNames = (techs.data ?? []).map((r) => (r.technician as unknown as { full_name: string } | null)?.full_name).filter(Boolean).join("، ");
  const activeLinks = (links.data ?? []).filter((l) => !l.revoked_at && isFuture(l.expires_at));
  const back = `/visits/${id}/survey`;
  const loadErr = logLoadError("survey/items", items.error) || logLoadError("survey/files", files.error);

  return (
    <div className="space-y-5">
      <Flash />
      <PageHeader title={`معاينة ${v.ref_no}`} crumbs={[{ label: "الزيارات والمعاينات", href: "/visits" }, { label: v.ref_no }]}
        description={<>{v.customer ? <Link href={`/customers/${v.customer.id}`} className={link}>{v.customer.name}</Link> : "—"} · {v.site?.name ?? "—"}</>}
        actions={<>
          {closed && <Link href={`/print/survey/${id}`} target="_blank" className={btnSecondary}>طباعة التقرير / PDF</Link>}
          {quote ? <Link href={`/quotes/${quote.id}`} className={btnPrimary}>عرض السعر {quote.ref_no}</Link>
            : closed && canQuote && <ActionButton action={createQuoteFromVisit} hidden={{ visit_id: id }} label="تحويل إلى عرض سعر" pendingLabel="جارٍ الإنشاء..." className={btnPrimary} />}
        </>} />

      {/* شريط الحالة والخطوات */}
      <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} />
          <span>الموعد: <b>{formatDateTime(v.scheduled_start)}</b></span>
          <span>الفني: <b>{techNames || "لم يُحدد"}</b></span>
          {v.site?.latitude != null && v.site.longitude != null && (
            <a href={directionsUrl({ lat: v.site.latitude, lng: v.site.longitude })} target="_blank" rel="noopener noreferrer" className={link}>الاتجاهات إلى الفرع ↗</a>
          )}
          {v.site?.contact_phone && <a href={`tel:${v.site.contact_phone}`} className={link} dir="ltr">{v.site.contact_phone}</a>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWork && v.status === "scheduled" && <ActionButton action={startSurvey} hidden={{ visit_id: id }} label="بدء المعاينة" className={btnPrimary} />}
          {quote && <StatusBadge {...(quoteStatus[quote.status] ?? { label: quote.status, tone: "neutral" })} />}
        </div>
      </section>
      {v.notes && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>ملاحظات للفني:</b> {v.notes}</p>}
      {loadErr && <p role="alert" className="text-sm text-red-700">تعذر تحميل جزء من البيانات{loadErr}. أعد تحميل الصفحة.</p>}

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>1. الأجهزة والأنظمة والتكلفة التقديرية ({lines.length})</h2>
          {canWork ? (
            <ActionButton action={setSurveyVat} hidden={{ visit_id: id, vat: v.survey_vat ? "0" : "1" }}
              label={v.survey_vat ? "✓ يشمل ضريبة 15٪ — إلغاء" : "إضافة ضريبة 15٪"} className={`${btnSecondary} ${btnSm}`} />
          ) : <span className="text-xs text-slate-500">{v.survey_vat ? "يشمل ضريبة القيمة المضافة 15٪" : "بدون ضريبة"}</span>}
        </div>
        <div className="p-4">
          <SurveyItems visitId={id} lines={lines} devices={devices} vatRate={vatRate} locked={!canWork} brands={brands} canAddBrand={ctx.canAny("catalog.manage", "quotes.manage")} />
        </div>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>2. الصور ({photos.length})</h2></div>
        <div className="space-y-4 p-5">
          <ul className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <li key={p.id} className="w-28 overflow-hidden rounded-lg border border-slate-200 bg-white text-[10px] text-slate-600">
                {p.mime_type?.startsWith("image/")
                  ? <a href={`/files/${p.id}`} target="_blank" rel="noopener noreferrer"><SafeImage src={`/files/${p.id}`} alt={p.file_name} className="h-20 w-full object-cover" /></a>
                  : <a href={`/files/${p.id}`} target="_blank" rel="noopener noreferrer" className="flex h-20 items-center justify-center bg-slate-50 font-bold">PDF</a>}
                <div className="space-y-0.5 p-1">
                  <p className="truncate font-semibold">{p.survey_item_id ? itemName.get(p.survey_item_id) ?? "بند" : "عامة"}</p>
                  {(ctx.can("visits.delete") || (!closed && p.created_by === ctx.user.id)) && (
                    <ActionButton action={deleteAttachment} hidden={{ attachment_id: p.id, back }} label="حذف" confirm={`حذف «${p.file_name}» نهائيًا؟`}
                      className={`${btnDangerOutline} !px-2 !py-0.5 !text-[10px]`} />
                  )}
                </div>
              </li>
            ))}
            {photos.length === 0 && <li className="text-sm text-slate-500">لا توجد صور بعد.</li>}
          </ul>
          {canWork && <UploadForm entityType="visit" entityId={id} stages={["general", "fault", "other"]} surveyItems={lines.map((l) => ({ id: l.id, name: l.title }))} />}
          {canWork && <p className="text-xs text-slate-500">التقط الصور من كاميرا الجوال مباشرة، واربط كل صورة بالبند الذي توثّقه لتظهر بجانبه في التقرير.</p>}
        </div>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>3. نتيجة المعاينة والملاحظات والتوصيات</h2></div>
        <div className="p-5">
          {ctx.can("visits.update") ? (
            <VisitReport visitId={id} closed={closed || cancelled} savedAt={v.updated_at}
              initial={{ summary: v.summary ?? "", notes: v.technician_notes ?? "", recommendations: v.recommendations ?? "" }} />
          ) : (
            <div className="space-y-2 text-sm">
              <p><b>النتيجة:</b> {v.summary || "—"}</p><p><b>التوصيات:</b> {v.recommendations || "—"}</p>
            </div>
          )}
        </div>
      </section>

      {/* الإنهاء والملخص */}
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>4. {closed ? "المعاينة منتهية" : "إنهاء المعاينة"}</h2></div>
        <div className="space-y-3 p-5 text-sm">
          <ul className="grid gap-2 sm:grid-cols-4">
            <li className="rounded-lg bg-slate-50 p-3">البنود: <b>{lines.length}</b></li>
            <li className="rounded-lg bg-slate-50 p-3">الصور: <b>{photos.length}</b></li>
            <li className="rounded-lg bg-slate-50 p-3">قبل الضريبة: <b>{sar(t.subtotal)}</b></li>
            <li className="rounded-lg bg-brand-soft/50 p-3">الإجمالي: <b>{sar(t.total)}</b></li>
          </ul>
          {lines.length > 0 && (
            <p className="text-xs text-slate-600">
              {Object.entries(lines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.issue_type]: (a[l.issue_type] ?? 0) + 1 }), {}))
                .map(([k, n]) => `${surveyIssue[k] ?? k}: ${n}`).join(" · ")}
            </p>
          )}
          {closed ? (
            <>
              <p className="text-green-800">انتهت في {formatDateTime(v.closed_at!)}. البنود والصور مجمّدة كتوثيق.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/print/survey/${id}`} target="_blank" className={btnSecondary}>طباعة التقرير / حفظ PDF</Link>
                {quote ? <Link href={`/quotes/${quote.id}`} className={btnPrimary}>فتح عرض السعر {quote.ref_no}</Link>
                  : canQuote && <ActionButton action={createQuoteFromVisit} hidden={{ visit_id: id }} label="تحويل إلى عرض سعر" pendingLabel="جارٍ الإنشاء..." className={btnPrimary} />}
              </div>
              {ctx.can("visits.create") && quote?.status !== "accepted" && (
                <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">إعادة فتح المعاينة للتعديل</summary>
                  <div className="p-3 pt-0">
                    <EntityForm action={reopenSurvey} submitLabel="إعادة الفتح" initial={{ visit_id: id }}
                      fields={[{ name: "visit_id", label: "", type: "hidden" }, { name: "reason", label: "سبب إعادة الفتح", required: true, wide: true }]} />
                  </div>
                </details>
              )}
            </>
          ) : canWork ? (
            <>
              <p className="text-slate-600">بعد الإنهاء تتجمد البنود والصور، ويصبح التقرير جاهزًا للطباعة والمشاركة والتحويل إلى عرض سعر.</p>
              <ActionButton action={completeSurvey} hidden={{ visit_id: id }} label="إنهاء المعاينة واعتماد التقرير" className={btnPrimary}
                confirm={`إنهاء المعاينة بـ ${lines.length} بند وإجمالي ${sar(t.total)}؟`} />
            </>
          ) : <p className="text-slate-500">{cancelled ? "المعاينة ملغاة." : "لا تملك صلاحية تنفيذ هذه المعاينة."}</p>}
        </div>
      </section>

      {closed && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>مشاركة تقرير المعاينة مع العميل</h2></div>
          <div className="space-y-4 p-5">
            <ShareBox kind="survey" id={id} title={`تقرير معاينة ${v.ref_no} — ${v.customer?.name ?? ""}`} customerEmail={v.customer?.email} />
            {activeLinks.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
                {activeLinks.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>رابط أُنشئ {formatDate(l.created_at)} · ينتهي {formatDate(l.expires_at)}</span>
                    <ActionButton action={revokeShareLink} hidden={{ link_id: l.id, back }} label="إلغاء الرابط" confirm="إلغاء هذا الرابط؟ لن يفتح للعميل بعد الآن."
                      className={`${btnDangerOutline} !px-2 !py-0.5 !text-[10px]`} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
