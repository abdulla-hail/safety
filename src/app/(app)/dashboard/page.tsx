import type { Metadata } from "next";
import Link from "next/link";
import StatCard from "@/components/dashboard/StatCard";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, daysUntil, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { deviceStatus, visitStatus } from "@/lib/labels";

export const metadata: Metadata = { title: "لوحة التحكم | عين السلامة" };

const OPEN_WO = ["new", "scheduled", "in_progress", "on_hold"];

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const supabase = await createClient();
  const org = ctx.orgId;
  const today = todayISO();
  const field = ctx.can("field.assigned");
  const seeDevices = ctx.can("devices.view") || field;
  const seeVisits = ctx.canAny("visits.view") || field;
  const seeWo = ctx.canAny("work_orders.view") || field;
  const seeCustomers = ctx.can("customers.view") || field;


  const startToday = new Date(`${today}T00:00:00+03:00`).toISOString();
  const endToday = new Date(`${addDaysISO(today, 1)}T00:00:00+03:00`).toISOString();
  const head = { count: "exact" as const, head: true };

  // فحص التنبيهات الآلية يعمل بالتوازي مع الإحصاءات (محدود بمرة كل ساعة لكل شركة داخل قاعدة البيانات)
  const [, customers, devices, overdue, dueSoon, openWo, urgentWo, todayVisits, upcomingVisits, overdueList] = await Promise.all([
    supabase.rpc("run_maintenance_alerts", { p_company: org }),
    seeCustomers ? supabase.from("customers").select("id", head).eq("company_id", org).is("archived_at", null) : null,
    seeDevices ? supabase.from("devices").select("id", head).eq("company_id", org).is("archived_at", null) : null,
    seeDevices ? supabase.from("devices").select("id", head).eq("company_id", org).is("archived_at", null).lt("next_maintenance_at", today) : null,
    seeDevices ? supabase.from("devices").select("id", head).eq("company_id", org).is("archived_at", null).gte("next_maintenance_at", today).lte("next_maintenance_at", addDaysISO(today, 30)) : null,
    seeWo ? supabase.from("work_orders").select("id", head).eq("company_id", org).is("archived_at", null).in("status", OPEN_WO) : null,
    seeWo ? supabase.from("work_orders").select("id", head).eq("company_id", org).is("archived_at", null).in("status", OPEN_WO).in("priority", ["high", "critical"]) : null,
    seeVisits ? supabase.from("visits").select("id", head).eq("company_id", org).is("archived_at", null).gte("scheduled_start", startToday).lt("scheduled_start", endToday).neq("status", "cancelled") : null,
    seeVisits
      ? supabase.from("visits").select("id, ref_no, scheduled_start, status, customer:customers(name), site:customer_sites(name)")
          .eq("company_id", org).is("archived_at", null).gte("scheduled_start", startToday).in("status", ["scheduled", "in_progress"])
          .order("scheduled_start").limit(8)
      : null,
    seeDevices
      ? supabase.from("devices").select("id, ref_no, name, status, next_maintenance_at, customer:customers(name)")
          .eq("company_id", org).is("archived_at", null).lte("next_maintenance_at", addDaysISO(today, 14))
          .order("next_maintenance_at").limit(8)
      : null,
  ]);

  type VisitRow = { id: string; ref_no: string; scheduled_start: string; status: string; customer: { name: string } | null; site: { name: string } | null };
  type DevRow = { id: string; ref_no: string; name: string; status: string; next_maintenance_at: string; customer: { name: string } | null };
  const visits = (upcomingVisits?.data ?? []) as unknown as VisitRow[];
  const dueDevices = (overdueList?.data ?? []) as unknown as DevRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="لوحة التحكم" description={`نظرة عامة على نشاط ${ctx.active.organization_name} — ${formatDate(today)}`} />

      <section aria-label="إحصائيات سريعة" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {seeVisits && <StatCard title="زيارات اليوم" value={todayVisits?.count ?? 0} hint="غير الملغاة" icon="calendar" tone="primary" href="/visits" />}
        {seeWo && <StatCard title="أوامر عمل مفتوحة" value={openWo?.count ?? 0} hint={`${urgentWo?.count ?? 0} بأولوية عالية أو حرجة`} icon="clipboard" tone="warning" href="/work-orders" />}
        {seeDevices && <StatCard title="صيانة متأخرة" value={overdue?.count ?? 0} hint={`${dueSoon?.count ?? 0} مستحقة خلال 30 يومًا`} icon="shieldAlert" tone="danger" href="/devices?due=overdue" />}
        {seeDevices && <StatCard title="الأجهزة المسجلة" value={devices?.count ?? 0} hint={seeCustomers ? `لدى ${customers?.count ?? 0} عميل` : "الأجهزة النشطة"} icon="shield" tone="success" href="/devices" />}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {seeVisits && (
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>الزيارات القادمة</h2><Link href="/visits" className={`${link} text-xs`}>عرض الكل</Link></div>
            {visits.length === 0 ? <p className="p-6 text-sm text-slate-500">لا توجد زيارات قادمة.</p> : (
              <ul className="divide-y divide-slate-100">
                {visits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <Link href={`/visits/${v.id}`} className={link}>{v.customer?.name ?? "—"}</Link>
                      <p className="text-xs text-slate-500">{v.site?.name ?? "—"} · <span dir="ltr">{v.ref_no}</span></p>
                    </div>
                    <div className="text-end">
                      <p className="text-xs">{formatDateTime(v.scheduled_start)}</p>
                      <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {seeDevices && (
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>أجهزة تستحق الصيانة (14 يومًا)</h2><Link href="/reports/maintenance-due" className={`${link} text-xs`}>التقرير</Link></div>
            {dueDevices.length === 0 ? <p className="p-6 text-sm text-slate-500">لا توجد أجهزة مستحقة الصيانة قريبًا.</p> : (
              <ul className="divide-y divide-slate-100">
                {dueDevices.map((d) => {
                  const days = daysUntil(d.next_maintenance_at);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <Link href={`/devices/${d.id}`} className={link}>{d.name}</Link>
                        <p className="text-xs text-slate-500">{d.customer?.name ?? "—"} · <span dir="ltr">{d.ref_no}</span></p>
                      </div>
                      <div className="text-end">
                        <p className={`text-xs font-semibold ${days !== null && days < 0 ? "text-danger" : "text-amber-700"}`}>
                          {days === null ? "—" : days < 0 ? `متأخرة ${-days} يومًا` : days === 0 ? "اليوم" : `بعد ${days} يومًا`}
                        </p>
                        <StatusBadge {...(deviceStatus[d.status] ?? { label: d.status, tone: "neutral" })} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
      {!seeDevices && !seeVisits && !seeWo && (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          لا توجد لديك صلاحيات عرض تشغيلية بعد. اطلب من مدير الشركة منحك الصلاحيات المناسبة لعملك.
        </p>
      )}
    </div>
  );
}
