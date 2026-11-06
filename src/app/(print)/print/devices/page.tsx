import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { KeyValueTable, PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { deviceScanPath, qrSvg, siteUrl } from "@/lib/codes";
import { loadPrintDevices, MAX_PRINT_DEVICES, SCOPE_LABEL } from "@/lib/device-print";
import { formatDate, intervalLabel } from "@/lib/format";
import { deviceStatus } from "@/lib/labels";
import type { SearchParams } from "@/lib/list";

export const metadata = { title: "بيانات الأجهزة | طباعة" };

interface D {
  id: string; ref_no: string; name: string; qr_token: string; manufacturer: string | null; model: string | null; device_type: string | null;
  serial_number: string | null; location_detail: string | null; capacity: string | null; installed_at: string | null; expires_at: string | null;
  status: string; maintenance_interval_days: number | null; maintenance_interval_months: number | null; last_maintenance_at: string | null; next_maintenance_at: string | null;
  customer: { name: string; ref_no: string } | null; site: { name: string } | null; system: { name: string } | null;
}

/** طباعة بيانات جهاز واحد أو عدة أجهزة (محددة أو لعميل أو لموقع أو كل المسموح بها): بطاقة لكل جهاز لا تنقسم بين صفحتين. */
export default async function PrintDevices({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("reports.print");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ list, total, truncated, scope }, b] = await Promise.all([
    loadPrintDevices<D>(supabase, ctx.orgId, sp, `id, ref_no, name, qr_token, manufacturer, model, device_type, serial_number, location_detail, capacity,
      installed_at, expires_at, status, maintenance_interval_days, maintenance_interval_months, last_maintenance_at, next_maintenance_at,
      customer:customers(name, ref_no), site:customer_sites(name), system:safety_systems(name)`),
    loadBranding(supabase, ctx.orgId),
  ]);
  if (!b) notFound();
  const base = await siteUrl();
  const qrs = await Promise.all(list.map((d) => qrSvg(`${base}${deviceScanPath(d.qr_token)}`)));
  const oneCustomer = list.length > 0 && list.every((d) => d.customer?.ref_no === list[0].customer?.ref_no) ? list[0].customer : null;

  return (
    <>
      <PrintToolbar note={truncated ? `النتائج ${total} جهازًا؛ تُطبع أول ${MAX_PRINT_DEVICES} فقط.` : `${list.length} جهاز`} />
      {list.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-600">لم يتم تحديد أجهزة للطباعة، أو لا تملك صلاحية عرضها.</p>
      ) : (
        <PrintDocument b={b} title={list.length === 1 ? `بيانات جهاز: ${list[0].name}` : "بيانات أجهزة السلامة"} refNo={list.length === 1 ? list[0].ref_no : null}
          signature={false} meta={[
            ["النطاق", SCOPE_LABEL[scope.kind]], ["عدد الأجهزة", String(list.length)],
            ["العميل", oneCustomer && `${oneCustomer.name} (${oneCustomer.ref_no})`],
          ]}>
          <div className="space-y-3">
            {list.map((d, i) => (
              <section key={d.id} className="doc-card flex gap-4">
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-[12px] font-extrabold">{i + 1}. {d.name} <span className="font-mono text-[10px]" dir="ltr">{d.ref_no}</span></p>
                  <KeyValueTable keyWidth="28%" rows={[
                    ["العميل", !oneCustomer && d.customer && `${d.customer.name} (${d.customer.ref_no})`], ["الموقع", [d.site?.name, d.location_detail].filter(Boolean).join(" — ")],
                    ["النظام", d.system?.name], ["المصنع / الموديل", [d.manufacturer, d.model].filter(Boolean).join(" / ")], ["النوع", d.device_type],
                    ["الرقم التسلسلي", d.serial_number && <span dir="ltr">{d.serial_number}</span>], ["السعة", d.capacity],
                    ["التركيب", d.installed_at && formatDate(d.installed_at)], ["انتهاء الصلاحية", d.expires_at && formatDate(d.expires_at)],
                    ["الحالة", deviceStatus[d.status]?.label ?? d.status], ["فترة الصيانة", intervalLabel(d.maintenance_interval_months, d.maintenance_interval_days)],
                    ["آخر صيانة", d.last_maintenance_at && formatDate(d.last_maintenance_at)], ["الصيانة القادمة", d.next_maintenance_at && formatDate(d.next_maintenance_at)],
                  ]} />
                </div>
                <div className="w-28 shrink-0 text-center">
                  <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrs[i] }} role="img" aria-label={`رمز QR للجهاز ${d.ref_no}`} />
                  <p className="font-mono text-[9px]" dir="ltr">{d.qr_token}</p>
                </div>
              </section>
            ))}
          </div>
        </PrintDocument>
      )}
    </>
  );
}
