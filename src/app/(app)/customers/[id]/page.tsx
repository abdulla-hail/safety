import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import MultiSelectForm from "@/components/ui/MultiSelectForm";
import ActionButton from "@/components/ui/ActionButton";
import EntityForm from "@/components/ui/EntityForm";
import { btnPrimary, btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/format";
import { customerType, deviceStatus, maintenanceResult, quoteStatus, visitStatus, visitType } from "@/lib/labels";
import MapView from "@/components/map/MapView";
import LocationPicker from "@/components/map/LocationPicker";
import { directionsUrl, mapUrl, validLatLng } from "@/lib/geo";
import { assignTechniciansToCustomer, setAssignmentScope, setPrimaryTechnician, unassign } from "../actions";
import { createSite } from "../../sites/actions";
import { setCustomerSchedule } from "../../devices/actions";
import { siteFields } from "../fields";

export const metadata = { title: "بيانات العميل | عين السلامة" };

const DEVICE_LIMIT = 200;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("customers.view", "field.assigned");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const org = ctx.orgId;

  // كل الاستعلامات تعتمد على المعرّف فقط، فتُنفذ معًا في جولة واحدة (RLS يقيّد كلًا منها)
  const canAssign = ctx.can("assignments.manage");
  const [{ data: c }, sites, devices, assigned, techs, quotes, visits, records, events] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).eq("company_id", org).maybeSingle(),
    supabase.from("customer_sites").select("id, ref_no, name, city, district, address, contact_name, contact_phone, latitude, longitude, archived_at").eq("customer_id", id).order("name"),
    supabase.from("devices").select("id, ref_no, name, status, next_maintenance_at, site_id", { count: "exact" })
      .eq("customer_id", id).is("archived_at", null).order("next_maintenance_at", { nullsFirst: false }).limit(DEVICE_LIMIT),
    supabase.from("technician_customers").select("is_primary, sites:technician_customer_sites(site_id), technician:technicians(id, ref_no, full_name, phone)").eq("customer_id", id),
    canAssign ? supabase.from("technicians").select("id, ref_no, full_name").eq("company_id", org).is("archived_at", null).eq("is_active", true).order("full_name") : null,
    ctx.canAny("quotes.view", "quotes.manage") ? supabase.from("quotations").select("id, ref_no, issue_date, status").eq("customer_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(5) : null,
    supabase.from("visits").select("id, ref_no, scheduled_start, status, visit_type").eq("customer_id", id).is("archived_at", null).order("scheduled_start", { ascending: false }).limit(5),
    supabase.from("maintenance_records").select("id, ref_no, performed_at, result, device_name_snapshot, device_id").eq("customer_id", id).order("performed_at", { ascending: false }).limit(5),
    canAssign ? supabase.from("technician_assignment_events").select("id, event, reason, occurred_at, site_id, technician:technicians(full_name)")
      .eq("customer_id", id).order("occurred_at", { ascending: false }).limit(20) : null,
  ]);
  if (!c) notFound();

  type Tech = { id: string; ref_no: string; full_name: string; phone: string | null; isPrimary: boolean; siteIds: string[] };
  type Row = { is_primary: boolean; sites: { site_id: string }[] | null; technician: Omit<Tech, "isPrimary" | "siteIds"> | null };
  const assignedTechs: Tech[] = ((assigned.data ?? []) as unknown as Row[]).filter((r) => r.technician)
    .map((r) => ({ ...r.technician!, isPrimary: r.is_primary, siteIds: (r.sites ?? []).map((s) => s.site_id) }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const siteName = new Map((sites.data ?? []).map((s) => [s.id, s.name]));
  const activeSites = (sites.data ?? []).filter((s) => !s.archived_at);
  const mapped = activeSites.flatMap((s) => { const p = validLatLng(s.latitude, s.longitude); return p ? [{ ...p, label: s.name, href: `/sites/${s.id}`, directions: directionsUrl(p) }] : []; });
  const canSurvey = ctx.canAny("visits.create", "field.assigned") && !c.archived_at;
  type Ev = { id: string; event: string; reason: string | null; occurred_at: string; site_id: string | null; technician: { full_name: string } | null };
  const EVENT: Record<string, string> = { assigned: "إسناد", unassigned: "إلغاء إسناد", primary_set: "تعيين فني أساسي", primary_cleared: "إلغاء الفني الأساسي", site_added: "إضافة موقع للنطاق", site_removed: "إزالة موقع من النطاق" };
  const assignedIds = new Set(assignedTechs.map((t) => t.id));
  const techOptions = (techs?.data ?? []).filter((t) => !assignedIds.has(t.id)).map((t) => ({ value: t.id, label: t.full_name, hint: t.ref_no }));
  type Dev = { id: string; ref_no: string; name: string; status: string; next_maintenance_at: string | null; site_id: string | null };
  const back = `/customers/${id}`;
  // أجهزة العميل مجمعة حسب مواقعه (بترتيب المواقع)، والأجهزة القديمة بلا موقع في مجموعة مستقلة للمعالجة
  const devList = (devices.data ?? []) as unknown as Dev[];
  const groups = [
    ...(sites.data ?? []).map((s) => ({ key: s.id, title: s.name, href: `/sites/${s.id}`, archived: !!s.archived_at, items: devList.filter((d) => d.site_id === s.id) })),
    { key: "none", title: "بلا موقع — تحتاج ربطًا بموقعها الصحيح", href: null, archived: false, items: devList.filter((d) => !d.site_id) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={c.name} refNo={c.ref_no}
        crumbs={[{ label: "العملاء", href: "/customers" }, { label: c.name }]}
        description={c.archived_at ? `مؤرشف منذ ${formatDate(c.archived_at)}` : undefined}
        actions={<>
          {ctx.can("reports.print") && <Link href={`/print/customer/${id}`} className={btnSecondary}>طباعة تقرير العميل</Link>}
          {ctx.can("devices.print") && (devices.count ?? 0) > 0 && <Link href={`/print/labels?customer=${id}&size=a4-6`} className={btnSecondary}>طباعة باركود الأجهزة</Link>}
          {ctx.can("reports.print") && (devices.count ?? 0) > 0 && <Link href={`/print/devices?customer=${id}`} className={btnSecondary}>طباعة بيانات الأجهزة</Link>}
          {canSurvey && activeSites.length > 0 && <Link href={`/visits/new?type=survey&customer=${id}`} className={btnPrimary}>+ زيارة معاينة</Link>}
          {ctx.can("customers.update") && <Link href={`/customers/${id}/edit`} className={btnSecondary}>تعديل</Link>}
          <RecordActions table="customers" id={id} archived={!!c.archived_at} back={back} listPath="/customers" noun="العميل"
            canArchive={ctx.can("customers.archive")} canDelete={ctx.can("customers.delete")} />
        </>}
      />

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>البيانات الأساسية</h2>
          <StatusBadge label={c.is_active ? "نشط" : "غير نشط"} tone={c.is_active ? "success" : "neutral"} />
        </div>
        <InfoGrid items={[
          ["النوع", customerType[c.customer_type] ?? c.customer_type],
          ["جهة الاتصال", c.contact_name],
          ["الهاتف", c.phone && <span dir="ltr">{c.phone}</span>],
          ["البريد", c.email && <span dir="ltr">{c.email}</span>],
          ["المدينة", c.city],
          ["العنوان", c.address],
          ["السجل التجاري", c.commercial_registration],
          ["الرقم الضريبي", c.vat_number],
          ["تاريخ الإضافة", formatDate(c.created_at)],
          ["ملاحظات", c.notes],
        ]} />
      </section>

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>الفروع والمواقع ({activeSites.length})</h2>
          <span className="text-xs text-slate-500">{mapped.length} منها محدد على الخريطة</span>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1.2fr]">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(sites.data ?? []).map((s) => {
              const p = validLatLng(s.latitude, s.longitude);
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/sites/${s.id}`} className={link}>{s.name}</Link>
                    {s.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}
                    <p className="text-xs text-slate-500">{[s.city, s.district, s.address].filter(Boolean).join(" · ") || "—"}</p>
                    {(s.contact_name || s.contact_phone) && <p className="text-xs text-slate-500">{s.contact_name ?? ""} {s.contact_phone && <a href={`tel:${s.contact_phone}`} dir="ltr" className="underline">{s.contact_phone}</a>}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p ? <><a href={mapUrl(p)} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>📍 الموقع</a><a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm}`}>الاتجاهات</a></>
                      : <span className="text-[11px] text-amber-700">بلا موقع على الخريطة</span>}
                    {ctx.can("sites.update") && !s.archived_at && <Link href={`/sites/${s.id}/edit`} className={`${btnSecondary} ${btnSm}`}>تعديل الفرع والموقع</Link>}
                    {canSurvey && !s.archived_at && <Link href={`/visits/new?type=survey&customer=${id}&site=${s.id}`} className={`${btnSecondary} ${btnSm}`}>معاينة</Link>}
                  </div>
                </li>
              );
            })}
            {(sites.data ?? []).length === 0 && <li className="px-4 py-4 text-sm text-slate-500">لا توجد فروع بعد. أضف أول فرع وحدد موقعه على الخريطة.</li>}
          </ul>
          {mapped.length > 0 ? <MapView markers={mapped} height={320} />
            : <p className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">حدد مواقع الفروع على الخريطة لتظهر هنا مع الاتجاهات إليها.</p>}
        </div>
        {ctx.can("sites.create") && !c.archived_at && (
          <details className="border-t border-slate-200 px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-primary">+ إضافة فرع لهذا العميل</summary>
            <div className="mt-4">
              <EntityForm action={createSite} fields={[{ name: "customer_id", label: "", type: "hidden" }, ...siteFields]}
                initial={{ customer_id: id }} submitLabel="حفظ الفرع">
                <LocationPicker initial={null} />
              </EntityForm>
            </div>
          </details>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الفنيون المسندون ({assignedTechs.length})</h2></div>
          <ul className="divide-y divide-slate-100">
            {assignedTechs.map((t) => (
              <li key={t.id} className="space-y-2 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    {ctx.can("technicians.view") ? <Link href={`/technicians/${t.id}`} className={link}>{t.full_name}</Link> : <span className="font-semibold">{t.full_name}</span>}
                    {t.isPrimary && <span className="ms-2"><StatusBadge label="المسؤول الأساسي" tone="info" /></span>}
                    <p className="text-xs text-slate-500"><span dir="ltr">{t.ref_no} · {t.phone ?? ""}</span> · النطاق: {t.siteIds.length ? t.siteIds.map((s) => siteName.get(s) ?? "—").join("، ") : "العميل كاملًا"}</p>
                  </div>
                  {canAssign && (
                    <div className="flex flex-wrap items-start gap-2">
                      {!t.isPrimary && t.siteIds.length === 0 && <ActionButton action={setPrimaryTechnician} hidden={{ technician_id: t.id, customer_id: id }} label="تعيين أساسيًا" className={`${btnSecondary} ${btnSm}`} />}
                      {t.isPrimary && <ActionButton action={setPrimaryTechnician} hidden={{ technician_id: "", customer_id: id }} label="إلغاء الأساسي" className={`${btnSecondary} ${btnSm}`} />}
                      <ActionButton action={unassign} hidden={{ technician_id: t.id, customer_id: id }} label="إزالة"
                        confirm={`إزالة ${t.full_name} من هذا العميل؟ لن يُحذف العميل ولا الفني، ويبقى في سجل الإسناد وزياراته السابقة.`} className={`${btnSecondary} ${btnSm}`} />
                    </div>
                  )}
                </div>
                {canAssign && activeSites.length > 1 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-primary">تحديد نطاق المواقع</summary>
                    <div className="mt-2">
                      <EntityForm action={setAssignmentScope} submitLabel="حفظ النطاق"
                        initial={{ customer_id: id, technician_id: t.id, scope: t.siteIds.length ? "sites" : "customer", site_ids: t.siteIds }}
                        fields={[
                          { name: "customer_id", label: "", type: "hidden" },
                          { name: "technician_id", label: "", type: "hidden" },
                          { name: "scope", label: "النطاق", type: "select", options: [{ value: "customer", label: "العميل كاملًا (كل المواقع الحالية والمستقبلية)" }, { value: "sites", label: "مواقع محددة فقط" }] },
                          { name: "site_ids", label: "المواقع (عند اختيار مواقع محددة)", type: "checkboxes", options: activeSites.map((s) => ({ value: s.id, label: s.name })) },
                        ]} />
                    </div>
                  </details>
                )}
              </li>
            ))}
            {assignedTechs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا يوجد فنيون مسندون.</li>}
          </ul>
          {canAssign && (
            <div className="border-t border-slate-200 px-5 py-4">
              <p className="mb-3 text-sm font-semibold">إسناد فنيين إضافيين</p>
              <MultiSelectForm action={assignTechniciansToCustomer} name="technician_ids" hidden={{ customer_id: id }}
                options={techOptions} submitLabel="إسناد المحددين" emptyText="جميع الفنيين النشطين مسندون لهذا العميل." />
              <p className="mt-2 text-xs text-slate-500">الإسناد للعميل كاملًا افتراضيًا، ويمكن تضييقه لمواقع محددة بعد الإسناد. لتكليف فني آخر بزيارة محددة عيّنه في الزيارة دون تغيير المسؤول الأساسي.</p>
            </div>
          )}
          {canAssign && (events?.data ?? []).length > 0 && (
            <details className="border-t border-slate-200 px-5 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-primary">سجل الإسناد</summary>
              <ol className="mt-2 space-y-1 text-xs text-slate-600">
                {((events?.data ?? []) as unknown as Ev[]).map((e) => (
                  <li key={e.id}>{formatDateTime(e.occurred_at)} · {EVENT[e.event] ?? e.event} · {e.technician?.full_name ?? "—"}
                    {e.site_id && ` · ${siteName.get(e.site_id) ?? "موقع"}`}{e.reason && ` · ${e.reason}`}</li>
                ))}
              </ol>
            </details>
          )}
        </section>
      </div>

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>الأجهزة ({devices.count ?? 0})</h2>
          <div className="flex gap-2">
            <Link href={`/devices?customer=${id}`} className={`${btnSecondary} ${btnSm}`}>عرض كل أجهزة العميل</Link>
            {ctx.can("devices.create") && !c.archived_at && <Link href={`/devices/new?customer=${id}`} className={`${btnPrimary} ${btnSm}`}>+ تسجيل جهاز</Link>}
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.key} className="border-t border-slate-100 first:border-t-0">
            <p className={`flex items-center justify-between bg-slate-50 px-5 py-2 text-xs font-bold ${g.key === "none" ? "text-amber-800" : "text-slate-600"}`}>
              <span>{g.href ? <Link href={g.href} className={link}>{g.title}</Link> : g.title}{g.archived && " (مؤرشف)"}</span>
              <span>{g.items.length} جهاز</span>
            </p>
            <ul className="divide-y divide-slate-100">
              {g.items.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <Link href={`/devices/${d.id}`} className={link}>{d.name}</Link>
                    <p className="text-xs text-slate-500" dir="ltr">{d.ref_no}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span>الصيانة القادمة: {formatDate(d.next_maintenance_at)}</span>
                    <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {devList.length === 0 && <p className="px-5 py-4 text-sm text-slate-500">لا توجد أجهزة مسجلة لهذا العميل.</p>}
        {ctx.can("devices.update") && devList.length > 0 && (
          <details className="border-t border-slate-200 px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-primary">ضبط فترة الصيانة لأجهزة العميل</summary>
            <div className="mt-4">
              <EntityForm action={setCustomerSchedule} submitLabel="تطبيق الفترة" initial={{ customer_id: id, maintenance_interval_months: "3" }}
                fields={[
                  { name: "customer_id", label: "", type: "hidden" },
                  { name: "site_id", label: "الأجهزة", type: "select", options: [{ value: "", label: "كل أجهزة العميل" }, ...activeSites.map((s) => ({ value: s.id, label: `أجهزة ${s.name} فقط` }))] },
                  { name: "maintenance_interval_months", label: "الفترة", type: "select", required: true,
                    options: [1, 2, 3, 4, 6, 12].map((m) => ({ value: String(m), label: m === 1 ? "شهر" : m === 2 ? "شهران" : m <= 10 ? `${m} أشهر` : `${m} شهرًا` })) },
                  { name: "schedule_start_date", label: "تاريخ بداية الجدول (اختياري)", type: "date" },
                  { name: "recalculate", label: "إعادة حساب المواعيد القادمة الآن", type: "checkbox", help: "دون هذا الخيار تبقى المواعيد الحالية كما هي، وتسري الفترة الجديدة بعد الصيانة القادمة. يمكن تعديل استثناءات الأجهزة من صفحة كل جهاز." },
                ]} />
            </div>
          </details>
        )}
        {(devices.count ?? 0) > devList.length && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">يُعرض أول {devList.length} جهازًا من {devices.count}. <Link href={`/devices?customer=${id}`} className={link}>عرض الكل</Link></p>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <MiniList title="الزيارات والمعاينات" href={`/visits?customer=${id}`} newHref={canSurvey ? `/visits/new?type=survey&customer=${id}` : undefined}
          items={(visits.data ?? []).map((v) => ({ id: v.id, href: `/visits/${v.id}`, title: `${visitType[v.visit_type] ?? ""} · ${formatDateTime(v.scheduled_start)}`, sub: v.ref_no, badge: visitStatus[v.status] }))} />
        {quotes && <MiniList title="عروض الأسعار" href={`/quotes?customer=${id}`}
          items={(quotes.data ?? []).map((q) => ({ id: q.id, href: `/quotes/${q.id}`, title: formatDate(q.issue_date), sub: q.ref_no ?? "", badge: quoteStatus[q.status] }))} />}
        <MiniList title="آخر عمليات الصيانة" href={`/maintenance?customer=${id}`}
          items={(records.data ?? []).map((r) => ({ id: r.id, href: `/devices/${r.device_id}`, title: r.device_name_snapshot ?? "—", sub: `${r.ref_no} · ${formatDate(r.performed_at)}`, badge: maintenanceResult[r.result] }))} />
      </div>
    </div>
  );
}

function MiniList({ title, href, newHref, items }: {
  title: string; href: string; newHref?: string;
  items: { id: string; href: string; title: string; sub: string; badge?: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } }[];
}) {
  return (
    <section className={card}>
      <div className={cardHeader}>
        <h2 className={cardTitle}>{title}</h2>
        <div className="flex gap-2 text-xs">
          <Link href={href} className={link}>الكل</Link>
          {newHref && <Link href={newHref} className={link}>+ جديد</Link>}
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
            <div className="min-w-0">
              <Link href={i.href} className={`${link} block truncate`}>{i.title}</Link>
              <p className="text-xs text-slate-500" dir="ltr">{i.sub}</p>
            </div>
            {i.badge && <StatusBadge {...i.badge} />}
          </li>
        ))}
        {items.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد سجلات.</li>}
      </ul>
    </section>
  );
}
