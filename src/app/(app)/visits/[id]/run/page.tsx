import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import EntityForm from "@/components/ui/EntityForm";
import ActionButton from "@/components/ui/ActionButton";
import MultiSelectForm from "@/components/ui/MultiSelectForm";
import PhasePending from "@/components/PhasePending";
import UploadForm, { PHOTO_STAGES } from "@/components/attachments/UploadForm";
import { btnDangerOutline, btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasInspections, hasWorkOrderExecution } from "@/lib/schema";
import { logLoadError } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { dueStatus, formatDateTime, todayISO } from "@/lib/format";
import { deviceStatus, faultSeverity, faultStatus, maintenanceAction, maintenanceResult, toOptions, visitOutcome, visitType, workOrderPriority } from "@/lib/labels";
import { URGENT_REASONS, closeSummary, computeNextDue, partsText, progressPercent, type Part } from "@/lib/visits";
import { addVisitDevices, closeVisit, removeVisitDevice, reportVisitFault } from "../../../my-work/actions";
import { deleteAttachment } from "../../../attachments/actions";
import ItemCard, { type ItemView } from "./ItemCard";
import VisitReport from "./VisitReport";

export const metadata = { title: "تنفيذ الزيارة | عين السلامة" };

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const DUE: Record<string, { label: string; tone: Tone } | null> = {
  none: null, upcoming: { label: "غير مستحق", tone: "success" }, due_soon: { label: "قريب الاستحقاق", tone: "info" },
  due: { label: "مستحق اليوم", tone: "warning" }, overdue: { label: "متأخر", tone: "danger" },
};

interface Photo { id: string; storage_path: string; file_name: string; mime_type: string | null; device_id: string | null; photo_stage: string | null; created_by: string | null; created_at: string; url: string | null }

/** صورة محفوظة: معاينة كاملة بفتحها، وحذف نهائي بتأكيد لمن يحق له (القاعدة والتخزين يتحققان أيضًا) */
function PhotoTile({ p, deviceName, canDelete, visitId }: { p: Photo; deviceName?: string | null; canDelete: boolean; visitId: string }) {
  return (
    <li className="w-28 overflow-hidden rounded-lg border border-slate-200 bg-white text-[10px] text-slate-600">
      {p.url && p.mime_type?.startsWith("image/")
        // eslint-disable-next-line @next/next/no-img-element
        ? <a href={p.url} target="_blank" rel="noopener noreferrer" title="فتح الصورة"><img src={p.url} alt={p.file_name} className="h-20 w-full object-cover" /></a>
        : p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex h-20 items-center justify-center bg-slate-50 font-bold">PDF</a>
          : <span className="flex h-20 items-center justify-center bg-slate-50">غير متاح</span>}
      <div className="space-y-0.5 p-1">
        <p className="font-semibold">{PHOTO_STAGES[p.photo_stage ?? "general"] ?? p.photo_stage}</p>
        {deviceName && <p className="truncate">{deviceName}</p>}
        <p className="truncate" title={p.file_name}>{p.file_name}</p>
        {canDelete && <ActionButton action={deleteAttachment} hidden={{ attachment_id: p.id, back: `/visits/${visitId}/run` }} label="حذف"
          confirm={`حذف «${p.file_name}» نهائيًا؟ يُحذف الملف من التخزين ويُسجَّل الحذف في سجل التدقيق.`} className={`${btnDangerOutline} !px-2 !py-0.5 !text-[10px]`} />}
      </div>
    </li>
  );
}

/**
 * شاشة تنفيذ الزيارة: بند لكل جهاز يُحفظ تدريجيًا ويُستأنف، وتقرير الزيارة وملاحظات الفني بحفظ تلقائي، وبلاغات الأعطال،
 * والصور المصنفة، ثم ملخص وإغلاق. كل القواعد (النطاق، الإسناد، الأسباب الإلزامية، منع الإغلاق الناقص، الموعد القادم، الحذف) في القاعدة أيضًا.
 */
export default async function RunVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("visits.update");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [inspections, woExec] = await Promise.all([hasInspections(supabase), hasWorkOrderExecution(supabase)]);
  if (!inspections) {
    return <PhasePending title="تنفيذ الزيارة">تنفيذ الزيارة جهازًا جهازًا جاهز في التطبيق ويتطلب تطبيق ترحيل قاعدة البيانات 20261106000100.</PhasePending>;
  }
  const visitCols: string = "id, ref_no, visit_type, urgent_reason, status, closed_at, outcome, notes, summary, recommendations, scheduled_start, actual_start, updated_at, work_order_id, company:companies(schedule_policy), customer:customers(id, name), site:customer_sites(id, name, devices(id, name, ref_no, archived_at, status)), work_order:work_orders(id, ref_no, title, priority, order_type)"
    + (woExec ? ", technician_notes" : "");
  const faultCols: string = "id, ref_no, description, severity, status, reported_at, device:devices(name)" + (woExec ? ", action_taken, recommendation" : "");
  // جولة واحدة متوازية: الزيارة، بنودها مع أجهزتها وبلاغاتها المفتوحة، صورها، بلاغات هذه الزيارة، والفنيون (للمتابعة)
  const [{ data: raw, error: vErr }, items, files, techs, visitFaults] = await Promise.all([
    supabase.from("visits").select(visitCols).eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("visit_devices").select("*, device:devices(id, name, ref_no, serial_number, location_detail, next_maintenance_at, maintenance_interval_months, maintenance_interval_days, schedule_start_date, installed_at, system:safety_systems(name), faults:device_faults(id, ref_no, description, status))")
      .eq("visit_id", id).in("device.faults.status", ["open", "in_progress", "awaiting_verification"]).order("created_at"),
    supabase.from("attachments").select("id, storage_path, file_name, mime_type, device_id, photo_stage, created_by, created_at").eq("entity_type", "visit").eq("entity_id", id).is("archived_at", null).order("created_at"),
    supabase.from("technicians").select("id, full_name, user_id").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name"),
    supabase.from("device_faults").select(faultCols).eq("visit_id", id).order("reported_at"),
  ]);
  if (vErr) {
    return <PhasePending title="تنفيذ الزيارة">تعذر تحميل الزيارة حاليًا{logLoadError("run/visit", vErr)}. أعد تحميل الصفحة بعد لحظات.</PhasePending>;
  }
  type V = { id: string; ref_no: string; visit_type: string; urgent_reason: string | null; status: string; closed_at: string | null; outcome: string | null;
    notes: string | null; summary: string | null; recommendations: string | null; technician_notes?: string | null; scheduled_start: string; actual_start: string | null;
    updated_at: string; work_order_id: string | null; company: { schedule_policy?: string } | null; customer: { id: string; name: string } | null;
    site: { id: string; name: string; devices?: { id: string; name: string; ref_no: string; archived_at: string | null; status: string }[] } | null;
    work_order: { id: string; ref_no: string; title: string; priority: string; order_type: string } | null };
  const v = raw as unknown as V | null;
  if (!v) notFound();
  if (items.error) {
    return <PhasePending title={`تنفيذ الزيارة ${v.ref_no}`}>تعذر تحميل أجهزة الزيارة حاليًا{logLoadError("run/items", items.error)}. أعد تحميل الصفحة بعد لحظات؛ لم يُفقد ما حُفظ.</PhasePending>;
  }
  const filesErr = logLoadError("run/attachments", files.error);
  const faultsErr = logLoadError("run/visit-faults", visitFaults.error);
  type Row = Record<string, unknown> & {
    id: string; version: number; device_id: string; inspection_status: string; result: string | null; follow_up_needed: boolean;
    readings: Record<string, string>; parts: Part[]; inspected_at: string | null; inspected_by: string | null; technician_id: string | null;
    device: { id: string; name: string; ref_no: string; serial_number: string | null; location_detail: string | null; next_maintenance_at: string | null;
      maintenance_interval_months: number | null; maintenance_interval_days: number | null; schedule_start_date: string | null; installed_at: string | null;
      system: { name: string } | null; faults: { id: string; ref_no: string; description: string }[] | null } | null;
  };
  const rows = (items.data ?? []) as unknown as Row[];
  const closed = !!v.closed_at || v.status === "completed" || v.status === "cancelled";
  const today = todayISO();
  const policy = (v.company?.schedule_policy ?? "from_completion") as "from_completion" | "fixed";
  const sum = closeSummary(rows);
  const pct = progressPercent(sum.done, sum.total);
  const techList = (techs.data ?? []) as { id: string; full_name: string; user_id: string | null }[];
  const techName = (tid: string | null) => techList.find((t) => t.id === tid)?.full_name ?? null;
  const deviceName = new Map(rows.map((r) => [r.device_id, r.device?.name ?? "—"]));

  // الصور تُحمَّل من المتصفح عبر /files/[id] بعد عرض الصفحة (لا جولة توقيع تؤخر الصفحة)
  const photos: Photo[] = ((files.data ?? []) as Omit<Photo, "url">[]).map((p) => ({ ...p, url: `/files/${p.id}` }));
  const canDelete = (p: Photo) => ctx.can("visits.delete") || (!closed && p.created_by === ctx.user.id);
  const stages = woExec ? Object.keys(PHOTO_STAGES) : ["general", "before", "after"];
  const byStage = Object.fromEntries(stages.map((s) => [s, photos.filter((p) => (p.photo_stage ?? "general") === s).length]));

  type VF = { id: string; ref_no: string; description: string; severity: string; status: string; reported_at: string; device: { name: string } | null; action_taken?: string | null; recommendation?: string | null };
  const faults = (visitFaults.data ?? []) as unknown as VF[];

  const views: ItemView[] = rows.map((r) => {
    const d = r.device;
    const s = (k: string) => (r[k] == null ? "" : String(r[k]));
    return {
      id: r.id, version: r.version, deviceId: r.device_id, deviceName: d?.name ?? "—", deviceRef: d?.ref_no ?? "", location: d?.location_detail ?? null,
      system: d?.system?.name ?? null, serial: d?.serial_number ?? null,
      dueLabel: v.visit_type === "periodic" ? DUE[dueStatus(s("due_date") || null, 14)] : null,
      openFaults: (d?.faults ?? []).map((x) => ({ id: x.id, ref: x.ref_no, text: x.description.slice(0, 140) })),
      expectedNextDue: d ? computeNextDue({ start: d.schedule_start_date ?? d.installed_at, months: d.maintenance_interval_months, days: d.maintenance_interval_days,
        policy, done: today, currentDue: d.next_maintenance_at }) : null,
      inspectedBy: techName(r.technician_id), inspectedAt: r.inspected_at ? formatDateTime(r.inspected_at) : null,
      fields: {
        inspection_status: r.inspection_status, result: s("result"), status_after: s("status_after"), action: s("action"), skip_reason: s("skip_reason"),
        findings: s("findings"), actions_taken: s("actions_taken"), recommendations: s("recommendations"), notes: s("notes"),
        readings: Object.entries(r.readings ?? {}).map(([k, x]) => `${k} = ${x}`).join("\n"), parts: partsText(r.parts),
        resolved: r.resolved === true ? "yes" : r.resolved === false ? "no" : "",
        follow_up_needed: r.follow_up_needed ? "1" : "", follow_up_technician_id: s("follow_up_technician_id"), follow_up_due: s("follow_up_due"),
        follow_up_note: s("follow_up_note"), next_due_override: s("next_due_override"), next_due_reason: s("next_due_reason"),
      },
    };
  });
  const options = {
    results: toOptions(maintenanceResult), statuses: toOptions(deviceStatus), actions: toOptions(maintenanceAction),
    technicians: techList.map((t) => ({ value: t.id, label: t.full_name })),
  };
  const inVisit = new Set(rows.map((r) => r.device_id));
  const activeSiteDevices = (v.site?.devices ?? []).filter((d) => !d.archived_at && !["decommissioned", "replaced"].includes(d.status));
  const siteDevices = activeSiteDevices.filter((d) => !inVisit.has(d.id));
  const pendingNames = views.filter((x) => x.fields.inspection_status === "pending").map((x) => x.deviceName);
  const urgent = v.visit_type !== "periodic";
  const kindLabel = v.work_order ? "زيارة أمر عمل" : urgent ? "زيارة طارئة" : "زيارة دورية";
  // أجهزة البلاغ: أجهزة الزيارة أولًا ثم بقية أجهزة الموقع (تُضاف للزيارة عند الإبلاغ)
  const faultDevices = [...rows.map((r) => ({ value: r.device_id, label: r.device?.name ?? "—" })),
    ...siteDevices.map((d) => ({ value: d.id, label: `${d.name} (يُضاف للزيارة)` }))];

  return (
    <div className="space-y-6">
      <PageHeader title={`${kindLabel} — ${v.site?.name ?? v.customer?.name ?? ""}`} refNo={v.ref_no}
        crumbs={[{ label: "عملي", href: "/my-work" }, { label: v.ref_no, href: `/visits/${id}` }, { label: "التنفيذ" }]}
        description={<>{v.customer?.name} · بدأت {formatDateTime(v.actual_start ?? v.scheduled_start)}{urgent && v.urgent_reason && ` · السبب: ${URGENT_REASONS[v.urgent_reason] ?? v.urgent_reason}`}</>}
        actions={<Link href={`/print/visit/${id}`} className={btnSecondary}>{closed ? "طباعة التقرير" : "معاينة التقرير"}</Link>} />

      {v.work_order && (
        <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
          <div><p className="font-bold">أمر العمل: <Link href={`/work-orders/${v.work_order.id}`} className={link}>{v.work_order.title}</Link> <span className="font-mono text-xs text-slate-500" dir="ltr">{v.work_order.ref_no}</span></p>
            {v.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{v.notes}</p>}</div>
          <StatusBadge {...(workOrderPriority[v.work_order.priority] ?? { label: v.work_order.priority, tone: "neutral" })} />
        </section>
      )}

      <section className={`${card} p-5`} aria-label="تقدم الزيارة">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="font-bold">التقدم: {sum.done} من {sum.total} جهاز ({pct}%)</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <StatusBadge label={`تم الفحص ${sum.inspected}`} tone="success" />
            <StatusBadge label={`لم تُفحص ${sum.pending}`} tone="neutral" />
            {sum.skipped > 0 && <StatusBadge label={`تعذر / غير موجود ${sum.skipped}`} tone="warning" />}
            {sum.fails > 0 && <StatusBadge label={`غير سليم ${sum.fails}`} tone="danger" />}
            {faults.length > 0 && <StatusBadge label={`بلاغات ${faults.length}`} tone="danger" />}
            {closed && v.outcome && <StatusBadge {...(visitOutcome[v.outcome] ?? { label: v.outcome, tone: "neutral" })} />}
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {closed ? "الزيارة مغلقة: النتائج سجل تاريخي لا يُعدَّل؛ التصحيح الموثق من صفحة الجهاز." :
            `يُحفظ كل جهاز والتقرير مستقلًا ويمكن العودة لاحقًا لإكمال الزيارة من «عملي». ${urgent ? "هذه الزيارة لا تغيّر موعد الصيانة الدورية." : "الأجهزة غير المفحوصة تبقى مستحقة."}`}
        </p>
      </section>

      <div className="space-y-3">
        {views.map((item) => (
          <div key={item.id} className="space-y-1">
            <ItemCard item={item} visitId={id} visitType={v.visit_type} today={today} canReschedule={ctx.can("maintenance.reschedule")}
              options={options} closed={closed} photos={
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-600">صور الجهاز ({photos.filter((p) => p.device_id === item.deviceId).length})</p>
                  <ul className="flex flex-wrap gap-2">
                    {photos.filter((p) => p.device_id === item.deviceId).map((p) => <PhotoTile key={p.id} p={p} canDelete={canDelete(p)} visitId={id} />)}
                  </ul>
                  {!closed && <UploadForm entityType="visit" entityId={id} fixedDeviceId={item.deviceId} stages={stages} />}
                </div>
              } />
            {urgent && !closed && item.fields.inspection_status === "pending" && views.length > 1 && (
              <ActionButton action={removeVisitDevice} hidden={{ item_id: item.id, visit_id: id }} label="إزالة الجهاز من الزيارة"
                confirm={`إزالة «${item.deviceName}» من هذه الزيارة؟`} className={`${btnSecondary} ${btnSm}`} />
            )}
          </div>
        ))}
        {views.length === 0 && <p className={`${card} p-5 text-sm text-slate-500`}>لا توجد أجهزة في الزيارة بعد{urgent && !closed ? "؛ أضف الأجهزة المعنية من الموقع أدناه." : "."}</p>}
      </div>

      {urgent && !closed && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>إضافة جهاز آخر من الموقع نفسه</h2></div>
          <div className="p-5">
            <MultiSelectForm action={addVisitDevices} name="device_ids" hidden={{ visit_id: id }} submitLabel="إضافة إلى الزيارة"
              options={siteDevices.map((d) => ({ value: d.id, label: d.name, hint: d.ref_no }))} emptyText="كل أجهزة الموقع النشطة ضمن الزيارة." />
          </div>
        </section>
      )}

      {woExec && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>تقرير الزيارة وملاحظات الفني</h2></div>
          <div className="p-5">
            <VisitReport visitId={id} closed={closed} savedAt={v.updated_at}
              initial={{ summary: v.summary ?? "", notes: v.technician_notes ?? "", recommendations: v.recommendations ?? "" }} />
          </div>
        </section>
      )}

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الأعطال والبلاغات في هذه الزيارة ({faults.length})</h2></div>
        <ul className="divide-y divide-slate-100">
          {faults.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0 space-y-0.5">
                <p><Link href={`/faults/${f.id}`} className={link}>{f.ref_no}</Link> · {f.device?.name ?? "—"}</p>
                <p className="text-slate-700">{f.description}</p>
                {f.action_taken && <p className="text-xs text-slate-600">الإجراء المتخذ: {f.action_taken}</p>}
                {f.recommendation && <p className="text-xs text-slate-600">التوصية: {f.recommendation}</p>}
              </div>
              <div className="flex gap-1"><StatusBadge {...(faultSeverity[f.severity] ?? { label: f.severity, tone: "neutral" as Tone })} />
                <StatusBadge {...(faultStatus[f.status] ?? { label: f.status, tone: "neutral" as Tone })} /></div>
            </li>
          ))}
          {visitFaults.error ? <li role="alert" className="px-5 py-4 text-sm text-red-700">تعذر تحميل بلاغات الزيارة حاليًا{faultsErr}.</li>
            : faults.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لم تُسجل أعطال في هذه الزيارة.</li>}
        </ul>
        {woExec && !closed && !ctx.can("faults.create") && (
          <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">لا تملك صلاحية «تسجيل بلاغ عطل»؛ اطلب من مدير الشركة منحها من «فريق الشركة والدعوات». يمكنك توثيق العطل في نتيجة الجهاز وطلب متابعة.</p>
        )}
        {woExec && !closed && ctx.can("faults.create") && faultDevices.length > 0 && (
          <details className="border-t border-slate-200">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">+ تسجيل عطل جديد</summary>
            <div className="p-5 pt-0">
              <EntityForm action={reportVisitFault} submitLabel="تسجيل البلاغ" initial={{ visit_id: id, client_key: crypto.randomUUID(), severity: "medium", status: "open" }}
                fields={[
                  { name: "visit_id", label: "", type: "hidden" },
                  { name: "client_key", label: "", type: "hidden" },
                  { name: "device_id", label: "الجهاز المعني", type: "select", required: true, options: faultDevices },
                  { name: "severity", label: "درجة الخطورة / الأولوية", type: "select", required: true, options: toOptions(faultSeverity) },
                  { name: "status", label: "الحالة", type: "select", required: true, options: [
                    { value: "open", label: "مفتوح (يحتاج إصلاحًا)" }, { value: "in_progress", label: "قيد المعالجة" },
                    { value: "awaiting_verification", label: "أُصلح أثناء الزيارة — بانتظار التحقق" }] },
                  { name: "description", label: "وصف العطل", type: "textarea", required: true, wide: true, maxLength: 2000 },
                  { name: "action_taken", label: "الإجراء المتخذ", type: "textarea", maxLength: 2000 },
                  { name: "recommendation", label: "التوصية", type: "textarea", maxLength: 2000 },
                ]} />
              <p className="mt-2 text-xs text-slate-500">يرتبط البلاغ بالزيارة{v.work_order ? " وأمر العمل" : ""} والعميل والموقع والجهاز، ويُشعر المسؤولين. وثّقه بصورة «توثيق عطل» مرتبطة بالجهاز.</p>
            </div>
          </details>
        )}
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>صور ومرفقات الزيارة ({photos.length})</h2>
          <span className="text-xs text-slate-500">{stages.map((s) => `${PHOTO_STAGES[s]}: ${byStage[s] ?? 0}`).join(" · ")}</span></div>
        <div className="space-y-4 p-5">
          {files.error ? <p role="alert" className="text-sm text-red-700">تعذر تحميل الصور حاليًا{filesErr}.</p> : (
            <ul className="flex flex-wrap gap-2">
              {photos.map((p) => <PhotoTile key={p.id} p={p} deviceName={p.device_id ? deviceName.get(p.device_id) ?? null : null} canDelete={canDelete(p)} visitId={id} />)}
              {photos.length === 0 && <li className="text-sm text-slate-500">لا توجد صور أو مرفقات بعد.</li>}
            </ul>
          )}
          {!closed && <UploadForm entityType="visit" entityId={id} stages={stages} devices={rows.map((r) => ({ id: r.device_id, name: r.device?.name ?? "—" }))} />}
          <p className="text-xs text-slate-500">ارفع من الجهاز أو كاميرا الجوال، واختر التصنيف والجهاز (اختياري للصورة العامة). يحذف الصورة المحفوظة رافعها قبل الإغلاق أو من يملك صلاحية الحذف؛ بعد الإغلاق تبقى توثيقًا.</p>
        </div>
      </section>

      {!closed && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>ملخص قبل الإغلاق</h2>
            <StatusBadge {...(visitOutcome[sum.outcome] ?? { label: sum.outcome, tone: "neutral" })} /></div>
          <div className="space-y-4 p-5 text-sm">
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <li className="rounded-lg bg-slate-50 p-3">أجهزة الزيارة: <b>{sum.total}</b></li>
              <li className="rounded-lg bg-green-50 p-3">تم فحصها: <b>{sum.inspected}</b>{sum.issues > 0 && ` (بملاحظات/غير سليم ${sum.issues})`}</li>
              <li className="rounded-lg bg-amber-50 p-3">تعذر / غير موجود (بسبب): <b>{sum.skipped}</b></li>
              <li className="rounded-lg bg-red-50 p-3">أعطال مسجلة: <b>{faults.length}</b> · متابعات ستُفتح: <b>{sum.followups}</b></li>
              <li className="rounded-lg bg-slate-50 p-3">الصور والمرفقات: <b>{photos.length}</b></li>
              <li className={`rounded-lg p-3 ${v.summary ? "bg-green-50" : "bg-amber-50"}`}>تقرير الزيارة: <b>{v.summary ? "مكتوب" : "لم يُكتب بعد"}</b>{v.technician_notes ? " · ملاحظات الفني مكتوبة" : ""}</li>
            </ul>
            {sum.pending > 0 ? (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
                لا يمكن إغلاق الزيارة كمكتملة: {sum.pending} جهاز بلا نتيجة ({pendingNames.slice(0, 8).join("، ")}{pendingNames.length > 8 ? "…" : ""}).
                سجّل لكل جهاز «تم الفحص» أو «تعذر الفحص» أو «غير موجود» مع السبب{ctx.can("visits.close_exception") ? "، أو أغلق باستثناء موثق أدناه." : "."}
              </p>
            ) : sum.total === 0 ? (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">أضف الأجهزة المعنية وسجّل نتائجها قبل الإغلاق.</p>
            ) : (
              <p className="rounded-lg bg-green-50 p-3 text-green-800">كل الأجهزة لها نتيجة. عند الإغلاق تُنشأ سجلات الصيانة للأجهزة المفحوصة فقط{v.work_order ? " ويكتمل أمر العمل" : ""}، ويصدر تقرير موحد للزيارة. احفظ التقرير والملاحظات قبل الإغلاق.</p>
            )}
            {sum.total > 0 && (sum.pending === 0 || ctx.can("visits.close_exception")) && (
              <EntityForm action={closeVisit} submitLabel={sum.pending ? "إغلاق باستثناء موثق" : "إغلاق الزيارة وإصدار التقرير"} initial={{ visit_id: id }}
                fields={[
                  { name: "visit_id", label: "", type: "hidden" },
                  ...(woExec ? [] : [{ name: "summary", label: "ملخص الزيارة (يظهر في التقرير)", type: "textarea" as const, maxLength: 4000 }]),
                  ...(sum.pending ? [{ name: "exception_reason", label: "سبب الإغلاق رغم وجود أجهزة بلا نتيجة", type: "textarea" as const, required: true,
                    help: "يُحفظ مع اسمك في سجل التدقيق، وتُحسب الزيارة «غير مكتملة»، وتبقى الأجهزة غير المفحوصة مستحقة." }] : []),
                ]} />
            )}
          </div>
        </section>
      )}
      {closed && <p className="text-sm"><Link href={`/visits/${id}`} className={link}>العودة إلى صفحة الزيارة</Link></p>}
      <p className="text-xs text-slate-500">نوع الزيارة: {visitType[v.visit_type] ?? v.visit_type}. لا يدعم التطبيق العمل دون اتصال؛ الحفظ يتطلب اتصالًا بالإنترنت.</p>
    </div>
  );
}
