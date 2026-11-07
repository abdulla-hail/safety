import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasInspections, hasPhase5 } from "@/lib/schema";
import { deviceStatus } from "@/lib/labels";
import { isUuid } from "@/lib/list";
import DeviceForm, { type CatalogItemOption } from "../../DeviceForm";
import { brandNames } from "@/lib/brands";
import { updateDevice } from "../../actions";

export const metadata = { title: "تعديل جهاز | عين السلامة" };

export default async function EditDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg("devices.update");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  // «معطل» و«مستبدل» تتطلبان المرحلة الخامسة في القاعدة
  const [phase5Ready, dueLocked, brands] = await Promise.all([hasPhase5(supabase), hasInspections(supabase), brandNames(supabase, ctx.orgId)]);
  const statusKeys = Object.keys(deviceStatus).filter((k) => !["faulty", "replaced"].includes(k) || phase5Ready);
  // جولة واحدة: الجهاز مع مواقع عميله وتعريف كتالوجه مضمّنين، والأنظمة بالتوازي (كانت جولتين متتابعتين)
  const [{ data: d }, systems] = await Promise.all([
    supabase.from("devices").select("*, customer:customers(id, name, sites:customer_sites(id, name, archived_at)), item:catalog_items(id, system_id, name, manufacturer, model, device_type, default_interval_days)")
      .eq("id", id).eq("company_id", ctx.orgId).is("customer.sites.archived_at", null).maybeSingle(),
    supabase.from("safety_systems").select("id, name, default_interval_days").eq("company_id", ctx.orgId).order("name"),
  ]);
  if (!d || !d.customer) notFound();
  const imageUrl = d.image_path ? `/device-image/${id}?v=${encodeURIComponent(d.image_path)}` : null;
  const sites = { data: [...((d.customer as { sites?: { id: string; name: string }[] }).sites ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ar")) };
  const items = { data: d.item ? [d.item] : [] };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${d.name}`} refNo={d.ref_no}
        crumbs={[{ label: "الأجهزة", href: "/devices" }, { label: d.name, href: `/devices/${id}` }, { label: "تعديل" }]}
        description="تعديل البيانات لا يغيّر الرقم المرجعي ولا رمز QR، ولا يعدّل سجلات الصيانة السابقة." />
      <section className={`${card} p-6`}>
        <DeviceForm brands={brands} action={updateDevice} mode="edit" statusKeys={statusKeys} customer={d.customer} sites={sites.data ?? []} systems={systems.data ?? []}
          items={(items.data ?? []) as CatalogItemOption[]} initial={d} cancelHref={`/devices/${id}`} currentImageUrl={imageUrl} dueLocked={dueLocked} />
      </section>
    </div>
  );
}
