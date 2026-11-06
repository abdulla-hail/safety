import Link from "next/link";
import { notFound } from "next/navigation";
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
import { hasWorkOrderExecution } from "@/lib/schema";
import StartWoVisitButton from "../../my-work/StartWoVisitButton";
import { isUuid } from "@/lib/list";
import { formatDate, formatDateTime, toLocalInput } from "@/lib/format";
import { deviceStatus, toOptions, visitStatus, workOrderPriority, workOrderStatus, workOrderType } from "@/lib/labels";
import { addWorkOrderDevices, approveWorkOrder, assignWorkOrderTechnicians, removeWorkOrderTechnician, setWorkOrderStatus, updateWorkOrder } from "../actions";

export const metadata = { title: "أمر عمل | عين السلامة" };

const NEXT: Record<string, { status: string; label: string }[]> = {
  new: [{ status: "scheduled", label: "جدولة" }, { status: "in_progress", label: "بدء التنفيذ" }, { status: "cancelled", label: "إلغاء" }],
  scheduled: [{ status: "in_progress", label: "بدء التنفيذ" }, { status: "on_hold", label: "تعليق" }, { status: "cancelled", label: "إلغاء" }],
  in_progress: [{ status: "completed", label: "إكمال" }, { status: "on_hold", label: "تعليق" }],
  on_hold: [{ status: "in_progress", label: "استئناف" }, { status: "cancelled", label: "إلغاء" }],
  completed: [{ status: "in_progress", label: "إعادة فتح" }],
  cancelled: [{ status: "new", label: "إعادة فتح" }],
};

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("work_orders.view", "work_orders.create", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const mayEdit = ctx.can("work_orders.update");
  // جولة واحدة: أمر العمل (مع مواقع وأجهزة عميله مضمّنة لمن يعدّل) وكل ما يتعلق به بالمعرّف
  let woQ = supabase.from("work_orders")
    .select(`*, customer:customers(id, name${mayEdit ? ", sites:customer_sites(id, name, archived_at), devices(id, ref_no, name, archived_at)" : ""}), site:customer_sites(id, name)`)
    .eq("id", id).eq("company_id", ctx.orgId);
  if (mayEdit) woQ = woQ.is("customer.sites.archived_at", null).is("customer.devices.archived_at", null)
    .order("ref_no", { referencedTable: "customer.devices" }).limit(300, { referencedTable: "customer.devices" });
  const woExec = await hasWorkOrderExecution(supabase);
  const [{ data: w }, techRows, devRows, visits, allTechs, me] = await Promise.all([
    woQ.maybeSingle(),
    supabase.from("work_order_technicians").select("technician:technicians(id, ref_no, full_name, phone)").eq("company_id", ctx.orgId).eq("work_order_id", id),
    supabase.from("work_order_devices").select("device:devices(id, ref_no, name, status, next_maintenance_at)").eq("company_id", ctx.orgId).eq("work_order_id", id),
    supabase.from("visits").select("id, ref_no, scheduled_start, status, closed_at").eq("company_id", ctx.orgId).eq("work_order_id", id).is("archived_at", null).order("scheduled_start"),
    ctx.can("work_orders.assign") ? supabase.from("technicians").select("id, ref_no, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name") : null,
    supabase.from("technicians").select("id").eq("company_id", ctx.orgId).eq("user_id", ctx.user.id).is("archived_at", null).limit(1).maybeSingle(),
  ]);
  if (!w) notFound();
  const canAssign = ctx.can("work_orders.assign") && !w.archived_at;
  const canEdit = mayEdit && !w.archived_at;
  const embedded = (w.customer ?? {}) as { sites?: { id: string; name: string }[]; devices?: { id: string; ref_no: string; name: string }[] };
  const custDevices = canEdit ? { data: embedded.devices ?? [] } : null;
  const sites = canEdit ? { data: [...(embedded.sites ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ar")) } : null;
  type T = { id: string; ref_no: string; full_name: string; phone: string | null };
  type D = { id: string; ref_no: string; name: string; status: string; next_maintenance_at: string | null };
  const techs = ((techRows.data ?? []) as unknown as { technician: T | null }[]).map((x) => x.technician).filter((x): x is T => !!x);
  const devs = ((devRows.data ?? []) as unknown as { device: D | null }[]).map((x) => x.device).filter((x): x is D => !!x);
  const techIds = new Set(techs.map((t) => t.id));
  const devIds = new Set(devs.map((d) => d.id));
  // بدء الزيارة: للفني المعيَّن للأمر، أو لمن يجدول الزيارات؛ القاعدة تعيد التحقق وتمنع زيارة ثانية مفتوحة للأمر
  const myTech = (me?.data as { id: string } | null)?.id ?? null;
  const assignedToMe = !!myTech && techIds.has(myTech);
  type VR = { id: string; ref_no: string; scheduled_start: string; status: string; closed_at?: string | null };
  const openVisit = ((visits.data ?? []) as VR[]).find((x) => !x.closed_at && ["scheduled", "in_progress"].includes(x.status));
  const canStart = !w.archived_at && !["completed", "cancelled"].includes(w.status) && !!w.site_id
    && ((assignedToMe && ctx.can("visits.update")) || ctx.can("visits.create"));

  return (
    <div className="space-y-6">
      <PageHeader title={w.title} refNo={w.ref_no}
        crumbs={[{ label: "أوامر العمل", href: "/work-orders" }, { label: w.ref_no }]}
        description={<>{workOrderType[w.order_type]} · <Link href={`/customers/${w.customer_id}`} className={link}>{w.customer?.name}</Link>{w.archived_at ? ` · مؤرشف منذ ${formatDate(w.archived_at)}` : ""}</>}
        actions={<>
          {woExec && openVisit && <Link href={`/visits/${openVisit.id}/run`} className={btnPrimary}>متابعة الزيارة</Link>}
          {woExec && !openVisit && canStart && <StartWoVisitButton workOrderId={id} clientKey={crypto.randomUUID()} />}
          {ctx.can("reports.print") && <Link href={`/print/work-order/${id}`} className={btnSecondary}>طباعة أمر العمل</Link>}
          {ctx.can("visits.create") && !w.archived_at && <Link href={`/visits/new?customer=${w.customer_id}&work_order=${id}`} className={btnSecondary}>+ جدولة زيارة</Link>}
          <RecordActions table="work_orders" id={id} archived={!!w.archived_at} back={`/work-orders/${id}`} listPath="/work-orders" noun="أمر العمل"
            canArchive={ctx.can("work_orders.archive")} canDelete={ctx.can("work_orders.delete")} />
        </>} />

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>الحالة والمعلومات</h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge {...(workOrderPriority[w.priority] ?? { label: w.priority, tone: "neutral" })} />
            <StatusBadge {...(workOrderStatus[w.status] ?? { label: w.status, tone: "neutral" })} />
            {w.approved_at && <StatusBadge label={`معتمد ${formatDate(w.approved_at)}`} tone="success" />}
          </div>
        </div>
        <InfoGrid items={[
          ["الموقع", w.site ? <Link href={`/sites/${w.site.id}`} className={link}>{w.site.name}</Link> : "—"],
          ["الموعد المجدول", formatDateTime(w.scheduled_for)], ["الموعد النهائي", formatDateTime(w.due_at)],
          ["تاريخ الإكمال", formatDateTime(w.completed_at)], ["تاريخ الإنشاء", formatDateTime(w.created_at)], ["الوصف", w.description],
        ]} />
        {(canEdit || ctx.can("work_orders.approve")) && !w.archived_at && (
          <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4">
            {canEdit && (NEXT[w.status] ?? []).map((n) => (
              <ActionButton key={n.status} action={setWorkOrderStatus} hidden={{ id, status: n.status }} label={n.label}
                confirm={`تغيير حالة أمر العمل إلى «${workOrderStatus[n.status].label}»؟`} className={n.status === "completed" ? btnPrimary : btnSecondary} />
            ))}
            {ctx.can("work_orders.approve") && w.status === "completed" && !w.approved_at && (
              <ActionButton action={approveWorkOrder} hidden={{ id }} label="اعتماد أمر العمل" confirm="اعتماد أمر العمل المكتمل؟" className={btnPrimary} />
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الفنيون المعيّنون ({techs.length})</h2></div>
          <ul className="divide-y divide-slate-100">
            {techs.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><p className="font-semibold">{t.full_name}</p><p className="text-xs text-slate-500" dir="ltr">{t.ref_no} · {t.phone ?? ""}</p></div>
                {canAssign && <ActionButton action={removeWorkOrderTechnician} hidden={{ work_order_id: id, technician_id: t.id }} label="إزالة" confirm="إزالة الفني من أمر العمل؟" className={`${btnSecondary} ${btnSm}`} />}
              </li>
            ))}
            {techs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لم يُعيّن فنيون بعد.</li>}
          </ul>
          {canAssign && (
            <div className="border-t border-slate-200 px-5 py-4">
              <MultiSelectForm action={assignWorkOrderTechnicians} name="technician_ids" hidden={{ work_order_id: id }} submitLabel="تعيين المحددين"
                options={(allTechs?.data ?? []).filter((t) => !techIds.has(t.id)).map((t) => ({ value: t.id, label: t.full_name, hint: t.ref_no }))} emptyText="جميع الفنيين معيّنون." />
            </div>
          )}
        </section>
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الأجهزة المشمولة ({devs.length})</h2>
            {ctx.can("devices.print") && devs.length > 0 && <Link href={`/print/labels?ids=${devs.map((d) => d.id).join(",")}`} className={`${link} text-xs`}>طباعة ملصقاتها</Link>}</div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {devs.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><Link href={`/devices/${d.id}`} className={link}>{d.name}</Link><p className="text-xs text-slate-500" dir="ltr">{d.ref_no}</p></div>
                <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
              </li>
            ))}
            {devs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد أجهزة مرتبطة.</li>}
          </ul>
          {canEdit && (
            <div className="border-t border-slate-200 px-5 py-4">
              <MultiSelectForm action={addWorkOrderDevices} name="device_ids" hidden={{ work_order_id: id }} submitLabel="إضافة الأجهزة"
                options={(custDevices?.data ?? []).filter((d) => !devIds.has(d.id)).map((d) => ({ value: d.id, label: d.name, hint: d.ref_no }))} emptyText="جميع أجهزة العميل مضافة." />
            </div>
          )}
        </section>
      </div>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الزيارات المرتبطة</h2></div>
        <ul className="divide-y divide-slate-100">
          {(visits.data ?? []).map((v) => (
            <li key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <Link href={`/visits/${v.id}`} className={link}>{formatDateTime(v.scheduled_start)}</Link>
              <div className="flex items-center gap-2"><span className="font-mono text-xs" dir="ltr">{v.ref_no}</span><StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} /></div>
            </li>
          ))}
          {(visits.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد زيارات.</li>}
        </ul>
      </section>

      {canEdit && (
        <details className={card}>
          <summary className="cursor-pointer px-5 py-4 font-bold">تعديل بيانات أمر العمل</summary>
          <div className="border-t border-slate-200 p-5">
            <EntityForm action={updateWorkOrder}
              initial={{ ...w, scheduled_for: toLocalInput(w.scheduled_for), due_at: toLocalInput(w.due_at) }}
              fields={[
                { name: "id", label: "", type: "hidden" },
                { name: "title", label: "العنوان", required: true, wide: true },
                { name: "order_type", label: "النوع", type: "select", required: true, options: toOptions(workOrderType) },
                { name: "priority", label: "الأولوية", type: "select", required: true, options: toOptions(workOrderPriority) },
                { name: "site_id", label: "الموقع", type: "select", options: (sites?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
                { name: "scheduled_for", label: "الموعد المجدول", type: "datetime-local" },
                { name: "due_at", label: "الموعد النهائي", type: "datetime-local" },
                { name: "description", label: "الوصف", type: "textarea" },
              ]} />
          </div>
        </details>
      )}
      <AttachmentList entityType="work_order" entityId={id} canUpload={canEdit} />
    </div>
  );
}
