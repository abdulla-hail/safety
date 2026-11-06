import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import ActionButton from "@/components/ui/ActionButton";
import MultiSelectForm from "@/components/ui/MultiSelectForm";
import EntityForm from "@/components/ui/EntityForm";
import AttachmentList from "@/components/attachments/AttachmentList";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import { INSPECTION_STATUS } from "@/lib/visits";
import { formatDate, formatDateTime, toLocalInput } from "@/lib/format";
import { deviceStatus, maintenanceAction, maintenanceResult, toOptions, visitOutcome, visitStatus, visitType } from "@/lib/labels";
import { assignVisitTechnicians, removeVisitTechnician, setVisitStatus, updateVisit } from "../actions";

export const metadata = { title: "زيارة | عين السلامة" };

const NEXT: Record<string, { status: string; label: string }[]> = {
  scheduled: [{ status: "in_progress", label: "بدء الزيارة" }, { status: "missed", label: "تسجيل كفائتة" }, { status: "cancelled", label: "إلغاء" }],
  in_progress: [{ status: "completed", label: "إنهاء الزيارة" }],
  completed: [{ status: "in_progress", label: "إعادة فتح" }],
  cancelled: [{ status: "scheduled", label: "إعادة جدولة" }],
  missed: [{ status: "scheduled", label: "إعادة جدولة" }],
};

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("visits.view", "visits.create", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const mayEdit = ctx.can("visits.update");
  const [phase5, inspections] = await Promise.all([hasPhase5(supabase), hasInspections(supabase)]);
  // جولة واحدة: الزيارة مع أجهزة عميلها ومواقعه مضمّنة، وفنيوها وسجلاتها وبنودها بالمعرّف
  const [{ data: v }, techRows, records, allTechs, items] = await Promise.all([
    supabase.from("visits")
      .select(`*, customer:customers(id, name, devices(id, ref_no, name, status, next_maintenance_at, site_id, archived_at)${mayEdit ? ", sites:customer_sites(id, name, archived_at)" : ""}), site:customer_sites(id, name)`)
      .eq("id", id).eq("company_id", ctx.orgId).is("customer.devices.archived_at", null)
      .order("next_maintenance_at", { referencedTable: "customer.devices", nullsFirst: false }).limit(300, { referencedTable: "customer.devices" })
      .maybeSingle(),
    supabase.from("visit_technicians").select("technician:technicians(id, ref_no, full_name, phone)").eq("company_id", ctx.orgId).eq("visit_id", id),
    supabase.from("maintenance_records").select("id, ref_no, performed_at, action, result, device_id, device_name_snapshot").eq("company_id", ctx.orgId).eq("visit_id", id).order("performed_at"),
    mayEdit ? supabase.from("technicians").select("id, ref_no, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name") : null,
    inspections ? supabase.from("visit_devices").select("id, device_id, inspection_status, result, status_after, skip_reason, follow_up_needed, fault_id, device:devices(name, ref_no)")
      .eq("visit_id", id).order("created_at") : null,
  ]);
  if (!v) notFound();
  if (v.visit_type === "survey") redirect(`/visits/${id}/survey`);
  type It = { id: string; device_id: string; inspection_status: string; result: string | null; status_after: string | null; skip_reason: string | null;
    follow_up_needed: boolean; fault_id: string | null; device: { name: string; ref_no: string } | null };
  const itemRows = (items?.data ?? []) as unknown as It[];
  // زيارة بالتنفيذ الجديد: تُدار نتائجها من شاشة التنفيذ وتُغلق بإجراء الإغلاق فقط
  const managed = inspections && (itemRows.length > 0 || !!v.closed_at);
  const isClosed = !!v.closed_at;
  const canEdit = mayEdit && !v.archived_at && !isClosed;
  type Dev = { id: string; ref_no: string; name: string; status: string; next_maintenance_at: string | null; site_id: string | null };
  const embedded = (v.customer ?? {}) as { devices?: Dev[]; sites?: { id: string; name: string; archived_at: string | null }[] };
  const devices = { data: (embedded.devices ?? []).filter((d) => !v.site_id || d.site_id === v.site_id).slice(0, 100) };
  const sites = canEdit ? { data: (embedded.sites ?? []).filter((s) => !s.archived_at).sort((a, b) => a.name.localeCompare(b.name, "ar")) } : null;
  type T = { id: string; ref_no: string; full_name: string; phone: string | null };
  const techs = ((techRows.data ?? []) as unknown as { technician: T | null }[]).map((x) => x.technician).filter((x): x is T => !!x);
  const ids = new Set(techs.map((t) => t.id));
  const done = new Set((records.data ?? []).map((r) => r.device_id));

  return (
    <div className="space-y-6">
      <PageHeader title={`زيارة ${v.customer?.name ?? ""}`} refNo={v.ref_no}
        crumbs={[{ label: "الزيارات", href: "/visits" }, { label: v.ref_no }]}
        description={formatDateTime(v.scheduled_start)}
        actions={<>
          {inspections && canEdit && ["scheduled", "in_progress"].includes(v.status) && (
            <Link href={`/visits/${id}/run`} className={btnPrimary}>{managed ? "متابعة التنفيذ" : "بدء التنفيذ جهازًا جهازًا"}</Link>
          )}
          {ctx.canAny("reports.print", "field.assigned") && <Link href={`/print/visit/${id}`} className={btnSecondary}>طباعة تقرير الزيارة</Link>}
          <RecordActions table="visits" id={id} archived={!!v.archived_at} back={`/visits/${id}`} listPath="/visits" noun="الزيارة"
            canArchive={ctx.can("visits.archive")} canDelete={ctx.can("visits.delete")} />
        </>} />

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>بيانات الزيارة</h2><StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} /></div>
        <InfoGrid items={[
          ["العميل", v.customer && <Link href={`/customers/${v.customer.id}`} className={link}>{v.customer.name}</Link>],
          ["الموقع", v.site ? <Link href={`/sites/${v.site.id}`} className={link}>{v.site.name}</Link> : "—"],
          ["نوع الزيارة", visitType[v.visit_type] ?? v.visit_type],
          ["نتيجة الزيارة", v.outcome ? <StatusBadge key="o" {...(visitOutcome[v.outcome] ?? { label: v.outcome, tone: "neutral" })} /> : "—"],
          ["الموعد", formatDateTime(v.scheduled_start)], ["الانتهاء المتوقع", formatDateTime(v.scheduled_end)],
          ["البدء الفعلي", formatDateTime(v.actual_start)], ["الانتهاء الفعلي", formatDateTime(v.actual_end)],
          ["الأجهزة المفحوصة", `${done.size} من ${devices.data.length}`],
          ["المتابعة", ({ none: "لا يلزم", required: "مطلوبة", scheduled: "مجدولة", done: "تمت" } as Record<string, string>)[v.follow_up_status] ?? "—"],
          ["الملخص", v.summary], ["التوصيات", v.recommendations], ["ملاحظات", v.notes],
        ]} />
        {v.status === "completed" && !v.outcome && done.size < devices.data.length && v.visit_type === "periodic" && (
          <p role="status" className="mx-5 mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            أُغلقت الزيارة وفُحص {done.size} من {devices.data.length} جهازًا. الأجهزة غير المفحوصة تبقى مستحقة ولا يُعتبر إغلاق الزيارة إتمامًا لصيانتها؛ حدّد نتيجة الزيارة من «تعديل الزيارة».
          </p>
        )}
        {isClosed && (
          <p className="mx-5 mb-4 text-xs text-slate-500">أُغلقت {formatDateTime(v.closed_at)}{v.close_exception_reason && ` باستثناء موثق: ${v.close_exception_reason}`}. النتائج سجل تاريخي؛ التصحيح الموثق من صفحة كل جهاز.</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4">
            {(NEXT[v.status] ?? []).filter((n) => !(managed && n.status === "completed")).map((n) => (
              <ActionButton key={n.status} action={setVisitStatus} hidden={{ id, status: n.status }} label={n.label}
                confirm={`تغيير حالة الزيارة إلى «${visitStatus[n.status].label}»؟`} className={n.status === "completed" || n.status === "in_progress" ? btnPrimary : btnSecondary} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الفنيون ({techs.length})</h2></div>
          <ul className="divide-y divide-slate-100">
            {techs.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><p className="font-semibold">{t.full_name}</p><p className="text-xs text-slate-500" dir="ltr">{t.ref_no} · {t.phone ?? ""}</p></div>
                {canEdit && <ActionButton action={removeVisitTechnician} hidden={{ visit_id: id, technician_id: t.id }} label="إزالة" confirm="إزالة الفني من الزيارة؟" className={`${btnSecondary} ${btnSm}`} />}
              </li>
            ))}
            {techs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لم يُعيّن فنيون.</li>}
          </ul>
          {canEdit && (
            <div className="border-t border-slate-200 px-5 py-4">
              <MultiSelectForm action={assignVisitTechnicians} name="technician_ids" hidden={{ visit_id: id }} submitLabel="تعيين"
                options={(allTechs?.data ?? []).filter((t) => !ids.has(t.id)).map((t) => ({ value: t.id, label: t.full_name, hint: t.ref_no }))} emptyText="جميع الفنيين معيّنون." />
            </div>
          )}
        </section>
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>عمليات الصيانة في هذه الزيارة ({records.data?.length ?? 0})</h2></div>
          <ul className="divide-y divide-slate-100">
            {(records.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><Link href={`/devices/${r.device_id}`} className={link}>{r.device_name_snapshot}</Link>
                  <p className="text-xs text-slate-500">{maintenanceAction[r.action]} · {formatDateTime(r.performed_at)}</p></div>
                <StatusBadge {...(maintenanceResult[r.result] ?? { label: r.result, tone: "neutral" })} />
              </li>
            ))}
            {(records.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">{inspections
              ? "تُنشأ سجلات الصيانة عند إغلاق الزيارة للأجهزة المفحوصة فعلًا."
              : "لم تُسجل عمليات صيانة بعد. افتح الجهاز من القائمة أدناه وسجّل العملية مع اختيار هذه الزيارة."}</li>}
          </ul>
        </section>
      </div>

      {managed ? (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>نتائج الأجهزة في الزيارة ({itemRows.length})</h2></div>
          <ul className="divide-y divide-slate-100">
            {itemRows.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div><Link href={`/devices/${it.device_id}`} className={link}>{it.device?.name ?? "—"}</Link> <span className="font-mono text-xs text-slate-500" dir="ltr">{it.device?.ref_no}</span>
                  {it.skip_reason && <p className="text-xs text-amber-800">السبب: {it.skip_reason}</p>}
                  {it.fault_id && <p className="text-xs"><Link href={`/faults/${it.fault_id}`} className="underline">متابعة مفتوحة</Link></p>}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge {...(INSPECTION_STATUS[it.inspection_status as keyof typeof INSPECTION_STATUS] ?? { label: it.inspection_status, tone: "neutral" })} />
                  {it.result && <StatusBadge {...(maintenanceResult[it.result] ?? { label: it.result, tone: "neutral" })} />}
                  {it.status_after && <StatusBadge {...(deviceStatus[it.status_after] ?? { label: it.status_after, tone: "neutral" })} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>أجهزة {v.site ? "الموقع" : "العميل"}</h2></div>
        <ul className="divide-y divide-slate-100">
          {(devices.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div><Link href={`/devices/${d.id}`} className={link}>{d.name}</Link><p className="text-xs text-slate-500" dir="ltr">{d.ref_no}</p></div>
              <div className="flex items-center gap-3 text-xs">
                {done.has(d.id) ? <span className="font-semibold text-green-700">✓ تمت صيانته</span> : <span>القادمة: {formatDate(d.next_maintenance_at)}</span>}
                <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
              </div>
            </li>
          ))}
          {(devices.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد أجهزة.</li>}
        </ul>
      </section>
      )}

      {canEdit && (
        <details className={card}>
          <summary className="cursor-pointer px-5 py-4 font-bold">تعديل الزيارة أو موعدها</summary>
          <div className="border-t border-slate-200 p-5">
            <EntityForm action={updateVisit} initial={{ ...v, scheduled_start: toLocalInput(v.scheduled_start), scheduled_end: toLocalInput(v.scheduled_end) }}
              fields={[
                { name: "id", label: "", type: "hidden" },
                ...(phase5 ? [{ name: "visit_type", label: "نوع الزيارة", type: "select" as const, options: toOptions(visitType) }] : []),
                { name: "scheduled_start", label: "موعد البدء", type: "datetime-local", required: true, help: "تغيير الموعد يرسل إشعارًا للفنيين المعيّنين." },
                { name: "scheduled_end", label: "الانتهاء المتوقع", type: "datetime-local" },
                { name: "site_id", label: "الموقع", type: "select", options: (sites?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
                ...(phase5 ? [
                  { name: "outcome", label: "نتيجة الزيارة", type: "select" as const, options: toOptions(visitOutcome) },
                  { name: "follow_up_status", label: "المتابعة", type: "select" as const, options: [{ value: "none", label: "لا يلزم" }, { value: "required", label: "مطلوبة" }, { value: "scheduled", label: "مجدولة" }, { value: "done", label: "تمت" }] },
                ] : []),
                { name: "summary", label: "ملخص الزيارة", type: "textarea" },
                ...(phase5 ? [{ name: "recommendations", label: "التوصيات", type: "textarea" as const }] : []),
                { name: "notes", label: "ملاحظات", type: "textarea" },
              ]} />
          </div>
        </details>
      )}
      <AttachmentList entityType="visit" entityId={id} canUpload={canEdit || (ctx.can("maintenance.create") && !v.archived_at && !isClosed)}
        devices={devices.data.map((d) => ({ id: d.id, name: d.name }))} />
    </div>
  );
}
