import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EntityForm from "@/components/ui/EntityForm";
import CustomerPicker from "@/components/CustomerPicker";
import { card, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { visitType } from "@/lib/labels";
import { nowISO, toLocalInput } from "@/lib/format";
import { createVisit } from "../actions";
import { createSurvey } from "../survey-actions";

export const metadata = { title: "زيارة جديدة | عين السلامة" };

/** زيارة جديدة: «معاينة» (الافتراضي — تُسعَّر وتتحول إلى عرض سعر) أو زيارة صيانة. خطوتان فقط: العميل ثم النموذج. */
export default async function NewVisitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("visits.create", "field.assigned");
  const sp = await searchParams;
  const manager = ctx.can("visits.create");
  const survey = !manager || param(sp, "type") !== "maintenance";
  const typeQs = survey ? "type=survey" : "type=maintenance";
  const supabase = await createClient();
  const customerId = param(sp, "customer");
  const ok = isUuid(customerId);
  const [cust, sites, techs, assigned] = ok ? await Promise.all([
    supabase.from("customers").select("id, name").eq("id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).maybeSingle(),
    supabase.from("customer_sites").select("id, name, city").eq("company_id", ctx.orgId).eq("customer_id", customerId).is("archived_at", null).order("name"),
    manager ? supabase.from("technicians").select("id, full_name").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name") : Promise.resolve(null),
    manager ? supabase.from("technician_customers").select("technician_id").eq("company_id", ctx.orgId).eq("customer_id", customerId) : Promise.resolve(null),
  ]) : [null, null, null, null];
  const customer = cust?.data ?? null;
  const crumbs = [{ label: "الزيارات والمعاينات", href: "/visits" }, { label: "جديدة" }];
  const title = survey ? "زيارة معاينة جديدة" : "زيارة صيانة جديدة";
  const switcher = manager && (
    <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm" role="tablist" aria-label="نوع الزيارة">
      {([["survey", "معاينة وتسعير"], ["maintenance", "زيارة صيانة"]] as const).map(([k, l]) => {
        const on = (k === "survey") === survey;
        const qs = new URLSearchParams({ type: k, ...(ok ? { customer: customerId } : {}) });
        return <Link key={k} href={`/visits/new?${qs}`} role="tab" aria-selected={on}
          className={`rounded-md px-4 py-1.5 font-semibold ${on ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</Link>;
      })}
    </div>
  );

  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={title} crumbs={crumbs} description="الخطوة 1 من 2: اختر العميل." />
        {switcher}
        <CustomerPicker orgId={ctx.orgId} basePath={`/visits/new?${typeQs}`} search={param(sp, "q")} />
      </div>
    );
  }

  const siteOpts = (sites?.data ?? []).map((s) => ({ value: s.id, label: s.city ? `${s.name} — ${s.city}` : s.name }));
  const presetSite = isUuid(param(sp, "site")) ? param(sp, "site") : siteOpts.length === 1 ? siteOpts[0].value : "";
  const assignedIds = new Set((assigned?.data ?? []).map((a) => a.technician_id));
  const techOpts = (techs?.data ?? []).map((t) => ({ value: t.id, label: `${t.full_name}${assignedIds.has(t.id) ? " ★" : ""}` }));
  const now = toLocalInput(nowISO());
  const desc = <>العميل: <Link className={link} href={`/customers/${customer.id}`}>{customer.name}</Link> · <Link className="underline" href={`/visits/new?${typeQs}`}>تغيير</Link></>;

  if (siteOpts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={title} crumbs={crumbs} description={desc} />
        <section className={`${card} p-6 text-sm`}>
          لا توجد فروع لهذا العميل بعد. <Link href={`/customers/${customer.id}#branches`} className={link}>أضف فرعًا مع موقعه على الخريطة</Link> ثم عُد لإنشاء الزيارة.
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={title} crumbs={crumbs} description={desc} />
      {switcher}
      <section className={`${card} p-6`}>
        {survey ? (
          <EntityForm action={createSurvey} submitLabel="إنشاء المعاينة" cancelHref="/visits"
            initial={{ site_id: presetSite, scheduled_start: now, technician_id: [...assignedIds][0] ?? "", client_key: crypto.randomUUID() }}
            fields={[
              { name: "client_key", label: "", type: "hidden" },
              { name: "site_id", label: "الفرع", type: "select", required: true, options: siteOpts },
              { name: "scheduled_start", label: "موعد الزيارة", type: "datetime-local", required: true },
              ...(manager ? [{ name: "technician_id", label: "الفني المسؤول", type: "select" as const, options: techOpts, help: "★ مسند لهذا العميل. اتركه فارغًا لتعيينه لاحقًا." }] : []),
              { name: "notes", label: "ملاحظات للفني", type: "textarea", wide: true },
            ]}>
            {!manager && <p className="text-xs text-slate-500 sm:col-span-2">ستُسند المعاينة إليك.</p>}
          </EntityForm>
        ) : (
          <EntityForm action={createVisit} submitLabel="جدولة الزيارة" cancelHref="/visits"
            initial={{ customer_id: customer.id, site_id: presetSite, visit_type: "periodic", technician_ids: [...assignedIds] }}
            fields={[
              { name: "customer_id", label: "", type: "hidden" },
              { name: "visit_type", label: "نوع الزيارة", type: "select", required: true,
                options: Object.entries(visitType).filter(([k]) => k !== "survey").map(([value, label]) => ({ value, label })) },
              { name: "site_id", label: "الفرع", type: "select", options: siteOpts },
              { name: "scheduled_start", label: "موعد البدء", type: "datetime-local", required: true },
              { name: "scheduled_end", label: "موعد الانتهاء المتوقع", type: "datetime-local" },
              { name: "technician_ids", label: "الفنيون (المسندون لهذا العميل محددون مسبقًا)", type: "checkboxes", options: techOpts, wide: true },
              { name: "notes", label: "ملاحظات", type: "textarea", wide: true },
            ]} />
        )}
      </section>
    </div>
  );
}
