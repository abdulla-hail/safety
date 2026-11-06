import Form from "next/form";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { btnSecondary, card, input, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { hasPhase5 } from "@/lib/schema";
import { deviceStatus } from "@/lib/labels";
import { isUuid, orIlike, param, type SearchParams } from "@/lib/list";
import DeviceForm, { type CatalogItemOption } from "../DeviceForm";
import { createDevice } from "../actions";

export const metadata = { title: "تسجيل جهاز | عين السلامة" };

export default async function NewDevicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("devices.create");
  const sp = await searchParams;
  const supabase = await createClient();
  // «معطل» و«مستبدل» تتطلبان المرحلة الخامسة في القاعدة
  const customerId = param(sp, "customer");
  const crumbs = [{ label: "الأجهزة", href: "/devices" }, { label: "تسجيل جهاز" }];
  // العميل والمواقع والكتالوج تُطلب معًا في جولة واحدة (المواقع مقيدة بالعميل المطلوب نفسه)
  const picked = isUuid(customerId);
  const [phase5Ready, { data: customer }, sites, systems, items] = await Promise.all([
    hasPhase5(supabase),
    picked
      ? supabase.from("customers").select("id, name").eq("id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
    picked ? supabase.from("customer_sites").select("id, name").eq("customer_id", customerId).eq("company_id", ctx.orgId).is("archived_at", null).order("name") : null,
    picked ? supabase.from("safety_systems").select("id, name, default_interval_days").eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("sort_order").order("name") : null,
    picked ? supabase.from("catalog_items").select("id, system_id, name, manufacturer, model, device_type, default_interval_days")
      .eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("name") : null,
  ]);
  const statusKeys = Object.keys(deviceStatus).filter((k) => !["faulty", "replaced"].includes(k) || phase5Ready);

  if (!customer || !sites || !systems || !items) {
    // اختيار العميل أولًا (بحث من قاعدة البيانات دون تحميل كل العملاء)
    let q = supabase.from("customers").select("id, ref_no, name, city").eq("company_id", ctx.orgId).is("archived_at", null).order("name").limit(30);
    const s = orIlike(["name", "ref_no", "city"], param(sp, "q"));
    if (s) q = q.or(s);
    const { data: list } = await q;
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="تسجيل جهاز" crumbs={crumbs} description="الخطوة الأولى: اختر العميل الذي سيُركب لديه الجهاز." />
        <section className={`${card} p-5`}>
          <Form action="/devices/new" className="mb-4 flex gap-2">
            <input name="q" type="search" defaultValue={param(sp, "q")} placeholder="ابحث عن العميل..." className={input} aria-label="بحث عن العميل" />
            <button type="submit" className={btnSecondary}>بحث</button>
          </Form>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(list ?? []).map((c) => (
              <li key={c.id}>
                <Link href={`/devices/new?customer=${c.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs text-slate-500" dir="ltr">{c.ref_no} {c.city ? `· ${c.city}` : ""}</span>
                </Link>
              </li>
            ))}
            {(list ?? []).length === 0 && <li className="p-4 text-sm text-slate-500">لا يوجد عملاء مطابقون. <Link href="/customers/new" className={link}>أضف عميلًا</Link></li>}
          </ul>
        </section>
      </div>
    );
  }

  const siteParam = param(sp, "site");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="تسجيل جهاز" crumbs={crumbs} description={<>لدى العميل: <Link className={link} href={`/customers/${customer.id}`}>{customer.name}</Link> · <Link className="underline" href="/devices/new">تغيير العميل</Link></>} />
      {(systems.data ?? []).length === 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">لا توجد أنظمة سلامة مفعّلة في الكتالوج. <Link href="/catalog" className="underline">أضف نظامًا في كتالوج أجهزة السلامة</Link> أولًا.</p>
      )}
      <section className={`${card} p-6`}>
        <DeviceForm action={createDevice} mode="create" clientId={crypto.randomUUID()} statusKeys={statusKeys} customer={customer} sites={sites.data ?? []} systems={systems.data ?? []}
          items={(items.data ?? []) as CatalogItemOption[]} initial={{ site_id: isUuid(siteParam) ? siteParam : "" }} cancelHref={`/customers/${customer.id}`} />
      </section>
    </div>
  );
}
