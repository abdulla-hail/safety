import { notFound } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { formatDate, nowISO } from "@/lib/format";
import { customerType } from "@/lib/labels";
import { isUuid } from "@/lib/list";
import { classifyLocation, LOCATION_KIND_LABEL, locationHref, validLatLng } from "@/lib/geo";
import { hasLocationText, withLocationText } from "@/lib/schema";

export const metadata = { title: "بيانات العميل وفروعه | طباعة" };

type Site = {
  id: string; ref_no: string; name: string; city: string | null; district: string | null; address: string | null;
  contact_name: string | null; contact_phone: string | null; latitude: number | null; longitude: number | null; notes: string | null;
  location_text?: string | null;
};

/** تقرير A4: بيانات العميل وكل فروعه النشطة بعناوينها ومواقعها (النص كما أُدخل، والإحداثيات، ورابط الفتح في خرائط Google) */
export default async function PrintCustomerBranches({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("reports.print");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const hasText = await hasLocationText(supabase);
  const [{ data: c }, b, sites] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    loadBranding(supabase, ctx.orgId),
    supabase.from("customer_sites").select(withLocationText("id, ref_no, name, city, district, address, contact_name, contact_phone, latitude, longitude, notes", hasText))
      .eq("customer_id", id).eq("company_id", ctx.orgId).is("archived_at", null).order("name"),
  ]);
  if (!c || !b) notFound();
  const rows = (sites.data ?? []) as unknown as Site[];
  const located = rows.filter((s) => locationHref(s)).length;

  return (
    <>
      <PrintToolbar />
      <PrintDocument b={b} title={`بيانات العميل وفروعه: ${c.name}`} refNo={c.ref_no} meta={[
        ["نوع العميل", customerType[c.customer_type] ?? c.customer_type], ["جهة الاتصال", c.contact_name],
        ["الهاتف", c.phone && <span dir="ltr">{c.phone}</span>], ["البريد", c.email && <span dir="ltr">{c.email}</span>],
        ["المدينة", c.city], ["العنوان", c.address], ["السجل التجاري", c.commercial_registration && <span dir="ltr">{c.commercial_registration}</span>],
        ["الرقم الضريبي", c.vat_number && <span dir="ltr">{c.vat_number}</span>],
        ["عدد الفروع", `${rows.length}${rows.length ? ` (بموقع: ${located})` : ""}`], ["تاريخ الطباعة", formatDate(nowISO())],
      ]}>
        <h2>الفروع والمواقع ({rows.length})</h2>
        {rows.length === 0 ? <p className="text-[11px] text-slate-600">لا توجد فروع نشطة لهذا العميل.</p> : (
          <table className="branches-table">
            <thead>
              <tr><th>#</th><th>الفرع</th><th>المدينة / الحي</th><th>العنوان</th><th>الموقع</th><th>المسؤول</th></tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const p = validLatLng(s.latitude, s.longitude);
                const href = locationHref(s);
                const t = (s.location_text ?? "").trim();
                return (
                  <tr key={s.id}>
                    <td>{i + 1}</td>
                    <td><b>{s.name}</b><div className="text-[9px] text-slate-500" dir="ltr">{s.ref_no}</div></td>
                    <td>{[s.city, s.district].filter(Boolean).join(" / ")}</td>
                    <td>{s.address ?? ""}{s.notes && <div className="text-[9px] text-slate-500">{s.notes}</div>}</td>
                    <td className="break-all">
                      {t && <div dir="auto">{t}{classifyLocation(t) !== "address" && <span className="text-[9px] text-slate-500"> ({LOCATION_KIND_LABEL[classifyLocation(t)]})</span>}</div>}
                      {p && <div dir="ltr" className="text-[9px]">{p.lat}, {p.lng}</div>}
                      {href && href !== t && <div dir="ltr" className="text-[8px] text-slate-500">{href}</div>}
                      {!t && !p && !href && "—"}
                    </td>
                    <td>{s.contact_name ?? ""}{s.contact_phone && <div dir="ltr">{s.contact_phone}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </PrintDocument>
    </>
  );
}
