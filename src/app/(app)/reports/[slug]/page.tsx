import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import { btnSecondary, card, link } from "@/components/ui/styles";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { canRunReport, getReport } from "@/lib/reports";
import { pageOf, rangeOf, withParams, type SearchParams } from "@/lib/list";
import { logLoadError } from "@/lib/errors";

export const metadata = { title: "تقرير | عين السلامة" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireUser();
  const report = getReport(slug);
  if (!report) notFound();
  if (!canRunReport(report, ctx.permissions, ctx.platformPermissions.has("platform.companies.view"))) redirect("/forbidden");
  const orgId = ctx.active?.organization_id ?? "";
  if (!report.platformOnly && !orgId) redirect("/onboarding");

  const supabase = await createClient();
  const page = pageOf(sp);
  const [result, filters, summary] = await Promise.all([
    report.fetch({ sb: supabase, orgId, sp, range: rangeOf(page) }),
    report.filters({ sb: supabase, orgId }),
    report.summary ? report.summary({ sb: supabase, orgId, sp, range: null }) : Promise.resolve(null),
  ]);
  const rows = result.data ?? [];
  // السبب الحقيقي في سجل الخادم، والرمز في الرسالة (كانت رسالة عامة تخفي مثلًا PGRST200 لعلاقة مفقودة)
  const errCode = logLoadError(`report/${slug}`, result.error as Parameters<typeof logLoadError>[1]);
  const qs = withParams("", sp, { page: null });
  const base = `/reports/${slug}`;

  return (
    <div className="space-y-6">
      <PageHeader title={report.title} description={report.description} crumbs={[{ label: "التقارير", href: "/reports" }, { label: report.title }]}
        actions={<>
          {ctx.permissions.has("reports.print") && <Link href={`/print/report/${slug}${qs}`} className={btnSecondary}>معاينة الطباعة</Link>}
          {ctx.permissions.has("reports.export") && <a href={`${base}/export${qs}`} className={btnSecondary}>تصدير CSV</a>}
        </>} />
      {summary && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {summary.map(([k, v]) => (
            <div key={k} className={`${card} p-5`}><p className="text-sm text-slate-500">{k}</p><p className="mt-1 text-2xl font-extrabold">{v}</p></div>
          ))}
        </section>
      )}
      <section className={card}>
        <FilterBar action={base} searchParams={sp} fields={filters} showArchive={!!report.archiveFilter} hidden={["customer", "site"]} />
        {result.error ? (
          <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل التقرير حاليًا{errCode}. أعد المحاولة بعد لحظات؛ إن تكرر فأبلغ مدير المنصة بالرمز.</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-slate-500" role="status">لا توجد نتائج مطابقة لمعايير التقرير.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>{report.columns.map((c) => <th key={c.key} className="px-4 py-3 font-semibold">{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={String(r.id ?? i)}>
                    {report.columns.map((c) => {
                      const v = c.value(r);
                      const href = c.href?.(r);
                      return <td key={c.key} className="px-4 py-2.5">{href ? <Link href={href} className={link}>{v}</Link> : v === "" || v === null ? "—" : v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath={base} searchParams={sp} page={page} total={result.count ?? 0} />
      </section>
    </div>
  );
}
