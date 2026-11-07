import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import RecordActions from "@/components/ui/RecordActions";
import { btnPrimary, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, param, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/format";
import { TECHNICIAN_SPECIALTIES, auditAction, auditEntity, technicianAvailability, visitStatus } from "@/lib/labels";
import AssignmentPanel from "../AssignmentPanel";

export const metadata = { title: "ملف الفني | عين السلامة" };

export default async function TechnicianPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg("technicians.view");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  // جولة متوازية واحدة: السجلات المرتبطة مقيدة بمعرّف الفني وRLS، فلا حاجة لانتظار سجل الفني أولًا
  const [{ data: t }, visits, audit] = await Promise.all([
    supabase.from("technicians").select("*").eq("id", id).eq("company_id", ctx.orgId).maybeSingle(),
    supabase.from("visit_technicians").select("visit:visits(id, ref_no, scheduled_start, status, customer:customers(name))").eq("technician_id", id).order("created_at", { ascending: false }).limit(8),
    ctx.active.can_manage_team
      ? supabase.from("company_audit_log").select("id, action, target_type, details, created_at").eq("company_id", ctx.orgId)
          .or(`target_id.eq.${id},details->>technician_id.eq.${id}`).order("created_at", { ascending: false }).limit(10)
      : null,
  ]);
  if (!t) notFound();
  type V = { id: string; ref_no: string; scheduled_start: string; status: string; customer: { name: string } | null };
  const vList = ((visits.data ?? []) as unknown as { visit: V | null }[]).map((x) => x.visit).filter((x): x is V => !!x);

  return (
    <div className="space-y-6">
      <PageHeader title={t.full_name} refNo={t.ref_no} crumbs={[ctx.active.can_manage_team ? { label: "فريق الشركة", href: "/team" } : { label: "إسناد الفنيين", href: "/assignments" }, { label: t.full_name }]}
        description={t.archived_at ? `مؤرشف منذ ${formatDate(t.archived_at)}` : undefined}
        actions={<>
          {ctx.can("technicians.update") && <Link href={`/technicians/${id}/edit`} className={btnPrimary}>تعديل</Link>}
          <RecordActions table="technicians" id={id} archived={!!t.archived_at} back={`/technicians/${id}`} listPath="/team" noun="الفني"
            canArchive={ctx.can("technicians.archive")} canDelete={ctx.can("technicians.delete")} />
        </>} />
      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>بيانات الفني</h2>
          {t.is_active ? <StatusBadge {...(technicianAvailability[t.availability] ?? { label: t.availability, tone: "neutral" })} /> : <StatusBadge label="غير نشط" tone="neutral" />}
        </div>
        <InfoGrid items={[
          ["الجوال", t.phone && <span dir="ltr">{t.phone}</span>], ["البريد", t.email && <span dir="ltr">{t.email}</span>],
          ["المسمى", t.job_title], ["تاريخ التعيين", formatDate(t.hire_date)],
          ["التخصصات", (t.specialties ?? []).map((s: string) => TECHNICIAN_SPECIALTIES[s] ?? s).join("، ")],
          ["حساب الدخول", t.user_id ? "مرتبط (يستلم الإشعارات)" : "غير مرتبط"], ["ملاحظات", t.notes],
        ]} />
      </section>

      <AssignmentPanel technicianId={id} orgId={ctx.orgId} search={param(sp, "cq")} formAction={`/technicians/${id}`}
        canAssign={ctx.can("assignments.manage") && !t.archived_at} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الزيارات</h2></div>
          <ul className="divide-y divide-slate-100">
            {vList.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><Link href={`/visits/${v.id}`} className={link}>{v.customer?.name ?? "—"}</Link><p className="text-xs text-slate-500">{formatDateTime(v.scheduled_start)}</p></div>
                <StatusBadge {...(visitStatus[v.status] ?? { label: v.status, tone: "neutral" })} />
              </li>
            ))}
            {vList.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد زيارات.</li>}
          </ul>
        </section>
      </div>
      {audit && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>سجل العمليات المرتبطة</h2><Link href={`/settings/audit?entity=${id}`} className={`${link} text-xs`}>السجل الكامل</Link></div>
          <ul className="divide-y divide-slate-100 text-sm">
            {(audit.data ?? []).map((a) => (
              <li key={a.id} className="flex justify-between px-5 py-2"><span>{auditAction[a.action] ?? a.action} — {(a.details as { name?: string } | null)?.name ?? auditEntity[a.target_type] ?? a.target_type}</span><span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
