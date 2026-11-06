import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { card } from "@/components/ui/styles";
import { requireUser } from "@/lib/auth/context";
import { REPORTS, canRunReport } from "@/lib/reports";
import { redirect } from "next/navigation";

export const metadata = { title: "مركز التقارير | عين السلامة" };

export default async function ReportsPage() {
  const ctx = await requireUser();
  const available = REPORTS.filter((r) => canRunReport(r, ctx.permissions, ctx.platformPermissions.has("platform.companies.view")));
  if (available.length === 0) redirect("/forbidden");
  return (
    <div>
      <PageHeader title="مركز التقارير" description="تقارير مبنية على البيانات الفعلية مع البحث والتصفية والفترات الزمنية والطباعة والتصدير وفق صلاحياتك." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {available.map((r) => (
          <Link key={r.slug} href={`/reports/${r.slug}`} className={`${card} block p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-md active:translate-y-0`}>
            <h2 className="font-bold text-foreground">{r.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{r.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
