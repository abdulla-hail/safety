import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import EntityForm from "@/components/ui/EntityForm";
import AttachmentList from "@/components/attachments/AttachmentList";
import { btnPrimary, btnSecondary, card, cardHeader, cardTitle, input, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { daysUntil, dueStatus, formatDate, formatDateTime, intervalLabel, toLocalInput } from "@/lib/format";
import { deviceStatus, faultSeverity, faultSource, faultStatus, maintenanceAction, maintenanceKind, maintenanceResult, toOptions } from "@/lib/labels";
import { reportFault } from "../../faults/actions";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import { INSPECTION_STATUS, mergeTimeline, type TimelineEvent } from "@/lib/visits";
import { barcodeSvg, deviceScanPath, qrSvg, siteUrl } from "@/lib/codes";
import { LABEL_SIZES } from "@/lib/label-sizes";
import { addMaintenance, correctMaintenance, moveDevice, setNextDue } from "../actions";
import StartVisitButton from "../../my-work/StartVisitButton";

export const metadata = { title: "بطاقة الجهاز | عين السلامة" };

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const DUE: Record<string, { label: string; tone: Tone }> = {
  none: { label: "بلا جدول", tone: "neutral" }, upcoming: { label: "قادم", tone: "success" }, due_soon: { label: "قريب الاستحقاق", tone: "warning" },
  due: { label: "مستحق اليوم", tone: "warning" }, overdue: { label: "متأخر", tone: "danger" },
};
const CYCLE: Record<string, { label: string; tone: Tone }> = {
  ...DUE, completed: { label: "مكتمل", tone: "success" }, cancelled: { label: "ملغى", tone: "neutral" }, superseded: { label: "أُعيدت جدولته", tone: "info" },
};

export default async function DevicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const imageFailed = param(await searchParams, "img") === "failed";
  const ctx = await requireOrg("devices.view", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const mayLog = ctx.can("maintenance.create");
  // جولة واحدة: الجهاز (مع زيارات عميله المفتوحة مضمّنة عند الحاجة) وسجل الصيانة والفنيين معًا
  let deviceQ = supabase.from("devices")
    .select(`*, company:companies(maintenance_alert_days), customer:customers(id, name${mayLog ? ", visits(id, ref_no, scheduled_start, status, archived_at)" : ""}), site:customer_sites(id, name), system:safety_systems(id, name), item:catalog_items(id, name, ref_no, specs)`)
    .eq("id", id).eq("company_id", ctx.orgId);
  if (mayLog) deviceQ = deviceQ.in("customer.visits.status", ["scheduled", "in_progress"]).is("customer.visits.archived_at", null)
    .order("scheduled_start", { referencedTable: "customer.visits", ascending: false }).limit(10, { referencedTable: "customer.visits" });
  const mayMove = ctx.can("devices.update");
  // أعمدة المرحلة الخامسة (القراءات، التصحيحات، البلاغات) تُطلب فقط بعد تطبيق ترحيلها
  const [phase5, inspections] = await Promise.all([hasPhase5(supabase), hasInspections(supabase)]);
  const historyCols = "id, ref_no, performed_at, action, kind, result, status_after, notes, next_due_at, visit_id, techs:maintenance_record_technicians(technician:technicians(full_name))"
    + (phase5 ? ", condition_before, readings, actions_taken, recommendations, corrections:maintenance_corrections(id, field, old_value, new_value, reason, corrected_at)" : "");
  const statusOptions = toOptions(deviceStatus).filter((o) => phase5 || !["faulty", "replaced"].includes(o.value));
  const mayTransfer = ctx.can("devices.transfer");
  const [{ data: d }, history, techs, transfers, moveSites, cycles, faults, skipped, dueChanges] = await Promise.all([
    deviceQ.maybeSingle(),
    supabase.from("maintenance_records")
      .select(historyCols)
      .eq("company_id", ctx.orgId).eq("device_id", id).order("performed_at", { ascending: false }).limit(50),
    mayLog ? supabase.from("technicians").select("id, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name") : null,
    supabase.from("device_transfers")
      .select("id, moved_at, reason, from_customer_id, to_customer_id, from_site:customer_sites!dt_from_site_fk(name), to_site:customer_sites!dt_to_site_fk(name), from_customer:customers!dt_from_customer_fk(name), to_customer:customers!dt_to_customer_fk(name)")
      .eq("company_id", ctx.orgId).eq("device_id", id).order("moved_at", { ascending: false }).limit(50),
    // مواقع النقل: مواقع العميل نفسه، أو كل مواقع الشركة لمن يملك النقل بين العملاء (تُصفّى بعد معرفة العميل)
    mayMove ? supabase.from("customer_sites").select("id, name, customer_id, customer:customers(name)").eq("company_id", ctx.orgId).is("archived_at", null).order("name").limit(500) : null,
    supabase.from("device_maintenance_cycles").select("id, due_date, status, completed_on, days_late, completed_record_id")
      .eq("company_id", ctx.orgId).eq("device_id", id).order("due_date", { ascending: false }).limit(24),
    phase5 ? supabase.from("device_faults").select("id, ref_no, description, status, severity, reported_at, resolved_at")
      .eq("company_id", ctx.orgId).eq("device_id", id).order("reported_at", { ascending: false }).limit(40) : null,
    // زيارات مغلقة لم يُفحص فيها الجهاز (بسبب): جزء من تاريخه دون أن تُحتسب فحصًا
    inspections ? supabase.from("visit_devices").select("id, inspection_status, skip_reason, inspected_at, visit:visits!inner(id, ref_no, closed_at)")
      .eq("device_id", id).in("inspection_status", ["unable", "not_found"]).not("visit.closed_at", "is", null).limit(30) : null,
    inspections ? supabase.from("device_due_changes").select("id, old_date, new_date, source, reason, changed_at")
      .eq("device_id", id).order("changed_at", { ascending: false }).limit(40) : null,
  ]);
  const openFaults = { data: (faults?.data ?? []).filter((f) => ["open", "in_progress", "awaiting_verification"].includes(f.status)), error: faults?.error };
  if (!d) notFound();
  type T = { id: string; moved_at: string; reason: string; from_customer_id: string; to_customer_id: string; from_site: { name: string } | null; to_site: { name: string } | null; from_customer: { name: string } | null; to_customer: { name: string } | null };
  type MS = { id: string; name: string; customer_id: string; customer: { name: string } | null };
  const siteOptions = ((moveSites?.data ?? []) as unknown as MS[])
    .filter((s) => s.id !== d.site_id && (mayTransfer || s.customer_id === d.customer_id))
    .sort((a, b) => Number(b.customer_id === d.customer_id) - Number(a.customer_id === d.customer_id))
    .map((s) => ({ value: s.id, label: s.customer_id === d.customer_id ? s.name : `${s.customer?.name ?? "عميل آخر"} — ${s.name} (عميل آخر)` }));
  const canLog = mayLog && !d.archived_at;
  const alertDays = (d.company as { maintenance_alert_days?: number } | null)?.maintenance_alert_days ?? 14;
  const visits = { data: ((d.customer as { visits?: { id: string; ref_no: string; scheduled_start: string }[] } | null)?.visits ?? []) };
  const imageUrl = d.image_path ? `/device-image/${id}?v=${encodeURIComponent(d.image_path)}` : null;

  const url = `${await siteUrl()}${deviceScanPath(d.qr_token)}`;
  const [qr, barcode] = [await qrSvg(url), barcodeSvg(d.qr_token)];
  const due = daysUntil(d.next_maintenance_at);
  type H = {
    id: string; ref_no: string; performed_at: string; action: string; kind: string | null; result: string; status_after: string; condition_before: string | null;
    readings: Record<string, string> | null; actions_taken: string | null; recommendations: string | null; notes: string | null; next_due_at: string | null;
    visit_id: string | null; techs: { technician: { full_name: string } | null }[];
    corrections: { id: string; field: string; old_value: unknown; new_value: unknown; reason: string; corrected_at: string }[] | null;
  };
  const mayCorrect = ctx.can("maintenance.correct");

  // الخط الزمني: سجلات الفحص والصيانة (غير قابلة للتعديل)، الزيارات التي لم يُفحص فيها، البلاغات، النقل، وتغييرات الموعد — الأحدث أولًا
  const SRC: Record<string, string> = { manual: "تعديل يدوي", visit_override: "تعديل عند الإغلاق", schedule: "تطبيق جدول", maintenance: "بعد صيانة دورية", system: "النظام" };
  const timeline = mergeTimeline(
    ((history.data ?? []) as unknown as H[]).map((h) => ({ at: h.performed_at, kind: "maintenance", tone: h.result === "fail" ? "danger" : h.result === "pass" ? "success" : "warning",
      title: `${maintenanceAction[h.action] ?? h.action}${h.kind ? ` (${maintenanceKind[h.kind] ?? h.kind})` : ""} — ${maintenanceResult[h.result]?.label ?? h.result}`,
      detail: `الحالة بعد: ${deviceStatus[h.status_after]?.label ?? h.status_after}${h.next_due_at ? ` · القادمة ${formatDate(h.next_due_at)}` : ""}`,
      href: h.visit_id ? `/visits/${h.visit_id}` : null })),
    ((skipped?.data ?? []) as unknown as { id: string; inspection_status: string; skip_reason: string | null; inspected_at: string | null; visit: { id: string; ref_no: string; closed_at: string } | null }[])
      .map((s) => ({ at: s.inspected_at ?? s.visit?.closed_at ?? "", kind: "skipped", tone: "warning",
        title: `${INSPECTION_STATUS[s.inspection_status as keyof typeof INSPECTION_STATUS]?.label ?? s.inspection_status} في الزيارة ${s.visit?.ref_no ?? ""}`,
        detail: s.skip_reason, href: s.visit ? `/visits/${s.visit.id}` : null })),
    ((faults?.data ?? []) as { id: string; ref_no: string; description: string; status: string; reported_at: string }[])
      .map((x) => ({ at: x.reported_at, kind: "fault", tone: "danger", title: `بلاغ ${x.ref_no} — ${faultStatus[x.status]?.label ?? x.status}`, detail: x.description.slice(0, 160), href: `/faults/${x.id}` })),
    ((transfers.data ?? []) as unknown as T[]).map((t) => ({ at: t.moved_at, kind: "transfer", tone: "info",
      title: `نقل من «${t.from_site?.name ?? "بلا موقع"}» إلى «${t.to_site?.name ?? "—"}»`, detail: t.reason })),
    ((dueChanges?.data ?? []) as { id: string; old_date: string | null; new_date: string | null; source: string; reason: string | null; changed_at: string }[])
      .map((c) => ({ at: c.changed_at, kind: "due", tone: "neutral", title: `الموعد القادم: ${formatDate(c.old_date)} ← ${formatDate(c.new_date)}`,
        detail: [SRC[c.source] ?? c.source, c.reason].filter(Boolean).join(" · ") })),
  ).filter((e: TimelineEvent) => e.at);
  const DOT: Record<string, string> = { success: "bg-success", danger: "bg-danger", warning: "bg-amber-500", info: "bg-sky-500", neutral: "bg-slate-400" };

  return (
    <div className="space-y-6">
      <PageHeader title={d.name} refNo={d.ref_no}
        crumbs={[{ label: "الأجهزة", href: "/devices" }, { label: d.customer?.name ?? "—", href: `/customers/${d.customer_id}` }, { label: d.name }]}
        description={d.archived_at ? `مؤرشف منذ ${formatDate(d.archived_at)} — الرمز يبقى محجوزًا لهذا الجهاز` : undefined}
        actions={<>
          {ctx.can("reports.print") && <Link href={`/print/device/${id}`} className={btnSecondary}>طباعة بطاقة الجهاز</Link>}
          {ctx.can("devices.update") && <Link href={`/devices/${id}/edit`} className={btnPrimary}>تعديل</Link>}
          <RecordActions table="devices" id={id} archived={!!d.archived_at} back={`/devices/${id}`} listPath="/devices" noun="الجهاز"
            canArchive={ctx.can("devices.archive")} canDelete={ctx.can("devices.delete")} />
        </>} />

      {imageFailed && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          سُجّل الجهاز بنجاح، لكن تعذر رفع صورته (تحقق من الصلاحية ونوع الملف وحجمه).
          {ctx.can("devices.update") && <> يمكنك إضافتها من <Link href={`/devices/${id}/edit`} className="underline">تعديل الجهاز</Link>.</>}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <section className={`${card} xl:col-span-2`}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>بطاقة الجهاز</h2>
            <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
          </div>
          {imageUrl && (
            <div className="border-b border-slate-100 p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={`صورة ${d.name}`} className="mx-auto max-h-64 rounded-lg border border-slate-200 object-contain" />
            </div>
          )}
          <InfoGrid items={[
            ["العميل", d.customer && <Link href={`/customers/${d.customer.id}`} className={link}>{d.customer.name}</Link>],
            ["الموقع", d.site ? <Link href={`/sites/${d.site.id}`} className={link}>{d.site.name}</Link> : "—"],
            ["الموقع الدقيق", d.location_detail],
            ["نظام السلامة", d.system?.name],
            ["تعريف الكتالوج", d.item ? <span>{d.item.name} <span className="font-mono text-xs text-slate-500" dir="ltr">{d.item.ref_no}</span></span> : "إدخال يدوي"],
            ["النوع", d.device_type],
            ["الشركة المصنعة", d.manufacturer], ["الموديل", d.model && <span dir="ltr">{d.model}</span>],
            ["الرقم التسلسلي", d.serial_number && <span dir="ltr">{d.serial_number}</span>],
            ["السعة / المواصفة", d.capacity], ["تاريخ التركيب", formatDate(d.installed_at)], ["انتهاء الصلاحية", formatDate(d.expires_at)],
            ["فترة الصيانة الدورية", intervalLabel(d.maintenance_interval_months, d.maintenance_interval_days)],
            ["بداية الجدول", formatDate(d.schedule_start_date)],
            ["آخر صيانة", formatDate(d.last_maintenance_at)],
            ["الصيانة القادمة", <span key="n" className={due !== null && due < 0 ? "font-bold text-danger" : ""}>{formatDate(d.next_maintenance_at)}{due !== null && (due < 0 ? ` (متأخرة ${-due} يومًا)` : ` (بعد ${due} يومًا)`)}</span>],
            ["ملاحظات", d.notes],
          ]} />
        </section>

        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>رمز الجهاز</h2></div>
          <div className="space-y-3 p-5 text-center">
            <div className="mx-auto w-44 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={`رمز QR للجهاز ${d.ref_no}`} />
            <p className="font-mono text-sm font-bold" dir="ltr">{d.ref_no}</p>
            <div className="mx-auto w-52 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: barcode }} role="img" aria-label="باركود" />
            <p className="font-mono text-xs tracking-widest text-slate-500" dir="ltr">{d.qr_token}</p>
            <p className="text-xs text-slate-500">الرمز ثابت ومرتبط بهذا الجهاز فقط، ويفتح صفحته بعد تسجيل الدخول والتحقق من الصلاحية.</p>
            {ctx.can("devices.print") && (
              <form action="/print/labels" method="get" className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <input type="hidden" name="ids" value={id} />
                <label htmlFor="sz" className="sr-only">المقاس</label>
                <select id="sz" name="size" defaultValue="50x30" className={`${input} !w-auto text-xs`}>
                  {LABEL_SIZES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <button type="submit" className={btnSecondary}>طباعة / إعادة طباعة الملصق</button>
              </form>
            )}
          </div>
        </section>
      </div>

      {inspections && !d.archived_at && ctx.canAny("visits.update", "visits.create") && d.site_id && (
        <section className={`${card} flex flex-wrap items-center gap-3 p-5`}>
          <p className="me-auto text-sm text-slate-600">تُسجَّل نتائج الفحص والإصلاح من خلال زيارة، حتى ترتبط بتقريرها وبسجل الجهاز.</p>
          <StartVisitButton siteId={d.site_id} clientKey={crypto.randomUUID()} label="الزيارة الدورية للموقع" className={btnSecondary} />
          <Link href={`/my-work/urgent?device=${id}`} className={btnPrimary}>زيارة طارئة لهذا الجهاز</Link>
        </section>
      )}

      {inspections && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الخط الزمني للجهاز ({timeline.length})</h2>
            <span className="text-xs text-slate-500">الأحدث أولًا · السجلات السابقة لا تتغير بتغيّر الحالة الحالية</span></div>
          <ol className="relative space-y-4 p-5 ps-8">
            <span aria-hidden="true" className="absolute inset-y-5 start-[1.4rem] w-px bg-slate-200" />
            {timeline.slice(0, 60).map((e, i) => (
              <li key={i} className="relative text-sm">
                <span aria-hidden="true" className={`absolute -start-[0.95rem] top-1.5 size-2.5 rounded-full ring-2 ring-white ${DOT[e.tone ?? "neutral"]}`} />
                <p className="font-semibold">{e.href ? <Link href={e.href} className={link}>{e.title}</Link> : e.title}</p>
                <p className="text-xs text-slate-500">{formatDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ""}</p>
              </li>
            ))}
            {timeline.length === 0 && <li className="text-sm text-slate-500">لا توجد أحداث مسجلة لهذا الجهاز بعد.</li>}
          </ol>
        </section>
      )}

      {canLog && !inspections && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>تسجيل عملية صيانة</h2></div>
          <div className="p-5">
            <EntityForm action={addMaintenance} submitLabel="حفظ عملية الصيانة"
              initial={{ device_id: id, client_id: crypto.randomUUID(), performed_at: toLocalInput(new Date().toISOString()), action: "inspection", result: "pass", status_after: "operational" }}
              fields={[
                { name: "device_id", label: "", type: "hidden" },
                { name: "client_id", label: "", type: "hidden" },
                { name: "action", label: "نوع العملية", type: "select", required: true, options: toOptions(maintenanceAction) },
                { name: "kind", label: "تصنيفها", type: "select", options: [{ value: "", label: "تلقائي حسب نوع العملية" }, ...toOptions(maintenanceKind)],
                  help: "الصيانة الدورية وحدها تُتم الاستحقاق وتحسب الموعد القادم؛ الإصلاح لا يغيّره." },
                { name: "result", label: "نتيجة الفحص", type: "select", required: true, options: toOptions(maintenanceResult) },
                { name: "status_after", label: "حالة الجهاز بعد العملية", type: "select", required: true, options: statusOptions },
                { name: "performed_at", label: "تاريخ ووقت التنفيذ", type: "datetime-local", required: true },
                { name: "visit_id", label: "مرتبطة بزيارة", type: "select", options: (visits?.data ?? []).map((v) => ({ value: v.id, label: `${v.ref_no} — ${formatDateTime(v.scheduled_start)}` })) },
                { name: "next_due_at", label: "موعد الصيانة القادمة (اختياري)", type: "date", help: "للصيانة الدورية يُحسب تلقائيًا إن تُرك فارغًا؛ للإصلاح يعيد الجدولة فقط إن حُدد." },
                { name: "technician_ids", label: "الفنيون المنفذون", type: "checkboxes", options: (techs?.data ?? []).map((t) => ({ value: t.id, label: t.full_name })) },
                { name: "readings", label: "القراءات (سطر لكل قراءة: الاسم = القيمة)", type: "textarea", placeholder: "الضغط = 12 بار\nالوزن = 6 كجم", wide: true },
                { name: "actions_taken", label: "الإجراءات المنفذة", type: "textarea" },
                { name: "recommendations", label: "التوصيات", type: "textarea" },
                { name: "notes", label: "ملاحظات الفني", type: "textarea" },
              ]} />
          </div>
        </section>
      )}

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>سجل الصيانة ({history.data?.length ?? 0})</h2>
          <Link href={`/maintenance?device=${id}`} className={`${link} text-xs`}>عرض في سجلات الصيانة</Link></div>
        <ol className="divide-y divide-slate-100">
          {((history.data ?? []) as unknown as H[]).map((h) => (
            <li key={h.id} className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <p className="font-semibold">{maintenanceAction[h.action] ?? h.action}{h.kind && <span className="text-xs font-normal text-slate-500"> · {maintenanceKind[h.kind] ?? h.kind}</span>} <span className="font-mono text-xs text-slate-500" dir="ltr">{h.ref_no}</span></p>
                <p className="text-xs text-slate-500">{formatDateTime(h.performed_at)} · {h.techs.map((t) => t.technician?.full_name).filter(Boolean).join("، ") || "—"}
                  {h.condition_before && ` · الحالة عند الفحص: ${deviceStatus[h.condition_before]?.label ?? h.condition_before}`}
                  {h.visit_id && <> · <Link href={`/visits/${h.visit_id}`} className="underline">الزيارة</Link></>}</p>
                {h.readings && Object.keys(h.readings).length > 0 && (
                  <p className="text-xs text-slate-700">القراءات: {Object.entries(h.readings).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
                )}
                {h.actions_taken && <p className="text-xs text-slate-700">الإجراءات: {h.actions_taken}</p>}
                {h.recommendations && <p className="text-xs text-slate-700">التوصيات: {h.recommendations}</p>}
                {h.notes && <p className="text-slate-700">{h.notes}</p>}
                {(h.corrections ?? []).map((x) => (
                  <p key={x.id} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    تصحيح {formatDateTime(x.corrected_at)} — {x.field}: {JSON.stringify(x.old_value)} ← {JSON.stringify(x.new_value)} · السبب: {x.reason}
                  </p>
                ))}
                {mayCorrect && phase5 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-primary">تصحيح موثق</summary>
                    <div className="mt-2">
                      <EntityForm action={correctMaintenance} submitLabel="حفظ التصحيح" initial={{ record_id: h.id, device_id: id, field: "notes" }}
                        fields={[
                          { name: "record_id", label: "", type: "hidden" },
                          { name: "device_id", label: "", type: "hidden" },
                          { name: "field", label: "الحقل", type: "select", required: true, options: [
                            { value: "result", label: "النتيجة (pass / pass_with_notes / fail)" }, { value: "notes", label: "الملاحظات" },
                            { value: "actions_taken", label: "الإجراءات" }, { value: "recommendations", label: "التوصيات" }] },
                          { name: "new_value", label: "القيمة الصحيحة", type: "textarea", required: true },
                          { name: "reason", label: "سبب التصحيح", type: "textarea", required: true },
                        ]} />
                      <p className="mt-1 text-[11px] text-slate-500">السجل الأصلي لا يتغير؛ يُحفظ التصحيح مع اسمك وسببه وتاريخه.</p>
                    </div>
                  </details>
                )}
              </div>
              <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                <StatusBadge {...(maintenanceResult[h.result] ?? { label: h.result, tone: "neutral" })} />
                <span className="text-xs text-slate-500">القادمة: {formatDate(h.next_due_at)}</span>
              </div>
            </li>
          ))}
          {history.error ? <li role="alert" className="px-5 py-6 text-sm text-red-700">تعذر تحميل سجل الصيانة حاليًا. أعد تحميل الصفحة.</li>
            : (history.data ?? []).length === 0 && <li className="px-5 py-6 text-sm text-slate-500">لا توجد عمليات صيانة مسجلة بعد.</li>}
        </ol>
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>استحقاقات الصيانة الدورية</h2>
          <StatusBadge {...DUE[dueStatus(d.next_maintenance_at, alertDays)]} /></div>
        <ol className="divide-y divide-slate-100">
          {((cycles.data ?? []) as { id: string; due_date: string; status: string; completed_on: string | null; days_late: number | null }[]).map((y) => (
            <li key={y.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
              <span>الاستحقاق {formatDate(y.due_date)}{y.completed_on && ` · أُنجز ${formatDate(y.completed_on)}`}{y.days_late ? ` · بتأخير ${y.days_late} يوم` : ""}</span>
              <StatusBadge {...(CYCLE[y.status === "open" ? dueStatus(y.due_date, alertDays) : y.status] ?? { label: y.status, tone: "neutral" })} />
            </li>
          ))}
          {cycles.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل الاستحقاقات حاليًا.</li>
            : (cycles.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد استحقاقات مسجلة (الجهاز بلا فترة صيانة).</li>}
        </ol>
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">يُتم الاستحقاق فقط بتسجيل صيانة دورية مكتملة؛ الاستحقاق المتأخر يبقى مسجلًا بأيام تأخيره، والإصلاح الطارئ لا يغيّر الموعد.</p>
        {inspections && ctx.can("maintenance.reschedule") && !d.archived_at && d.status !== "decommissioned" && (
          <details className="border-t border-slate-200">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">تعديل موعد الصيانة القادمة (موثق)</summary>
            <div className="p-5 pt-0">
              <EntityForm action={setNextDue} submitLabel="حفظ الموعد الجديد" initial={{ device_id: id, next_due: d.next_maintenance_at ?? "" }}
                fields={[
                  { name: "device_id", label: "", type: "hidden" },
                  { name: "next_due", label: "الموعد الجديد", type: "date", required: true, help: `الحالي: ${formatDate(d.next_maintenance_at)}` },
                  { name: "reason", label: "سبب التعديل", type: "textarea", required: true, maxLength: 1000 },
                ]} />
              <p className="mt-2 text-xs text-slate-500">يُحفظ الموعد القديم والجديد والسبب واسمك في سجل الجهاز وسجل التدقيق، ويُستبدل الاستحقاق المفتوح دون حذفه.</p>
            </div>
          </details>
        )}
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>سجل نقل الجهاز ({transfers.data?.length ?? 0})</h2></div>
        <ol className="divide-y divide-slate-100">
          {((transfers.data ?? []) as unknown as T[]).map((t) => (
            <li key={t.id} className="px-5 py-3 text-sm">
              <p className="font-semibold">
                {t.from_customer_id !== t.to_customer_id && <span className="text-amber-800">نقل بين عميلين: {t.from_customer?.name ?? "—"} ← {t.to_customer?.name ?? "—"} · </span>}
                من «{t.from_site?.name ?? "بلا موقع"}» إلى «{t.to_site?.name ?? "—"}»
              </p>
              <p className="text-xs text-slate-500">{formatDateTime(t.moved_at)} · {t.reason}</p>
            </li>
          ))}
          {transfers.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل سجل النقل حاليًا.</li>
            : (transfers.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لم يُنقل الجهاز منذ تسجيله.</li>}
        </ol>
        {mayMove && !d.archived_at && (
          <details className="border-t border-slate-200">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">{d.site_id ? "نقل الجهاز إلى موقع آخر" : "تحديد موقع الجهاز"}</summary>
            <div className="p-5 pt-0">
              {siteOptions.length ? (
                <EntityForm action={moveDevice} submitLabel="تنفيذ النقل" initial={{ device_id: id, moved_at: toLocalInput(new Date().toISOString()) }}
                  fields={[
                    { name: "device_id", label: "", type: "hidden" },
                    { name: "to_site_id", label: "الموقع الجديد", type: "select", required: true, options: siteOptions },
                    { name: "moved_at", label: "تاريخ النقل", type: "datetime-local", required: true },
                    { name: "reason", label: "سبب النقل", type: "textarea", required: true, maxLength: 500, wide: true },
                  ]} />
              ) : (
                <p className="text-sm text-slate-600">لا توجد مواقع أخرى متاحة لهذا العميل. <Link href={`/customers/${d.customer_id}`} className={link}>أضف موقعًا للعميل</Link>.</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                يحتفظ الجهاز برقمه ورمز QR وسجل صيانته، وتبقى الزيارات وسجلات الصيانة السابقة مرتبطة بالموقع الذي حدثت فيه.
                {mayTransfer ? " النقل إلى عميل آخر عملية حساسة: لا تنتقل سجلات العميل السابق ولا تظهر لفنيي العميل الجديد." : ""}
              </p>
            </div>
          </details>
        )}
      </section>

      {phase5 && <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>البلاغات والأعطال ({openFaults.data.length})</h2>
          {ctx.canAny("faults.view", "field.assigned") && <Link href={`/faults?device=${id}&status=all`} className={`${link} text-xs`}>كل بلاغات الجهاز</Link>}</div>
        <ul className="divide-y divide-slate-100">
          {(openFaults.data as { id: string; ref_no: string; description: string; status: string; severity: string; reported_at: string }[]).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0"><Link href={`/faults/${f.id}`} className={link}>{f.ref_no}</Link> <span className="text-slate-700">{f.description.slice(0, 120)}</span>
                <p className="text-xs text-slate-500">{formatDateTime(f.reported_at)} · {faultSeverity[f.severity]?.label ?? f.severity}</p></div>
              <StatusBadge {...(faultStatus[f.status] ?? { label: f.status, tone: "neutral" })} />
            </li>
          ))}
          {openFaults.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل البلاغات حاليًا (تتطلب تطبيق المرحلة الخامسة).</li>
            : openFaults.data.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد بلاغات مفتوحة لهذا الجهاز.</li>}
        </ul>
        {ctx.can("faults.create") && !d.archived_at && (
          <details className="border-t border-slate-200">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">+ تسجيل بلاغ عطل</summary>
            <div className="p-5 pt-0">
              <EntityForm action={reportFault} submitLabel="تسجيل البلاغ" initial={{ device_id: id, severity: "medium", source: "technician" }}
                fields={[
                  { name: "device_id", label: "", type: "hidden" },
                  { name: "severity", label: "الخطورة", type: "select", required: true, options: toOptions(faultSeverity) },
                  { name: "source", label: "مصدر البلاغ", type: "select", options: toOptions(faultSource) },
                  { name: "description", label: "وصف العطل", type: "textarea", required: true, wide: true, maxLength: 2000 },
                ]} />
              <p className="mt-2 text-xs text-slate-500">البلاغ يُشعر الفني المسؤول والإدارة، ولا يغيّر حالة الجهاز أو موعد صيانته الدورية إلا بقرار صريح عند معالجته.</p>
            </div>
          </details>
        )}
      </section>}

      <AttachmentList entityType="device" entityId={id} deviceId={id} canUpload={ctx.canAny("devices.update", "devices.create") && !d.archived_at} />
    </div>
  );
}
