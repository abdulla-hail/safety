import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { KeyValueTable, PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { deviceScanPath, qrSvg, siteUrl } from "@/lib/codes";
import { formatDate, formatDateTime, intervalLabel } from "@/lib/format";
import { deviceStatus, maintenanceAction, maintenanceResult } from "@/lib/labels";
import { isUuid } from "@/lib/list";

export const metadata = { title: "بطاقة جهاز | طباعة" };

export default async function PrintDevice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: d }, b, { data: history }] = await Promise.all([
    supabase.from("devices").select("*, customer:customers(name, ref_no), site:customer_sites(name), system:safety_systems(name)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("maintenance_records")
      .select("id, ref_no, performed_at, action, result, notes, next_due_at").eq("company_id", ctx.orgId).eq("device_id", id).order("performed_at", { ascending: false }).limit(60),
  ]);
  if (!d || !b) notFound();
  const image = d.image_path ? `/device-image/${id}?v=${encodeURIComponent(d.image_path)}` : null;
  const qr = await qrSvg(`${await siteUrl()}${deviceScanPath(d.qr_token)}`);

  return (
    <>
      <PrintToolbar />
      <PrintDocument b={b} title="بطاقة جهاز سلامة" refNo={d.ref_no} meta={[
        ["العميل", d.customer && `${d.customer.name} (${d.customer.ref_no})`], ["الموقع", d.site?.name], ["النظام", d.system?.name],
      ]}>
        <div className="flex gap-5 break-inside-avoid">
          <div className="min-w-0 flex-1">
            <KeyValueTable rows={[
              ["اسم الجهاز", d.name], ["الشركة المصنعة", d.manufacturer], ["الموديل", d.model], ["النوع", d.device_type],
              ["الرقم التسلسلي", d.serial_number], ["الموقع الدقيق", d.location_detail], ["السعة", d.capacity],
              ["تاريخ التركيب", d.installed_at && formatDate(d.installed_at)], ["انتهاء الصلاحية", d.expires_at && formatDate(d.expires_at)],
              ["الحالة", deviceStatus[d.status]?.label ?? d.status], ["فترة الصيانة", intervalLabel(d.maintenance_interval_months, d.maintenance_interval_days)],
              ["آخر صيانة", d.last_maintenance_at && formatDate(d.last_maintenance_at)], ["الصيانة القادمة", d.next_maintenance_at && formatDate(d.next_maintenance_at)],
            ]} />
          </div>
          <div className="w-40 shrink-0 space-y-2 text-center">
            {image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={`صورة ${d.name}`} className="mx-auto max-h-40 w-full rounded border border-slate-400 object-contain" />
            )}
            <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="font-mono text-xs font-bold" dir="ltr">{d.ref_no}</p>
            <p className="font-mono text-[10px]" dir="ltr">{d.qr_token}</p>
          </div>
        </div>
        <h2>سجل الصيانة</h2>
        {(history ?? []).length === 0 ? <p className="text-xs text-slate-600">لا توجد عمليات صيانة مسجلة.</p> : (
          <table>
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>العملية</th><th>النتيجة</th><th>ملاحظات</th><th>القادمة</th></tr></thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id}>
                  <td dir="ltr">{h.ref_no}</td><td>{formatDateTime(h.performed_at)}</td><td>{maintenanceAction[h.action] ?? h.action}</td>
                  <td>{maintenanceResult[h.result]?.label ?? h.result}</td><td>{h.notes ?? ""}</td><td>{h.next_due_at ? formatDate(h.next_due_at) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PrintDocument>
    </>
  );
}
