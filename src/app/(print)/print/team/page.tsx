import { notFound, redirect } from "next/navigation";
import PrintToolbar from "@/components/print/PrintToolbar";
import { PrintDocument } from "@/components/print/PrintDocument";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadBranding } from "@/lib/branding";
import { companyMemberStatus, companyRole, roleLabel, TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { param, params, type SearchParams } from "@/lib/list";
import { loadTeam, memberSpecialties } from "@/lib/team";

export const metadata = { title: "بيانات فريق الشركة | طباعة" };

/** طباعة عضو أو مجموعة أو كل الأعضاء المطابقين؛ لمدير الشركة فقط وبيانات شركته فقط (RLS). */
export default async function PrintTeam({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireUser();
  if (!ctx.active?.can_manage_team) redirect("/forbidden");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ rows }, b] = await Promise.all([loadTeam(supabase, ctx.active.organization_id, sp), loadBranding(supabase, ctx.active.organization_id)]);
  if (!b) notFound();
  const scope = params(sp, "ids").length ? "الأعضاء المحددون"
    : [param(sp, "role") && `الدور: ${companyRole[param(sp, "role")] ?? ""}`, param(sp, "status") && `الحالة: ${companyMemberStatus[param(sp, "status")]?.label ?? ""}`,
       param(sp, "specialty") && `التخصص: ${TECHNICIAN_SPECIALTIES[param(sp, "specialty")] ?? ""}`, param(sp, "q") && `بحث: ${param(sp, "q")}`].filter(Boolean).join(" · ") || "جميع الأعضاء";

  return (
    <>
      <PrintToolbar note={`${rows.length} عضو`} />
      <PrintDocument b={b} title={rows.length === 1 ? `بيانات عضو الفريق: ${rows[0].full_name ?? ""}` : "بيانات فريق الشركة"} signature={false}
        meta={[["النطاق", scope], ["عدد الأعضاء", String(rows.length)]]}>
        {rows.length === 0 ? <p className="text-[11px] text-slate-600">لا يوجد أعضاء مطابقون.</p> : (
          <table>
            <thead><tr><th>#</th><th>الاسم</th><th>البريد</th><th>الدور</th><th>المسمى</th><th>التخصصات</th><th>الجوال</th><th>رقم الفني</th><th>الحالة</th><th>الانضمام</th></tr></thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id}>
                  <td>{i + 1}</td>
                  <td>{m.full_name ?? ""}{m.is_primary ? " (المدير الأساسي)" : ""}</td>
                  <td dir="ltr">{m.email ?? ""}</td>
                  <td>{roleLabel(m.role, m.is_primary)}</td>
                  <td>{m.job_title ?? ""}</td>
                  <td>{memberSpecialties(m).join("، ")}</td>
                  <td dir="ltr">{m.technician?.phone ?? ""}</td>
                  <td dir="ltr">{m.technician?.ref_no ?? ""}</td>
                  <td>{companyMemberStatus[m.status]?.label ?? m.status}</td>
                  <td>{formatDate(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PrintDocument>
    </>
  );
}
