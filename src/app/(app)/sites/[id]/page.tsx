import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { formatDate } from "@/lib/format";
import { deviceStatus } from "@/lib/labels";
import MapView from "@/components/map/MapView";
import { classifyLocation, directionsHref, directionsUrl, LOCATION_KIND_LABEL, locationHref, validLatLng } from "@/lib/geo";

export const metadata = { title: "بيانات الموقع | عين السلامة" };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("sites.view", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: s }, { data: devices, count }] = await Promise.all([
    supabase.from("customer_sites").select("*, customer:customers(id, name)").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("devices").select("id, ref_no, name, status, location_detail, next_maintenance_at", { count: "exact" })
      .eq("company_id", ctx.orgId).eq("site_id", id).is("archived_at", null).order("ref_no").limit(200),
  ]);
  if (!s) notFound();
  const pos = validLatLng(s.latitude, s.longitude);
  const locText: string | null = (s as { location_text?: string | null }).location_text ?? null;
  const openHref = locationHref({ ...s, location_text: locText });
  const dirHref = directionsHref({ ...s, location_text: locText });

  return (
    <div className="space-y-6">
      <PageHeader title={s.name} refNo={s.ref_no}
        crumbs={[{ label: "العملاء", href: "/customers" }, { label: s.customer?.name ?? "—", href: `/customers/${s.customer_id}` }, { label: s.name }]}
        description={s.archived_at ? `مؤرشف منذ ${formatDate(s.archived_at)}` : undefined}
        actions={<>
          {ctx.can("devices.print") && (count ?? 0) > 0 && <Link href={`/print/labels?site=${id}&size=a4-6`} className={btnSecondary}>طباعة باركود أجهزة الموقع</Link>}
          {ctx.can("reports.print") && (count ?? 0) > 0 && <Link href={`/print/devices?site=${id}`} className={btnSecondary}>طباعة بيانات أجهزة الموقع</Link>}
          {ctx.canAny("visits.create", "field.assigned") && !s.archived_at && <Link href={`/visits/new?type=survey&customer=${s.customer_id}&site=${id}`} className={btnPrimary}>+ زيارة معاينة</Link>}
          {ctx.can("sites.update") && <Link href={`/sites/${id}/edit`} className={btnSecondary}>تعديل</Link>}
          <RecordActions table="customer_sites" id={id} archived={!!s.archived_at} back={`/sites/${id}`} listPath="/sites" noun="الموقع"
            canArchive={ctx.can("sites.archive")} canDelete={ctx.can("sites.delete")} />
        </>} />
      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>بيانات الفرع</h2>
          {openHref && <div className="flex flex-wrap gap-2">
            {dirHref && <a href={dirHref} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} ${btnSm}`}>الاتجاهات إلى الفرع</a>}
            <a href={openHref} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>📍 فتح في خرائط Google</a>
          </div>}</div>
        <InfoGrid items={[
          ["العميل", s.customer && <Link href={`/customers/${s.customer.id}`} className={link}>{s.customer.name}</Link>],
          ["المدينة", s.city], ["الحي", s.district], ["العنوان", s.address],
          ["الموقع", locText && <span className="break-all" dir="auto">{locText} <span className="ms-1 rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{LOCATION_KIND_LABEL[classifyLocation(locText)]}</span></span>],
          ["الإحداثيات", pos && <span dir="ltr">{pos.lat}, {pos.lng}</span>],
          ["المسؤول", s.contact_name], ["الهاتف", s.contact_phone && <a href={`tel:${s.contact_phone}`} dir="ltr" className={link}>{s.contact_phone}</a>], ["ملاحظات", s.notes],
        ]} />
        <div className="border-t border-slate-100 p-5">
          {pos ? <MapView markers={[{ ...pos, label: s.name, directions: directionsUrl(pos) }]} height={280} />
            : <p className="text-sm text-slate-500">{locText ? "لم تُحدَّد نقطة الفرع على الخريطة؛ زر «فتح في خرائط Google» يستخدم نص الموقع المحفوظ." : "لم يُحدَّد موقع الفرع على الخريطة بعد."}{ctx.can("sites.update") && <> <Link href={`/sites/${id}/edit`} className={link}>حدده الآن</Link></>}</p>}
        </div>
      </section>
      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>أجهزة الموقع ({count ?? 0})</h2>
          {ctx.can("devices.create") && !s.archived_at && <Link href={`/devices/new?customer=${s.customer_id}&site=${id}`} className={`${btnPrimary} ${btnSm}`}>+ تسجيل جهاز</Link>}
        </div>
        <ul className="divide-y divide-slate-100">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <Link href={`/devices/${d.id}`} className={link}>{d.name}</Link>
                <p className="text-xs text-slate-500"><span dir="ltr">{d.ref_no}</span> · {d.location_detail ?? ""}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span>القادمة: {formatDate(d.next_maintenance_at)}</span>
                <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
              </div>
            </li>
          ))}
          {(devices ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد أجهزة في هذا الموقع.</li>}
        </ul>
      </section>
    </div>
  );
}
