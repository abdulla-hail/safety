import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { formatDate } from "@/lib/format";
import { customerType, deviceStatus } from "@/lib/labels";
import { isUuid } from "@/lib/list";

export const metadata = { title: "تقرير عميل | طباعة" };

export default async function PrintCustomer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  // جولة واحدة متوازية (كانت جولتين): العميل والهوية وكل ما يتبعه بالمعرّف؛ القاعدة تقيد كل جدول بالصلاحية
  const [{ data: c }, b, sites, devices, techs] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("customer_sites").select("id, ref_no, name, city, contact_name, contact_phone").eq("customer_id", id).is("archived_at", null).order("name"),
    supabase.from("devices").select("id, ref_no, name, serial_number, status, last_maintenance_at, next_maintenance_at, site:customer_sites(name), system:safety_systems(name)")
      .eq("customer_id", id).is("archived_at", null).order("ref_no").limit(1000),
    supabase.from("technician_customers").select("technician:technicians(ref_no, full_name, phone)").eq("customer_id", id),
  ]);
  if (!c || !b) notFound();
  type Dev = { id: string; ref_no: string; name: string; serial_number: string | null; status: string; last_maintenance_at: string | null; next_maintenance_at: string | null; site: { name: string } | null; system: { name: string } | null };
  const devs = (devices.data ?? []) as unknown as Dev[];
  const t = ((techs.data ?? []) as unknown as { technician: { ref_no: string; full_name: string; phone: string | null } | null }[]).map((x) => x.technician).filter(Boolean);
  const overdue = devs.filter((d) => d.next_maintenance_at && d.next_maintenance_at < new Date().toISOString().slice(0, 10)).length;

  return (
    <>
      <PrintToolbar />
      <PrintDocument b={b} title={`تقرير العميل: ${c.name}`} refNo={c.ref_no} meta={[
          ["النوع", customerType[c.customer_type] ?? c.customer_type], ["جهة الاتصال", c.contact_name], ["الهاتف", c.phone && <span dir="ltr">{c.phone}</span>],
          ["المدينة", c.city], ["عدد المواقع", String(sites.data?.length ?? 0)], ["عدد الأجهزة", `${devs.length}${overdue ? ` (متأخرة: ${overdue})` : ""}`],
        ]}>
        {(sites.data ?? []).length > 0 && <>
          <h2>المواقع والفروع</h2>
          <table>
            <thead><tr><th>الرقم</th><th>الموقع</th><th>المدينة</th><th>المسؤول</th><th>الهاتف</th></tr></thead>
            <tbody>{(sites.data ?? []).map((s) => <tr key={s.id}><td dir="ltr">{s.ref_no}</td><td>{s.name}</td><td>{s.city ?? ""}</td><td>{s.contact_name ?? ""}</td><td dir="ltr">{s.contact_phone ?? ""}</td></tr>)}</tbody>
          </table>
        </>}
        {t.length > 0 && <>
          <h2>الفنيون المسندون</h2>
          <p className="text-[11px]">{t.map((x) => `${x!.full_name} (${x!.ref_no})`).join("، ")}</p>
        </>}
        <h2>كشف الأجهزة</h2>
        {devs.length === 0 ? <p className="text-[11px] text-slate-600">لا توجد أجهزة مسجلة لهذا العميل.</p> : <table>
          <thead><tr><th>#</th><th>الرقم</th><th>الجهاز</th><th>النظام</th><th>الموقع</th><th>التسلسلي</th><th>الحالة</th><th>آخر صيانة</th><th>القادمة</th></tr></thead>
          <tbody>
            {devs.map((d, i) => (
              <tr key={d.id}><td>{i + 1}</td><td dir="ltr">{d.ref_no}</td><td>{d.name}</td><td>{d.system?.name ?? ""}</td><td>{d.site?.name ?? ""}</td>
                <td dir="ltr">{d.serial_number ?? ""}</td><td>{deviceStatus[d.status]?.label ?? d.status}</td>
                <td>{d.last_maintenance_at ? formatDate(d.last_maintenance_at) : ""}</td><td>{d.next_maintenance_at ? formatDate(d.next_maintenance_at) : ""}</td></tr>
            ))}
          </tbody>
        </table>}
      </PrintDocument>
    </>
  );
}
