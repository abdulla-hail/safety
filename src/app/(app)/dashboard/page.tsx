import type { Metadata } from "next";
import Link from "next/link";
import StatCard from "@/components/dashboard/StatCard";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { btnPrimary, btnSecondary, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { quoteStatus, visitStatus, visitType } from "@/lib/labels";

export const metadata: Metadata = { title: "لوحة التحكم | عين السلامة" };

/** لوحة مختصرة: أهم الأرقام، والزيارات والمعاينات القادمة، وآخر عروض الأسعار، واختصارات العمل اليومي */
export default async function DashboardPage() {
  const ctx = await requireOrg();
  const supabase = await createClient();
  const org = ctx.orgId;
  const today = todayISO();
  const field = ctx.can("field.assigned");
  const seeDevices = ctx.can("devices.view") || field;
  const seeVisits = ctx.canAny("visits.view") || field;
  const seeQuotes = ctx.canAny("quotes.view", "quotes.manage");

  const startToday = new Date(`${today}T00:00:00+03:00`).toISOString();
  const endToday = new Date(`${addDaysISO(today, 1)}T00:00:00+03:00`).toISOString();
  const head = { count: "exact" as const, head: true };

  // جولة واحدة متوازية؛ فحص التنبيهات الآلية محدود بمرة كل ساعة لكل شركة داخل القاعدة
  const [, todayVisits, openSurveys, overdue, sentQuotes, acceptedQuotes, upcoming, latestQuotes] = await Promise.all([
    supabase.rpc("run_maintenance_alerts", { p_company: org }),
    seeVisits ? supabase.from("visits").select("id", head).eq("company_id", org).is("archived_at", null).gte("scheduled_start", startToday).lt("scheduled_start", endToday).neq("status", "cancelled") : null,
    seeVisits ? supabase.from("visits").select("id", head).eq("company_id", org).is("archived_at", null).eq("visit_type", "survey").in("status", ["scheduled", "in_progress"]) : null,
    seeDevices ? supabase.from("devices").select("id", head).eq("company_id", org).is("archived_at", null).lt("next_maintenance_at", today) : null,
    seeQuotes ? supabase.from("quotations").select("id", head).eq("company_id", org).is("archived_at", null).eq("status", "sent") : null,
    seeQuotes ? supabase.from("quotations").select("id", head).eq("company_id", org).is("archived_at", null).eq("status", "accepted").gte("decided_at", `${today.slice(0, 8)}01T00:00:00+03:00`) : null,
    seeVisits
      ? supabase.from("visits").select("id, ref_no, scheduled_start, status, visit_type, customer:customers(name), site:customer_sites(name)")
          .eq("company_id", org).is("archived_at", null).gte("scheduled_start", startToday).in("status", ["scheduled", "in_progress"])
          .order("scheduled_start").limit(8)
      : null,
    seeQuotes
      ? supabase.from("quotations").select("id, ref_no, issue_date, status, customer:customers(name)").eq("company_id", org).is("archived_at", null)
          .order("created_at", { ascending: false }).limit(6)
      : null,
  ]);

  type VisitRow = { id: string; ref_no: string; scheduled_start: string; status: string; visit_type: string; customer: { name: string } | null; site: { name: string } | null };
  type QuoteRow = { id: string; ref_no: string; issue_date: string; status: string; customer: { name: string } | null };
  const visits = (upcoming?.data ?? []) as unknown as VisitRow[];
  const quotes = (latestQuotes?.data ?? []) as unknown as QuoteRow[];
  const canSurvey = ctx.canAny("visits.create", "field.assigned");

  return (
    <div className="space-y-6">
      <PageHeader title="لوحة التحكم" description={`${ctx.active.organization_name} — ${formatDate(today)}`}
        actions={<>
          {ctx.can("customers.create") && <Link href="/customers/new" className={btnSecondary}>+ عميل</Link>}
          {seeQuotes && ctx.can("quotes.manage") && <Link href="/quotes/new" className={btnSecondary}>+ عرض سعر</Link>}
          {canSurvey && <Link href="/visits/new?type=survey" className={btnPrimary}>+ زيارة معاينة</Link>}
        </>} />

      <section aria-label="إحصائيات سريعة" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {seeVisits && <StatCard title="زيارات اليوم" value={todayVisits?.count ?? 0} hint="غير الملغاة" icon="calendar" tone="primary" href="/visits" />}
        {seeVisits && <StatCard title="معاينات مفتوحة" value={openSurveys?.count ?? 0} hint="مجدولة أو قيد التنفيذ" icon="clipboard" tone="warning" href="/visits?type=survey&status=open" />}
        {seeQuotes && <StatCard title="عروض بانتظار الرد" value={sentQuotes?.count ?? 0} hint={`${acceptedQuotes?.count ?? 0} مقبولة هذا الشهر`} icon="file" tone="success" href="/quotes?status=sent" />}
        {seeDevices && <StatCard title="صيانة متأخرة" value={overdue?.count ?? 0} hint="أجهزة تجاوزت موعدها" icon="shieldAlert" tone="danger" href="/devices?due=overdue" />}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {seeVisits && (
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>الزيارات والمعاينات القادمة</h2><Link href="/visits" className={`${link} text-xs`}>عرض الكل</Link></div>
            {visits.length === 0 ? <p className="p-6 text-sm text-slate-500">لا توجد زيارات قادمة.</p> : (
              <ul className="divide-y divide-slate-100">
                {visits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/visits/${v.id}`} className={link}>{v.customer?.name ?? "—"}</Link>
                      <p className="truncate text-xs text-slate-500">{visitType[v.visit_type] ?? ""} · {v.site?.name ?? "—"} · <span dir="ltr">{v.ref_no}</span></p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-xs">{formatDateTime(v.scheduled_start)}</p>
                      <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {seeQuotes && (
          <section className={card}>
            <div className={cardHeader}><h2 className={cardTitle}>آخر عروض الأسعار</h2><Link href="/quotes" className={`${link} text-xs`}>عرض الكل</Link></div>
            {quotes.length === 0 ? <p className="p-6 text-sm text-slate-500">لا توجد عروض أسعار بعد. تُنشأ من المعاينات المنتهية أو من «+ عرض سعر».</p> : (
              <ul className="divide-y divide-slate-100">
                {quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/quotes/${q.id}`} className={link}>{q.customer?.name ?? "—"}</Link>
                      <p className="text-xs text-slate-500"><span dir="ltr">{q.ref_no}</span> · {formatDate(q.issue_date)}</p>
                    </div>
                    <StatusBadge {...(quoteStatus[q.status] ?? { label: q.status, tone: "neutral" })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      {!seeDevices && !seeVisits && !seeQuotes && (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          لا توجد لديك صلاحيات عرض تشغيلية بعد. اطلب من مدير الشركة منحك الصلاحيات المناسبة لعملك.
        </p>
      )}
    </div>
  );
}
