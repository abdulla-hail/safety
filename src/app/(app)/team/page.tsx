import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import InviteForm from "@/components/InviteForm";
import InvitationRowActions from "@/components/InvitationRowActions";
import { btnSecondary, btnSm, card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import FilterBar from "@/components/ui/FilterBar";
import SelectAllCheckbox from "@/components/ui/SelectAllCheckbox";
import { type SearchParams } from "@/lib/list";
import { loadTeam, memberSpecialties, teamFilterQuery, type TeamMember } from "@/lib/team";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { companyInvitationKind, companyMemberStatus, companyRole, invitationStatus, roleLabel, TECHNICIAN_SPECIALTIES } from "@/lib/labels";
import { ALL_PERMISSIONS, MANAGEMENT_PERMISSIONS } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/format";
import { effectiveInvitationStatus, INVITE_ROLES, isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/invitations";
import { resendInvitation, revokeInvitation, transferManagement } from "./actions";
import MemberRowActions from "./MemberRowActions";
import PermissionsEditor from "./PermissionsEditor";
import MemberInviteForm from "./MemberInviteForm";
import LinkTechnicianButton from "./LinkTechnicianButton";

export const metadata = { title: "فريق الشركة | عين السلامة" };

type Row = Record<string, unknown>;
const s = (r: Row, k: string) => (r[k] as string | null | undefined) ?? "";

export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireUser();
  const m = ctx.active;
  // إدارة الفريق لمن يملك team.manage من المديرين؛ إدارة المديرين للمدير الأساسي فقط. قاعدة البيانات تتحقق مجددًا في كل عملية
  if (!m) redirect(ctx.platformRole ? "/platform-admin" : "/onboarding");
  if (!m.can_manage_team) redirect("/forbidden");
  const company = m.organization_id;
  const sp = await searchParams;
  const supabase = await createClient();
  const [members, invites, roleDefaults, techRows, defs] = await Promise.all([
    loadTeam(supabase, company, sp),
    supabase.from("company_invitations").select("id, kind, email, role, full_name, job_title, specialty, permissions, status, expires_at, created_at")
      .eq("company_id", company).in("kind", ["member", "email_change", "manager_transfer"]).order("created_at", { ascending: false }).limit(50),
    supabase.from("company_role_permissions").select("role, permission_key"),
    supabase.from("technicians").select("id, ref_no, full_name, email, user_id, is_active, archived_at").eq("company_id", company).order("full_name"),
    supabase.from("permission_definitions").select("key"),
  ]);
  const available = defs.error ? undefined : (defs.data ?? []).map((d) => d.key as string);
  // سجلات فنيين قديمة أُضيفت يدويًا دون حساب: تبقى كما هي، وتُربط تلقائيًا إذا قَبِل صاحبها دعوة بالبريد نفسه
  const unlinked = (techRows.data ?? []).filter((t) => !t.user_id);
  const defaultsFor = (role: string) => (roleDefaults.data ?? []).filter((r) => r.role === role).map((r) => r.permission_key as string);
  const techByUser = new Map((techRows.data ?? []).filter((t) => t.user_id).map((t) => [t.user_id as string, t]));
  const specialtyText = (v: string) => v.split(",").map((k) => TECHNICIAN_SPECIALTIES[k.trim()] ?? k.trim()).filter(Boolean).join("، ");
  const schemaReady = !isMissingSchema(invites.error);
  const list = members.rows as unknown as Row[];
  const iAmPrimary = m.is_primary;
  // المدير يملك كل الصلاحيات ما لم يخصصها المدير الأساسي؛ غير المدير الأساسي لا يمنح ما لا يملكه
  const managerAll = ALL_PERMISSIONS.filter((p) => p !== "field.assigned") as string[];
  const effectiveOf = (x: Row) => Array.isArray(x.permissions) ? (x.permissions as string[])
    : x.role === "company_manager" ? managerAll : defaultsFor(String(x.role)).filter((p) => !MANAGEMENT_PERMISSIONS.includes(p));
  const grantable = iAmPrimary ? undefined : [...m.permissions];
  const canManage = (x: Row) => x.is_primary !== true && x.user_id !== ctx.user.id && (x.role !== "company_manager" || iAmPrimary);
  const filterQs = teamFilterQuery(sp);
  const filtered = filterQs.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title="فريق الشركة" description={`أعضاء ${m.organization_name} وأدوارهم ودعواتهم. تُمنح الصلاحيات بعد قبول الدعوة فقط، وبالبريد المدعو نفسه.`} />
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        في الشركة دوران: <b>مدير</b> و<b>فني</b>. <b>المدير الأساسي</b> (من أنشأ الشركة) يملك كل الصلاحيات دائمًا ولا يُعدَّل أو يُزال من هنا،
        وهو وحده من يعيّن المديرين ويحدد صلاحياتهم (كل الصلاحيات افتراضيًا). المدير الذي يملك «إدارة الفريق» يدير الفنيين ودعواتهم.
        الفني يحتفظ بصلاحياته التشغيلية فقط دون إدارة الشركة أو الفريق.
      </p>
      {!schemaReady && <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{SCHEMA_PENDING_MESSAGE}</p>}

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>الأعضاء ({list.length}{filtered ? " مطابق" : ""})</h2>
          <a href="#invite" className={link}>+ دعوة عضو</a></div>
        <FilterBar action="/team" searchParams={sp} showArchive={false} searchPlaceholder="بحث بالاسم أو البريد أو المسمى أو التخصص..." fields={[
          { name: "role", label: "نوع العضو", type: "select", options: Object.entries(companyRole).map(([value, label]) => ({ value, label })) },
          { name: "status", label: "الحالة", type: "select", options: Object.entries(companyMemberStatus).map(([value, v]) => ({ value, label: v.label })) },
          { name: "specialty", label: "التخصص", type: "select", options: Object.entries(TECHNICIAN_SPECIALTIES).map(([value, label]) => ({ value, label })) },
        ]} />
        <form id="team-form" action="/print/team" method="get" className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm">
          <SelectAllCheckbox form="team-form" label="تحديد كل النتائج" />
          <span className="text-slate-600">المحددون:</span>
          <button type="submit" className={`${btnSecondary} ${btnSm}`}>طباعة</button>
          <button type="submit" formAction="/team/export" className={`${btnSecondary} ${btnSm}`}>تصدير CSV</button>
          <span className="text-slate-300" aria-hidden="true">|</span>
          <span className="text-slate-600">{filtered ? "كل النتائج المطابقة:" : "جميع الأعضاء:"}</span>
          <Link href={`/print/team${filterQs ? `?${filterQs}` : ""}`} className={link}>طباعة</Link>
          <a href={`/team/export${filterQs ? `?${filterQs}` : ""}`} className={link}>تصدير CSV</a>
        </form>
        <ul className="divide-y divide-slate-100">
          {list.map((x) => {
            const isPrimary = x.is_primary === true;
            const isMe = x.user_id === ctx.user.id;
            return (
              <li key={String(x.id)} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                  <input type="checkbox" name="ids" value={String(x.id)} form="team-form" aria-label={`تحديد ${s(x, "full_name") || "العضو"}`} className="mt-1 size-4 accent-[var(--brand)]" />
                  <div>
                    <p className="font-semibold">{s(x, "full_name") || "—"} · {isPrimary ? "مدير" : roleLabel(String(x.role))}
                      {isPrimary && <span className="ms-2 rounded bg-brand-soft px-1.5 text-[11px] text-brand-strong">المدير الأساسي</span>}
                      {isMe && <span className="ms-2 rounded bg-slate-100 px-1.5 text-[11px]">أنت</span>}</p>
                    <p className="text-xs text-slate-500"><span dir="ltr">{s(x, "email") || String(x.user_id).slice(0, 8) + "…"}</span>
                      {s(x, "job_title") && ` · ${s(x, "job_title")}`}{memberSpecialties(x as unknown as TeamMember).length > 0 && ` · ${memberSpecialties(x as unknown as TeamMember).join("، ")}`} · منذ {formatDate(s(x, "created_at"))}</p>
                  </div>
                  </div>
                  <StatusBadge {...(companyMemberStatus[String(x.status)] ?? { label: String(x.status), tone: "neutral" })} />
                </div>
                {x.role === "technician" && (() => {
                  const t = techByUser.get(String(x.user_id));
                  if (t) return <p className="text-xs text-slate-600">سجل الفني التشغيلي: <Link href={`/technicians/${t.id}`} className={link} dir="ltr">{t.ref_no}</Link>{!t.is_active && " (موقوف)"} — الإسنادات والتخصصات من صفحته.</p>;
                  return schemaReady && x.status === "active" ? <LinkTechnicianButton membershipId={String(x.id)} /> : null;
                })()}
                {isPrimary && <p className="text-xs text-slate-500">يملك كل الصلاحيات دائمًا؛ محمي من التعديل والتعطيل والإزالة (يتغير بإجراء «نقل الإدارة» فقط).</p>}
                {schemaReady && canManage(x) && (
                  <MemberRowActions id={String(x.id)} role={String(x.role)} status={String(x.status)} canAssignManager={iAmPrimary}
                    fullName={s(x, "full_name")} jobTitle={s(x, "job_title")} specialty={s(x, "specialty")} />
                )}
                {schemaReady && canManage(x) && x.status !== "removed" && (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      {x.role === "company_manager" ? (Array.isArray(x.permissions) ? "صلاحيات المدير (محددة)" : "صلاحيات المدير (كل الصلاحيات)") : `الصلاحيات التفصيلية${Array.isArray(x.permissions) ? " (مخصصة)" : ""}`}
                    </summary>
                    <div className="mt-2">
                      <PermissionsEditor membershipId={String(x.id)} customized={Array.isArray(x.permissions)} manager={x.role === "company_manager"}
                        effective={effectiveOf(x)} available={available} grantable={grantable} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
          {list.length === 0 && <li className="px-5 py-6 text-sm text-slate-500">{filtered ? "لا يوجد أعضاء مطابقون للفلاتر." : "لا يوجد أعضاء."}</li>}
        </ul>
      </section>

      {unlinked.length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>سجلات فنيين بلا حساب دخول ({unlinked.length})</h2></div>
          <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-600">
            أُضيفت يدويًا قبل اعتماد الدعوات، وتبقى بإسناداتها وسجلاتها. لربط أحدها بحساب: ادعُ صاحبه بدور «فني» بالبريد المسجل في سجله، فيُربط السجل نفسه عند القبول دون تكرار.
          </p>
          <ul className="divide-y divide-slate-100 text-sm">
            {unlinked.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                <span><Link href={`/technicians/${t.id}`} className={link}>{t.full_name}</Link> <span className="font-mono text-xs text-slate-500" dir="ltr">{t.ref_no}</span>
                  {t.archived_at && <span className="ms-2 rounded bg-slate-200 px-1.5 text-[10px]">مؤرشف</span>}</span>
                <span className="text-xs text-slate-500" dir="ltr">{t.email ?? "بلا بريد"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {schemaReady && (
        <section id="invite" className={`${card} scroll-mt-20`}>
          <div className={cardHeader}><h2 className={cardTitle}>دعوة عضو جديد (مدير أو فني)</h2></div>
          <div className="p-5">
            <p className="mb-4 text-sm text-slate-600">
              ينشئ رابطًا خاصًا يُنسخ أو يُشارك يدويًا (لا يُرسل بريد آليًا). يفتحه المدعو ويسجل الدخول بحساب Google بالبريد نفسه ثم يقبل؛
              الرابط يُستخدم مرة واحدة ويُرفض بعد انتهائه أو إلغائه أو بغير البريد المدعو.
            </p>
            <MemberInviteForm canInviteManager={iAmPrimary} grantable={grantable} available={available}
              roleDefaults={Object.fromEntries(INVITE_ROLES.map((r) => [r, r === "company_manager" ? managerAll : defaultsFor(r).filter((p) => !MANAGEMENT_PERMISSIONS.includes(p))]))} />
          </div>
        </section>
      )}

      {schemaReady && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الدعوات</h2></div>
          <ul className="divide-y divide-slate-100">
            {((invites.data ?? []) as Row[]).map((i) => {
              const st = effectiveInvitationStatus(String(i.status), s(i, "expires_at"));
              return (
                <li key={String(i.id)} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p><span dir="ltr" className="font-semibold">{String(i.email)}</span> · {companyInvitationKind[String(i.kind)]} · {companyRole[String(i.role)] ?? "عضو"}</p>
                    <p className="text-xs text-slate-500">{[s(i, "full_name"), s(i, "specialty") && specialtyText(s(i, "specialty")),
                      Array.isArray(i.permissions) && `صلاحيات مخصصة (${(i.permissions as string[]).length})`].filter(Boolean).join(" · ")}
                      {" "}· أُنشئت {formatDateTime(s(i, "created_at"))} · تنتهي {formatDateTime(s(i, "expires_at"))}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <StatusBadge {...(invitationStatus[st] ?? { label: st, tone: "neutral" })} />
                    {st !== "accepted" && i.kind !== "manager_transfer" && (
                      <InvitationRowActions invitationId={String(i.id)} canResend canRevoke={st === "pending"} resend={resendInvitation} revoke={revokeInvitation} />
                    )}
                  </div>
                </li>
              );
            })}
            {(invites.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد دعوات.</li>}
          </ul>
        </section>
      )}

      {schemaReady && iAmPrimary && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>نقل إدارة الشركة</h2></div>
          <div className="space-y-3 p-5">
            <p className="text-sm text-slate-600">إجراء منفصل ومحمي: يُنشأ رابط للمدير الجديد، ولا تنتقل الإدارة إلا بعد قبوله بالبريد نفسه. بعدها تبقى «مديرًا» في الشركة بكل الصلاحيات دون حذف سجلاتك، ويصبح هو المدير الأساسي.</p>
            <InviteForm action={transferManagement} submitLabel="إنشاء دعوة نقل الإدارة" fields={[
              { name: "email", label: "بريد المدير الجديد", type: "email", required: true, dir: "ltr" },
              { name: "expires_hours", label: "صلاحية الدعوة (ساعة)", type: "number", defaultValue: "48" },
            ]} />
          </div>
        </section>
      )}
    </div>
  );
}
