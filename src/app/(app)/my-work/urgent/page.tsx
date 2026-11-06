import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import PhasePending from "@/components/PhasePending";
import { btnSecondary, card, input, label as labelCls } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasInspections } from "@/lib/schema";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { URGENT_REASONS } from "@/lib/visits";
import UrgentForm from "./UrgentForm";

export const metadata = { title: "زيارة طارئة | عين السلامة" };

/**
 * الزيارة الطارئة: العميل ← الموقع ← الأجهزة (بحث، أو من صفحة الجهاز بعد مسح رمزه) ← السبب ← بدء الزيارة.
 * القوائم مقيدة بنطاق المستخدم في القاعدة؛ الخطوات بروابط GET فتعمل على أي جهاز وتُستأنف بالرجوع.
 */
export default async function UrgentVisitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("visits.create", "field.assigned");
  const sp = await searchParams;
  const supabase = await createClient();
  if (!(await hasInspections(supabase))) {
    return <PhasePending title="زيارة طارئة">الزيارة الطارئة متعددة الأجهزة جاهزة في التطبيق وتتطلب تطبيق ترحيل قاعدة البيانات المقترح 20261106000100 بموافقة مدير المنصة.</PhasePending>;
  }
  const deviceParam = isUuid(param(sp, "device")) ? param(sp, "device") : "";
  let siteId = isUuid(param(sp, "site")) ? param(sp, "site") : "";
  let customerId = isUuid(param(sp, "customer")) ? param(sp, "customer") : "";
  const reason = param(sp, "reason") in URGENT_REASONS ? param(sp, "reason") : "";

  // جولة واحدة: المواقع المرئية، وأجهزة الموقع المختار (من الرابط، أو مضمّنة مع جهاز البداية القادم من المسح أو صفحة الجهاز)
  const DEV_COLS = "id, name, ref_no, serial_number, location_detail, status, archived_at, faults:device_faults(id, status)";
  const OPEN_FAULTS = ["open", "in_progress", "awaiting_verification"];
  const [sites, start, siteDevs] = await Promise.all([
    supabase.from("customer_sites").select("id, name, city, customer_id, customer:customers(name)").eq("company_id", ctx.orgId).is("archived_at", null).order("name").limit(500),
    deviceParam && !siteId ? supabase.from("devices").select(`id, site_id, customer_id, site:customer_sites(devices(${DEV_COLS}))`)
      .eq("id", deviceParam).eq("company_id", ctx.orgId).in("site.devices.faults.status", OPEN_FAULTS).maybeSingle() : null,
    siteId ? supabase.from("devices").select(DEV_COLS).eq("company_id", ctx.orgId).eq("site_id", siteId).is("archived_at", null)
      .not("status", "in", "(decommissioned,replaced)").in("faults.status", OPEN_FAULTS).order("name").limit(500) : null,
  ]);
  if (start?.data) { siteId ||= start.data.site_id ?? ""; customerId ||= start.data.customer_id; }
  type S = { id: string; name: string; city: string | null; customer_id: string; customer: { name: string } | null };
  const siteList = (sites.data ?? []) as unknown as S[];
  const site = siteList.find((s) => s.id === siteId) ?? null;
  if (site) customerId = site.customer_id;
  const customers = [...new Map(siteList.map((s) => [s.customer_id, s.customer?.name ?? "—"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));

  type Dv = { id: string; name: string; ref_no: string; serial_number: string | null; location_detail: string | null; status: string; archived_at: string | null; faults: { id: string }[] | null };
  const embedded = ((start?.data as unknown as { site: { devices?: Dv[] } | null } | null)?.site?.devices ?? [])
    .filter((d) => !d.archived_at && !["decommissioned", "replaced"].includes(d.status)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const devs = !site ? null : siteDevs ? { data: siteDevs.data as unknown as Dv[] | null, error: siteDevs.error } : { data: embedded, error: start?.error ?? null };

  const step = site ? 3 : customerId ? 2 : 1;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="زيارة طارئة" crumbs={[{ label: "عملي", href: "/my-work" }, { label: "زيارة طارئة" }]}
        description="لعطل أو بلاغ عميل أو إصلاح أو إعادة فحص أو متابعة؛ يمكن أن تشمل عدة أجهزة لكل منها نتيجته." />
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="الخطوات">
        {["العميل", "الموقع", "الأجهزة والسبب"].map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-brand text-on-brand font-bold" : step > i + 1 ? "bg-brand-soft text-brand-strong" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      <section className={`${card} space-y-4 p-5`}>
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {reason && <input type="hidden" name="reason" value={reason} />}
          <div>
            <label htmlFor="u-c" className={labelCls}>العميل</label>
            <select id="u-c" name="customer" defaultValue={customerId} className={input}>
              <option value="">اختر العميل...</option>{customers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="u-s" className={labelCls}>الموقع</label>
            <select id="u-s" name="site" defaultValue={site?.id ?? ""} className={input} disabled={!customerId}>
              <option value="">{customerId ? "اختر الموقع..." : "اختر العميل أولًا"}</option>
              {siteList.filter((s) => s.customer_id === customerId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ""}</option>)}
            </select>
          </div>
          <button type="submit" className={btnSecondary}>{customerId ? "متابعة" : "عرض المواقع"}</button>
        </form>
        {sites.error && <p role="alert" className="text-sm text-red-700">تعذر تحميل المواقع حاليًا. أعد تحميل الصفحة.</p>}
        {!sites.error && customers.length === 0 && <p className="text-sm text-slate-500">لا توجد مواقع ضمن نطاقك. اطلب من المشرف إسنادك إلى عميل أو موقع.</p>}
        <p className="text-xs text-slate-500">أو <Link href="/scan" className="underline">امسح رمز QR/الباركود</Link> على الجهاز، ثم اختر «زيارة طارئة لهذا الجهاز» من صفحته.</p>
      </section>

      {site && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 text-base font-bold">{site.customer?.name} — {site.name}</h2>
          {devs?.error ? <p role="alert" className="text-sm text-red-700">تعذر تحميل أجهزة الموقع حاليًا.</p> : (
            <UrgentForm siteId={site.id} clientKey={crypto.randomUUID()} reason={reason} preselect={deviceParam ? [deviceParam] : []}
              devices={((devs?.data ?? []) as unknown as Dv[]).map((d) => ({ id: d.id, name: d.name, ref: d.ref_no,
                hint: [d.location_detail, d.serial_number && `تسلسلي ${d.serial_number}`].filter(Boolean).join(" · "), flagged: (d.faults ?? []).length > 0 }))} />
          )}
        </section>
      )}
    </div>
  );
}
