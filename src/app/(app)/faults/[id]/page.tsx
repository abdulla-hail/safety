import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import EntityForm from "@/components/ui/EntityForm";
import ActionButton from "@/components/ui/ActionButton";
import AttachmentList from "@/components/attachments/AttachmentList";
import { btnPrimary, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import PhasePending from "@/components/PhasePending";
import { isUuid } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/format";
import { deviceStatus, faultSeverity, faultSource, faultStatus } from "@/lib/labels";
import { createWorkOrderForFault, transitionFault, updateFaultFollowUp } from "../actions";

export const metadata = { title: "بلاغ عطل | عين السلامة" };

/** الانتقالات المسموحة (تطابق fault_transition في القاعدة) */
const NEXT: Record<string, { status: string; label: string }[]> = {
  open: [{ status: "in_progress", label: "بدء المعالجة" }, { status: "awaiting_verification", label: "تم الإصلاح — بانتظار التحقق" }, { status: "closed", label: "إغلاق" }, { status: "cancelled", label: "إلغاء البلاغ" }],
  in_progress: [{ status: "awaiting_verification", label: "تم الإصلاح — بانتظار التحقق" }, { status: "closed", label: "إغلاق" }, { status: "cancelled", label: "إلغاء البلاغ" }],
  awaiting_verification: [{ status: "closed", label: "التحقق ناجح — إغلاق" }, { status: "in_progress", label: "التحقق فاشل — إعادة للمعالجة" }],
  closed: [{ status: "open", label: "إعادة فتح" }],
  cancelled: [{ status: "open", label: "إعادة فتح" }],
};

export default async function FaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("faults.view", "faults.create", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  if (!(await hasPhase5(supabase))) return <PhasePending />;
  const inspections = await hasInspections(supabase);
  const faultCols: string = "*, device:devices(id, name, ref_no, status), customer:customers(id, name), site:customer_sites(id, name), work_order:work_orders(id, ref_no, title, status)"
    + (inspections ? ", assignee:technicians!df_assignee_fk(full_name), visit:visits!df_visit_fk(id, ref_no)" : "");
  const [{ data: raw }, events, techs] = await Promise.all([
    supabase.from("device_faults").select(faultCols).eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("device_fault_events").select("id, from_status, to_status, note, occurred_at").eq("fault_id", id).order("occurred_at"),
    inspections && ctx.can("faults.update") ? supabase.from("technicians").select("id, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name") : null,
  ]);
  type Ref = { id: string; name: string } | null;
  const f = raw as unknown as {
    id: string; ref_no: string | null; status: string; severity: string; source: string; description: string; reported_at: string; archived_at: string | null;
    device_id: string; site_id: string | null; work_order_id: string | null; resolution: string | null; resolved_at: string | null;
    verification_result: string | null; verified_at: string | null;
    device: { id: string; name: string; ref_no: string; status: string } | null; customer: Ref; site: Ref;
    work_order: { id: string; ref_no: string; title: string; status: string } | null;
  } | null;
  if (!f) notFound();
  const canManage = ctx.can("faults.update") && !f.archived_at;
  const fu = f as unknown as { kind?: string; follow_up_due?: string | null; assigned_technician_id?: string | null; assignee?: { full_name: string } | null; visit?: { id: string; ref_no: string } | null };

  return (
    <div className="space-y-6">
      <PageHeader title={`بلاغ عطل — ${f.device?.name ?? ""}`} refNo={f.ref_no}
        crumbs={[{ label: "البلاغات والأعطال", href: "/faults" }, { label: f.ref_no ?? "بلاغ" }]}
        actions={canManage && !f.work_order_id && ctx.can("work_orders.create") && !["closed", "cancelled"].includes(f.status)
          ? <ActionButton action={createWorkOrderForFault} hidden={{ fault_id: id }} label="إنشاء أمر عمل للإصلاح" className={btnPrimary}
              confirm="إنشاء أمر عمل مستقل لإصلاح هذا العطل؟ لن تُنشأ زيارة تلقائيًا ولن تتغير مواعيد الصيانة." />
          : undefined} />

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>بيانات البلاغ</h2><StatusBadge {...(faultStatus[f.status] ?? { label: f.status, tone: "neutral" })} /></div>
        <InfoGrid items={[
          ["الجهاز", f.device && <Link href={`/devices/${f.device.id}`} className={link}>{f.device.name} <span dir="ltr" className="text-xs">{f.device.ref_no}</span></Link>],
          ["حالة الجهاز الحالية", f.device && <StatusBadge {...(deviceStatus[f.device.status] ?? { label: f.device.status, tone: "neutral" })} />],
          ["العميل", f.customer && <Link href={`/customers/${f.customer.id}`} className={link}>{f.customer.name}</Link>],
          ["الموقع", f.site?.name ?? "—"],
          ["الخطورة", <StatusBadge key="s" {...(faultSeverity[f.severity] ?? { label: f.severity, tone: "neutral" })} />],
          ["المصدر", faultSource[f.source] ?? f.source],
          ["تاريخ البلاغ", formatDateTime(f.reported_at)],
          ["أمر العمل", f.work_order ? <Link href={`/work-orders/${f.work_order.id}`} className={link}>{f.work_order.ref_no} — {f.work_order.title}</Link> : "—"],
          ["الإصلاح", f.resolution], ["تاريخ الإصلاح", formatDateTime(f.resolved_at)],
          ["نتيجة التحقق", f.verification_result === "passed" ? "ناجح" : f.verification_result === "failed" ? "فاشل" : "—"],
          ["تاريخ التحقق", formatDateTime(f.verified_at)],
          ["الوصف", f.description],
          ...(inspections ? [
            ["النوع", fu.kind === "follow_up" ? "متابعة" : fu.kind === "repair_request" ? "طلب إصلاح" : "عطل"],
            ["مسؤول المتابعة", fu.assignee?.full_name ?? "—"],
            ["تاريخ المتابعة", fu.follow_up_due ? formatDate(fu.follow_up_due) : "—"],
            ["من الزيارة", fu.visit ? <Link key="v" href={`/visits/${fu.visit.id}`} className={link}>{fu.visit.ref_no}</Link> : "—"],
          ] as [string, ReactNode][] : []),
        ]} />
        {inspections && !["closed", "cancelled"].includes(f.status) && f.site_id && ctx.canAny("visits.update", "visits.create") && (
          <div className="border-t border-slate-200 px-5 py-3">
            <Link href={`/my-work/urgent?site=${f.site_id}&device=${f.device_id}&reason=${fu.kind === "follow_up" ? "follow_up" : "fault"}`} className={btnPrimary}>زيارة طارئة لمعالجة البلاغ</Link>
          </div>
        )}
      </section>

      {canManage && inspections && !["closed", "cancelled"].includes(f.status) && (
        <details className={card}>
          <summary className="cursor-pointer px-5 py-4 font-bold">مسؤول المتابعة وتاريخها</summary>
          <div className="border-t border-slate-200 p-5">
            <EntityForm action={updateFaultFollowUp} submitLabel="حفظ" initial={{ fault_id: id, assigned_technician_id: fu.assigned_technician_id ?? "", follow_up_due: fu.follow_up_due ?? "" }}
              fields={[
                { name: "fault_id", label: "", type: "hidden" },
                { name: "assigned_technician_id", label: "المسؤول", type: "select", required: true, options: (techs?.data ?? []).map((t) => ({ value: t.id, label: t.full_name })) },
                { name: "follow_up_due", label: "تاريخ المتابعة", type: "date", required: true },
              ]} />
          </div>
        </details>
      )}

      {canManage && (NEXT[f.status] ?? []).length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>تحديث البلاغ</h2></div>
          <div className="p-5">
            <EntityForm action={transitionFault} submitLabel="حفظ" initial={{ fault_id: id }}
              fields={[
                { name: "fault_id", label: "", type: "hidden" },
                { name: "status", label: "الإجراء", type: "select", required: true, options: (NEXT[f.status] ?? []).map((n) => ({ value: n.status, label: n.label })) },
                ...(f.status === "awaiting_verification"
                  ? [{ name: "verification", label: "نتيجة التحقق اللاحق", type: "select" as const, required: true, options: [{ value: "passed", label: "ناجح" }, { value: "failed", label: "فاشل" }] }]
                  : []),
                { name: "device_status", label: "تغيير حالة الجهاز (اختياري)", type: "select", options: ["operational", "needs_maintenance", "faulty", "under_repair", "out_of_service"].map((k) => ({ value: k, label: deviceStatus[k].label })),
                  help: "لا تتغير حالة الجهاز إلا إذا اخترتها هنا، ولا يتغير موعد صيانته الدورية." },
                { name: "note", label: "ملاحظة / ما تم من إصلاح", type: "textarea", wide: true },
              ]} />
          </div>
        </section>
      )}

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>سجل البلاغ</h2></div>
        <ol className="divide-y divide-slate-100">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="px-5 py-2 text-sm">
              <span className="font-semibold">{e.from_status ? `${faultStatus[e.from_status]?.label ?? e.from_status} ← ` : ""}{faultStatus[e.to_status]?.label ?? e.to_status}</span>
              <span className="text-xs text-slate-500"> · {formatDateTime(e.occurred_at)}</span>
              {e.note && <p className="text-xs text-slate-600">{e.note}</p>}
            </li>
          ))}
        </ol>
      </section>

      <AttachmentList entityType="fault" entityId={id} canUpload={ctx.canAny("faults.create", "faults.update") && !f.archived_at} />
    </div>
  );
}
