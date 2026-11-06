import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { hasInspections, hasWorkOrderExecution } from "@/lib/schema";
import { PHOTO_STAGES } from "@/components/attachments/UploadForm";
import { formatDate, formatDateTime } from "@/lib/format";
import { deviceStatus, faultSeverity, faultStatus, maintenanceAction, maintenanceResult, visitOutcome, visitStatus, visitType } from "@/lib/labels";
import { INSPECTION_STATUS, URGENT_REASONS, closeSummary, partsText, type Part } from "@/lib/visits";
import { isUuid } from "@/lib/list";

export const metadata = { title: "تقرير زيارة | طباعة" };

/**
 * تقرير زيارة موحد (دورية أو طارئة) من البيانات الفعلية؛ يُعاد طباعته في أي وقت من سجل الزيارات.
 * يشمل كل أجهزة الزيارة بحالتها (مفحوص / تعذر / غير موجود) مع السبب، ولا يُحتسب غير المفحوص فحصًا.
 * الفني يطبع تقارير زيارات نطاقه فقط (RLS).
 */
export default async function PrintVisit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  // فحص الترحيلات محفوظ في الذاكرة بعد أول طلب؛ ثم جولة واحدة متوازية لكل بيانات التقرير (كانت ثلاث جولات متتابعة)
  const [inspections, woExec] = await Promise.all([hasInspections(supabase), hasWorkOrderExecution(supabase)]);
  const [{ data: v }, b, techs, records, items, faultRows, files] = await Promise.all([
    supabase.from("visits").select("*, customer:customers(name, ref_no), site:customer_sites(name, city, address)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("visit_technicians").select("technician:technicians(full_name, ref_no)").eq("visit_id", id),
    supabase.from("maintenance_records").select("id, ref_no, performed_at, action, result, status_after, notes, next_due_at, device_ref_snapshot, device_name_snapshot").eq("visit_id", id).order("performed_at"),
    inspections ? supabase.from("visit_devices").select("id, inspection_status, skip_reason, action, result, status_after, findings, actions_taken, recommendations, notes, readings, parts, resolved, follow_up_needed, follow_up_due, inspected_at, record_id, device:devices(name, ref_no, serial_number, location_detail), follow_tech:technicians!vd_followup_tech_fk(full_name), tech:technicians!vd_tech_fk(full_name), fault:device_faults(ref_no)")
      .eq("visit_id", id).order("created_at") : null,
    inspections ? supabase.from("device_faults").select(woExec ? "id, ref_no, description, severity, status, action_taken, recommendation, device:devices(name, ref_no)" : "id, ref_no, description, severity, status, device:devices(name, ref_no)")
      .eq("visit_id", id).order("reported_at") : null,
    supabase.from("attachments").select("id, storage_path, file_name, mime_type, photo_stage, device:devices(name)").eq("entity_type", "visit").eq("entity_id", id).is("archived_at", null).order("created_at"),
  ]);
  if (!v || !b) notFound();
  type Fl = { id: string; ref_no: string; description: string; severity: string; status: string; action_taken?: string | null; recommendation?: string | null; device: { name: string; ref_no: string } | null };
  const faults = (faultRows?.data ?? []) as unknown as Fl[];
  type Ph = { id: string; storage_path: string; file_name: string; mime_type: string | null; photo_stage: string | null; device: { name: string } | null };
  const photoRows = (files.data ?? []) as unknown as Ph[];
  // الصور يحمّلها المتصفح عبر /files/[id] (توقيع عند الطلب) فلا تنتظر الصفحة جولة توقيع
  const photos = photoRows.map((p) => ({ ...p, url: `/files/${p.id}` as string | null }));
  const t = ((techs.data ?? []) as unknown as { technician: { full_name: string; ref_no: string } | null }[]).map((x) => x.technician).filter(Boolean);
  const recs = records.data ?? [];
  const recRef = new Map(recs.map((r) => [r.id, r.ref_no]));
  type It = { id: string; inspection_status: string; skip_reason: string | null; action: string; result: string | null; status_after: string | null; findings: string | null;
    actions_taken: string | null; recommendations: string | null; notes: string | null; readings: Record<string, string>; parts: Part[]; resolved: boolean | null;
    follow_up_needed: boolean; follow_up_due: string | null; inspected_at: string | null; record_id: string | null;
    device: { name: string; ref_no: string; serial_number: string | null; location_detail: string | null } | null;
    follow_tech: { full_name: string } | null; tech: { full_name: string } | null; fault: { ref_no: string } | null };
  const list = (items?.data ?? []) as unknown as It[];
  const useItems = list.length > 0;
  const sum = closeSummary(list);
  const urgent = v.visit_type && v.visit_type !== "periodic";
  const draft = !v.closed_at && useItems;
  const fails = recs.filter((r) => r.result === "fail").length;

  return (
    <>
      <PrintToolbar />
      <PrintDocument b={b} title={urgent ? "تقرير زيارة طارئة" : "تقرير زيارة صيانة دورية"} refNo={v.ref_no} meta={[
          ["العميل", v.customer && `${v.customer.name} (${v.customer.ref_no})`], ["الموقع", v.site && [v.site.name, v.site.city].filter(Boolean).join(" — ")],
          ["نوع الزيارة", visitType[v.visit_type] ?? null], ["سبب الزيارة", urgent && v.urgent_reason ? URGENT_REASONS[v.urgent_reason] : null],
          ["الموعد", formatDateTime(v.scheduled_start)],
          ["بدء التنفيذ", v.actual_start && formatDateTime(v.actual_start)], ["انتهاء التنفيذ", v.actual_end && formatDateTime(v.actual_end)],
          ["الحالة", visitStatus[v.status]?.label], ["النتيجة", v.outcome ? visitOutcome[v.outcome]?.label : null], ["الفنيون", t.map((x) => x!.full_name).join("، ")],
          ["الأجهزة", useItems ? `${sum.total} · فُحص ${sum.inspected}${sum.skipped ? ` · تعذر/غير موجود ${sum.skipped}` : ""}${sum.pending ? ` · بلا نتيجة ${sum.pending}` : ""}${sum.fails ? ` · غير سليم ${sum.fails}` : ""}`
            : `${recs.length}${fails ? ` (غير سليم: ${fails})` : ""}`],
        ]}>
        {draft && <p className="mb-3 rounded border border-amber-400 p-2 text-[11px] font-bold text-amber-800">مسودة: الزيارة لم تُغلق بعد، والنتائج قابلة للتغيير وليست سجلًا معتمدًا.</p>}
        {v.close_exception_reason && <p className="mb-3 rounded border border-red-300 p-2 text-[11px]">أُغلقت باستثناء موثق: {v.close_exception_reason}</p>}
        {v.notes && (<><h2>وصف البلاغ / الطلب</h2><p className="whitespace-pre-line text-[11px]">{v.notes}</p></>)}
        {v.summary && (<><h2>تقرير الزيارة</h2><p className="whitespace-pre-line text-[11px]">{v.summary}</p></>)}
        {v.technician_notes && (<><h2>ملاحظات الفني</h2><p className="whitespace-pre-line text-[11px]">{v.technician_notes}</p></>)}
        {v.recommendations && (<><h2>التوصيات</h2><p className="whitespace-pre-line text-[11px]">{v.recommendations}</p></>)}
        <h2>نتائج الأجهزة</h2>
        {useItems ? (
          <table>
            <thead><tr><th>#</th><th>الجهاز</th><th>الحالة في الزيارة</th><th>العملية / النتيجة</th><th>الحالة التشغيلية بعد</th><th>التفاصيل</th><th>رقم السجل</th></tr></thead>
            <tbody>{list.map((r, i) => (
              <tr key={r.id} className="break-inside-avoid">
                <td>{i + 1}</td>
                <td>{r.device?.name}<br /><span dir="ltr" className="text-[9px]">{r.device?.ref_no}{r.device?.serial_number ? ` · ${r.device.serial_number}` : ""}</span>{r.device?.location_detail && <><br /><span className="text-[9px]">{r.device.location_detail}</span></>}</td>
                <td>{INSPECTION_STATUS[r.inspection_status as keyof typeof INSPECTION_STATUS]?.label ?? r.inspection_status}{r.skip_reason && <><br /><span className="text-[9px]">السبب: {r.skip_reason}</span></>}</td>
                <td>{r.inspection_status === "inspected" ? <>{maintenanceAction[r.action]}<br />{r.result ? maintenanceResult[r.result]?.label : ""}</> : "—"}</td>
                <td>{r.inspection_status === "inspected" && r.status_after ? deviceStatus[r.status_after]?.label : "—"}</td>
                <td className="text-[9px] leading-4">
                  {r.findings && <div>الموجود/الملاحظات: {r.findings}</div>}
                  {r.actions_taken && <div>الإجراءات: {r.actions_taken}</div>}
                  {Object.keys(r.readings ?? {}).length > 0 && <div>القراءات: {Object.entries(r.readings).map(([k, x]) => `${k}: ${x}`).join(" · ")}</div>}
                  {(r.parts ?? []).length > 0 && <div className="whitespace-pre-line">القطع: {partsText(r.parts)}</div>}
                  {r.recommendations && <div>التوصيات: {r.recommendations}</div>}
                  {r.notes && <div>{r.notes}</div>}
                  {urgent && r.resolved !== null && <div>{r.resolved ? "حُلت المشكلة" : "لم تُحل: تحتاج إصلاحًا/متابعة"}</div>}
                  {r.follow_up_needed && <div>متابعة{r.fault ? ` ${r.fault.ref_no}` : ""}: {r.follow_tech?.full_name ?? "—"} · {formatDate(r.follow_up_due)}</div>}
                  {r.inspected_at && <div>{r.tech?.full_name ?? ""} · {formatDateTime(r.inspected_at)}</div>}
                </td>
                <td dir="ltr" className="text-[9px]">{r.record_id ? recRef.get(r.record_id) ?? "" : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : recs.length === 0 ? <p className="text-[11px] text-slate-500">لم تُسجل عمليات صيانة في هذه الزيارة.</p> : (
          <table>
            <thead><tr><th>#</th><th>الجهاز</th><th>العملية</th><th>النتيجة</th><th>الحالة بعد</th><th>ملاحظات</th><th>الصيانة القادمة</th></tr></thead>
            <tbody>{recs.map((r, i) => (
              <tr key={r.id}><td>{i + 1}</td><td>{r.device_name_snapshot}<br /><span dir="ltr" className="text-[9px]">{r.device_ref_snapshot}</span></td>
                <td>{maintenanceAction[r.action]}</td><td>{maintenanceResult[r.result]?.label}</td><td>{deviceStatus[r.status_after]?.label}</td>
                <td>{r.notes ?? ""}</td><td>{r.next_due_at ? formatDate(r.next_due_at) : ""}</td></tr>
            ))}</tbody>
          </table>
        )}
        {faults.length > 0 && (
          <>
            <h2>الأعطال والبلاغات المسجلة في الزيارة</h2>
            <table>
              <thead><tr><th>الرقم</th><th>الجهاز</th><th>الوصف</th><th>الخطورة</th><th>الحالة</th><th>الإجراء المتخذ</th><th>التوصية</th></tr></thead>
              <tbody>{faults.map((f) => (
                <tr key={f.id} className="break-inside-avoid"><td dir="ltr" className="text-[9px]">{f.ref_no}</td><td>{f.device?.name}</td><td>{f.description}</td>
                  <td>{faultSeverity[f.severity]?.label}</td><td>{faultStatus[f.status]?.label}</td><td>{f.action_taken ?? ""}</td><td>{f.recommendation ?? ""}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
        {photos.length > 0 && (
          <>
            <h2>الصور والمرفقات ({photos.length})</h2>
            <div className="grid grid-cols-4 gap-2">
              {photos.map((p) => (
                <figure key={p.id} className="break-inside-avoid text-center text-[9px]">
                  {p.url && p.mime_type?.startsWith("image/")
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.url} alt={p.file_name} className="h-24 w-full rounded border border-slate-300 object-cover" />
                    : <div className="flex h-24 items-center justify-center rounded border border-slate-300">{p.mime_type === "application/pdf" ? "ملف PDF" : "غير متاح"}</div>}
                  <figcaption>{PHOTO_STAGES[p.photo_stage ?? "general"] ?? ""}{p.device ? ` · ${p.device.name}` : ""}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
        {useItems && !urgent && recs.some((r) => r.next_due_at) && (
          <>
            <h2>مواعيد الصيانة القادمة</h2>
            <table>
              <thead><tr><th>الجهاز</th><th>الموعد القادم</th></tr></thead>
              <tbody>{recs.filter((r) => r.next_due_at).map((r) => <tr key={r.id}><td>{r.device_name_snapshot} <span dir="ltr" className="text-[9px]">{r.device_ref_snapshot}</span></td><td>{formatDate(r.next_due_at)}</td></tr>)}</tbody>
            </table>
            <p className="text-[10px] text-slate-500">محسوبة من تاريخ التنفيذ الفعلي وفترة خطة كل جهاز. الأجهزة غير المفحوصة تبقى على موعدها السابق.</p>
          </>
        )}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[11px] break-inside-avoid">
          <div><p className="text-slate-700">توقيع الفني</p><div className="mt-10 border-t border-slate-600" /></div>
          <div><p className="text-slate-700">اسم وتوقيع ممثل العميل</p><div className="mt-10 border-t border-slate-600" /></div>
        </div>
      </PrintDocument>
    </>
  );
}
