import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { formatDate, formatDateTime } from "@/lib/format";
import { deviceStatus, visitStatus, workOrderPriority, workOrderStatus, workOrderType } from "@/lib/labels";
import { isUuid } from "@/lib/list";

export const metadata = { title: "أمر عمل | طباعة" };

export default async function PrintWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  // جولة واحدة متوازية (كانت جولتين)
  const [{ data: w }, b, techs, devs, visits] = await Promise.all([
    supabase.from("work_orders").select("*, customer:customers(name, ref_no, phone, contact_name), site:customer_sites(name, address, city)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("work_order_technicians").select("technician:technicians(full_name, ref_no, phone)").eq("work_order_id", id),
    supabase.from("work_order_devices").select("device:devices(ref_no, name, serial_number, location_detail, status, next_maintenance_at)").eq("work_order_id", id),
    supabase.from("visits").select("ref_no, scheduled_start, status").eq("work_order_id", id).order("scheduled_start"),
  ]);
  if (!w || !b) notFound();
  type T = { full_name: string; ref_no: string; phone: string | null };
  type D = { ref_no: string; name: string; serial_number: string | null; location_detail: string | null; status: string; next_maintenance_at: string | null };
  const t = ((techs.data ?? []) as unknown as { technician: T | null }[]).map((x) => x.technician).filter((x): x is T => !!x);
  const d = ((devs.data ?? []) as unknown as { device: D | null }[]).map((x) => x.device).filter((x): x is D => !!x);

  return (
    <>
      <PrintToolbar />
      <PrintDocument b={b} title={`أمر عمل: ${w.title}`} refNo={w.ref_no} meta={[
          ["العميل", w.customer && `${w.customer.name} (${w.customer.ref_no})`], ["الموقع", w.site && [w.site.name, w.site.city].filter(Boolean).join(" — ")],
          ["النوع", workOrderType[w.order_type]], ["الأولوية", workOrderPriority[w.priority]?.label], ["الحالة", workOrderStatus[w.status]?.label],
          ["الموعد", w.scheduled_for && formatDateTime(w.scheduled_for)], ["الموعد النهائي", w.due_at && formatDateTime(w.due_at)],
          ["الإكمال", w.completed_at && formatDateTime(w.completed_at)], ["الاعتماد", w.approved_at ? formatDateTime(w.approved_at) : "غير معتمد"],
        ]}>
        {w.description && (<><h2>الوصف</h2><p className="whitespace-pre-line text-[11px]">{w.description}</p></>)}
        {t.length > 0 && <>
          <h2>الفنيون المعيّنون</h2>
          <table><thead><tr><th>الرقم</th><th>الاسم</th><th>الجوال</th></tr></thead>
            <tbody>{t.map((x) => <tr key={x.ref_no}><td dir="ltr">{x.ref_no}</td><td>{x.full_name}</td><td dir="ltr">{x.phone ?? ""}</td></tr>)}</tbody></table>
        </>}
        {d.length > 0 && <>
          <h2>الأجهزة المشمولة ({d.length})</h2>
          <table><thead><tr><th>#</th><th>الرقم</th><th>الجهاز</th><th>التسلسلي</th><th>الموقع الدقيق</th><th>الحالة</th><th>القادمة</th><th>تم ✓</th></tr></thead>
            <tbody>{d.map((x, i) => <tr key={x.ref_no}><td>{i + 1}</td><td dir="ltr">{x.ref_no}</td><td>{x.name}</td><td dir="ltr">{x.serial_number ?? ""}</td><td>{x.location_detail ?? ""}</td><td>{deviceStatus[x.status]?.label}</td><td>{x.next_maintenance_at ? formatDate(x.next_maintenance_at) : ""}</td><td style={{ width: 40 }} /></tr>)}</tbody></table>
        </>}
        {(visits.data ?? []).length > 0 && <>
          <h2>الزيارات</h2>
          <table><thead><tr><th>الرقم</th><th>الموعد</th><th>الحالة</th></tr></thead>
            <tbody>{(visits.data ?? []).map((v) => <tr key={v.ref_no}><td dir="ltr">{v.ref_no}</td><td>{formatDateTime(v.scheduled_start)}</td><td>{visitStatus[v.status]?.label}</td></tr>)}</tbody></table>
        </>}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[11px] break-inside-avoid">
          <div><p className="text-slate-700">توقيع الفني</p><div className="mt-10 border-t border-slate-600" /></div>
          <div><p className="text-slate-700">اسم وتوقيع ممثل العميل</p><div className="mt-10 border-t border-slate-600" /></div>
        </div>
      </PrintDocument>
    </>
  );
}
