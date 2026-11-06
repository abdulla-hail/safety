import Form from "next/form";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { btnPrimary, btnSecondary, card, input, label } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import AssignmentPanel from "../technicians/AssignmentPanel";

export const metadata = { title: "إسناد الفنيين والعملاء | عين السلامة" };

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg("assignments.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: techs } = await supabase.from("technicians")
    .select("id, ref_no, full_name, customers:technician_customers(count)")
    .eq("company_id", ctx.orgId).is("archived_at", null).eq("is_active", true).order("full_name");
  const techId = param(sp, "tech");
  const selected = (techs ?? []).find((t) => t.id === techId);

  return (
    <div className="space-y-6">
      <PageHeader title="إسناد الفنيين والعملاء" description="اختر فنيًا، ثم ابحث وحدد عدة عملاء واحفظ دفعة واحدة. الفني الواحد يخدم عدة عملاء والعميل يتعامل مع عدة فنيين."
        actions={ctx.can("reports.view") ? <Link href="/reports/assignments" className={btnSecondary}>تقرير الإسناد</Link> : undefined} />
      <section className={`${card} p-5`}>
        <Form action="/assignments" className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="tech" className={label}>الفني</label>
            <select id="tech" name="tech" defaultValue={techId} className={input} required>
              <option value="">اختر فنيًا...</option>
              {(techs ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.full_name} — {t.ref_no} ({(t.customers as unknown as { count: number }[])?.[0]?.count ?? 0} عميل)</option>
              ))}
            </select>
          </div>
          <button type="submit" className={btnPrimary}>عرض الإسنادات</button>
        </Form>
        {(techs ?? []).length === 0 && <p className="mt-3 text-sm text-slate-500">لا يوجد فنيون نشطون. <Link href="/team#invite" className="text-primary underline">ادعُ فنيًا من فريق الشركة</Link></p>}
      </section>
      {selected && isUuid(techId) && (
        <>
          <h2 className="text-lg font-bold">إسنادات: <Link href={`/technicians/${selected.id}`} className="text-primary hover:underline">{selected.full_name}</Link></h2>
          <AssignmentPanel technicianId={selected.id} orgId={ctx.orgId} search={param(sp, "cq")} formAction="/assignments"
            hidden={{ tech: selected.id }} canAssign />
        </>
      )}
    </div>
  );
}
