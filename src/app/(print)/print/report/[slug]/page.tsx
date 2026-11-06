import { notFound, redirect } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding, type Branding } from "@/lib/branding";
import { canRunReport, fetchAll, getReport } from "@/lib/reports";
import { formatDate } from "@/lib/format";
import { param, type SearchParams } from "@/lib/list";
import { logLoadError } from "@/lib/errors";

export const metadata = { title: "طباعة تقرير | عين السلامة" };

const PLATFORM: Branding = {
  id: "", ref_no: null, name: "منصة عين السلامة", legal_name: null, phone: null, email: null, website: null, city: null, address: null,
  vat_number: null, license_no: null, commercial_registration: null, primary_color: "#1e3a5f", secondary_color: "#d98e04", header_text: null,
  footer_text: "منصة عين السلامة", signature_name: null, signature_title: null, show_logo_in_reports: false, show_contact_in_reports: false,
  show_stamp_in_reports: false, logo_path: null, stamp_path: null, logoUrl: null, stampUrl: null,
};

export default async function PrintReport({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireUser();
  const report = getReport(slug);
  if (!report) notFound();
  if (!canRunReport(report, ctx.permissions, ctx.platformPermissions.has("platform.companies.view")) || (!report.platformOnly && !ctx.permissions.has("reports.print"))) redirect("/forbidden");
  const orgId = ctx.active?.organization_id ?? "";
  const supabase = await createClient();
  // هوية الشركة النشطة للمستخدم فقط؛ تقارير المنصة تستخدم هوية المنصة
  const b = report.platformOnly ? PLATFORM : await loadBranding(supabase, orgId);
  if (!b) notFound();
  const [{ rows, truncated, error }, summary] = await Promise.all([
    fetchAll(report, { sb: supabase, orgId, sp }, 3000),
    report.summary ? report.summary({ sb: supabase, orgId, sp, range: null }) : Promise.resolve(null),
  ]);
  const meta: [string, string][] = [["عدد السجلات", String(rows.length)]];
  if (param(sp, "from") || param(sp, "to")) meta.push(["الفترة", `${formatDate(param(sp, "from")) } — ${formatDate(param(sp, "to"))}`]);
  if (param(sp, "q")) meta.push(["البحث", param(sp, "q")]);
  for (const [k, v] of summary ?? []) meta.push([k, String(v)]);

  return (
    <>
      <PrintToolbar note={truncated ? "تم الاقتصار على أول 3000 سجل في الطباعة؛ استخدم التصفية أو التصدير." : undefined} />
      <PrintDocument b={b} title={report.title} meta={meta} signature={false}>
        {error ? <p role="alert" className="text-[11px] text-red-700">تعذر تحميل بيانات التقرير{logLoadError(`print/report/${slug}`, error as Parameters<typeof logLoadError>[1])}؛ لم يُطبع تقرير ناقص.</p>
          : rows.length === 0 ? <p className="text-[11px] text-slate-600">لا توجد نتائج.</p> : (
          <table>
            <thead><tr><th>#</th>{report.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>{i + 1}</td>{report.columns.map((c) => <td key={c.key}>{c.value(r) ?? ""}</td>)}</tr>)}</tbody>
          </table>
        )}
      </PrintDocument>
    </>
  );
}
