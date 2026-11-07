import { notFound } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import InfoGrid from "@/components/ui/InfoGrid";
import StatusBadge from "@/components/ui/StatusBadge";
import EntityForm from "@/components/ui/EntityForm";
import InviteForm from "@/components/InviteForm";
import InvitationRowActions from "@/components/InvitationRowActions";
import { card, cardHeader, cardTitle } from "@/components/ui/styles";
import { requirePlatform } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { companyAuditAction, companyInvitationKind, companyMemberStatus, companyRole, roleLabel, companyStatus, invitationStatus } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/list";
import { effectiveInvitationStatus, isMissingSchema } from "@/lib/invitations";
import { inviteManager, resendInvitation, revokeInvitation, updateCompany } from "../actions";
import StatusButtons from "../StatusButtons";
import DeleteCompanyForm from "./DeleteCompanyForm";
import PurgeCompanyForm from "./PurgeCompanyForm";

export const metadata = { title: "تفاصيل شركة | عين السلامة" };

type Row = Record<string, unknown>;
const s = (r: Row, k: string) => (r[k] as string | null | undefined) ?? null;

export default async function CompanyAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePlatform("platform.companies.view");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const owner = ctx.platformRole === "owner";
  const [{ data: c }, members, invites, audit, deps, purge] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("company_memberships").select("*").eq("company_id", id).order("created_at"),
    supabase.from("company_invitations").select("id, kind, email, role, full_name, status, expires_at, created_at, accepted_at").eq("company_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("company_audit_log").select("id, action, actor_email, details, created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.rpc("platform_company_dependencies", { p_company: id }),
    // معاينة الحذف الكامل لمالك المنصة فقط، في الجولة الموازية نفسها
    owner ? supabase.rpc("platform_company_purge_preview", { p_company: id }) : Promise.resolve(null),
  ]);
  if (!c) notFound();
  const company = c as Row;
  const dep = (deps.error ? null : deps.data) as Record<string, number | boolean> | null;
  const schemaReady = !isMissingSchema(invites.error);
  const list = (members.data ?? []) as Row[];
  const primary = list.find((m) => m.is_primary === true) ?? list.find((m) => m.role === "company_manager");
  const may = (p: Parameters<typeof ctx.platformPermissions.has>[0]) => ctx.platformPermissions.has(p);

  return (
    <div className="space-y-6">
      <PageHeader title={String(company.name)} refNo={s(company, "ref_no")} crumbs={[{ label: "إدارة الشركات", href: "/platform-admin" }, { label: String(company.name) }]}
        actions={may("platform.companies.status") ? <StatusButtons id={id} name={String(company.name)} status={String(company.status)} /> : undefined} />

      {!schemaReady && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          الدعوات وسجل التدقيق والبيانات الإضافية (السجل التجاري، الهاتف، المدينة، الأرشفة، الحذف الآمن) تتطلب تطبيق تغييرات قاعدة البيانات المقترحة. المتاح الآن: تعديل الاسم، والتفعيل والإيقاف.
        </p>
      )}

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>بيانات الشركة</h2>
          <StatusBadge {...(companyStatus[String(company.status)] ?? { label: String(company.status), tone: "neutral" })} /></div>
        <InfoGrid items={[
          ["الرقم المرجعي", <span key="r" className="font-mono" dir="ltr">{s(company, "ref_no") ?? "—"}</span>],
          ["بريد المدير", <span key="e" dir="ltr">{s(company, "manager_email") ?? "—"}</span>],
          ["الاسم القانوني", s(company, "legal_name")],
          ["السجل التجاري", s(company, "commercial_registration")],
          ["الرقم الضريبي", s(company, "vat_number") && <span dir="ltr">{s(company, "vat_number")}</span>],
          ["رقم الترخيص", s(company, "license_no")],
          ["الهاتف", s(company, "phone") && <span dir="ltr">{s(company, "phone")}</span>],
          ["بريد الشركة", s(company, "email") && <span dir="ltr">{s(company, "email")}</span>],
          ["الموقع الإلكتروني", s(company, "website") && <span dir="ltr">{s(company, "website")}</span>],
          ["المدينة", s(company, "city")],
          ["العنوان", s(company, "address")],
          ["تاريخ التسجيل", formatDate(s(company, "created_at"))],
          ["آخر تحديث", formatDateTime(s(company, "updated_at"))],
          ["الإيقاف", formatDateTime(s(company, "suspended_at"))],
          ["الأرشفة", formatDateTime(s(company, "archived_at"))],
        ]} />
        {may("platform.companies.update") && <details className="border-t border-slate-200">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">تعديل بيانات الشركة</summary>
          <div className="p-5 pt-0">
            <EntityForm action={updateCompany} submitLabel="حفظ البيانات" initial={company as Record<string, string>}
              fields={[
                { name: "id", label: "", type: "hidden" },
                { name: "name", label: "اسم الشركة", required: true, maxLength: 200 },
                { name: "legal_name", label: "الاسم القانوني", maxLength: 300 },
                { name: "commercial_registration", label: "السجل التجاري", dir: "ltr", maxLength: 300 },
                { name: "vat_number", label: "الرقم الضريبي", dir: "ltr", maxLength: 15, help: "15 رقمًا" },
                { name: "license_no", label: "رقم الترخيص", dir: "ltr", maxLength: 300 },
                { name: "phone", label: "الهاتف", type: "tel", dir: "ltr", maxLength: 30 },
                { name: "email", label: "بريد الشركة", type: "email", dir: "ltr", maxLength: 300 },
                { name: "website", label: "الموقع الإلكتروني", type: "url", dir: "ltr", placeholder: "https://", maxLength: 300 },
                { name: "city", label: "المدينة", maxLength: 300 },
                { name: "address", label: "العنوان", type: "textarea", wide: true, maxLength: 300 },
              ]} />
            <p className="mt-3 text-xs text-slate-500">الرقم المرجعي ثابت لا يتغير. بريد المدير يتغير بدعوة مدير جديد. كل تعديل يُسجَّل في سجل التدقيق بقيمه السابقة.</p>
          </div>
        </details>}
      </section>

      <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>مدير الشركة</h2></div>
        <div className="space-y-4 p-5">
          {primary ? (
            <p className="text-sm">المدير الحالي: <b>{s(primary, "full_name") ?? "—"}</b> <span dir="ltr" className="text-slate-500">{s(primary, "email") ?? ""}</span>
              {" "}<StatusBadge {...(companyMemberStatus[String(primary.status)] ?? { label: String(primary.status), tone: "neutral" })} /></p>
          ) : (
            <p className="text-sm text-slate-600">لم يقبل أي مدير الدعوة بعد.</p>
          )}
          {may("platform.companies.invitations") && <InviteForm action={inviteManager} hidden={{ company_id: id }}
            submitLabel={primary ? "دعوة مدير جديد (نقل الإدارة)" : "إنشاء دعوة المدير / دعوة بديلة"}
            fields={[
              { name: "email", label: primary ? "بريد المدير الجديد" : "بريد مدير الشركة", type: "email", required: true, dir: "ltr", defaultValue: s(company, "manager_email") ?? "" },
              { name: "expires_hours", label: "صلاحية الدعوة (ساعة)", type: "number", defaultValue: "72" },
            ]}>
            {primary && <p className="text-xs text-slate-500">عند قبول المدير الجديد للدعوة يصبح المدير الأساسي، ويبقى المدير الحالي عضوًا بدور «مشرف» دون حذف سجلاته.</p>}
          </InviteForm>}
        </div>
      </section>

      {schemaReady && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>الدعوات ({invites.data?.length ?? 0})</h2></div>
          <ul className="divide-y divide-slate-100">
            {((invites.data ?? []) as Row[]).map((i) => {
              const st = effectiveInvitationStatus(String(i.status), s(i, "expires_at"));
              return (
                <li key={String(i.id)} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p><span dir="ltr" className="font-semibold">{String(i.email)}</span> · {companyInvitationKind[String(i.kind)]} · {companyRole[String(i.role)]}</p>
                    <p className="text-xs text-slate-500">{s(i, "full_name") && `${s(i, "full_name")} · `}أُنشئت {formatDateTime(s(i, "created_at"))}
                      {st === "accepted" ? ` · قُبلت ${formatDateTime(s(i, "accepted_at"))}` : ` · تنتهي ${formatDateTime(s(i, "expires_at"))}`}
                      {!["manager", "manager_transfer"].includes(String(i.kind)) && st === "pending" && " · يديرها مدير الشركة"}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <StatusBadge {...(invitationStatus[st] ?? { label: st, tone: "neutral" })} />
                    {may("platform.companies.invitations") && ["manager", "manager_transfer"].includes(String(i.kind)) && st !== "accepted" && (
                      <InvitationRowActions invitationId={String(i.id)} canResend={st !== "accepted"} canRevoke={st === "pending"}
                        resend={resendInvitation} revoke={revokeInvitation} />
                    )}
                  </div>
                </li>
              );
            })}
            {(invites.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا توجد دعوات.</li>}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>أعضاء الشركة ({list.filter((m) => m.status === "active").length} نشط من {list.length})</h2>
        </div>
        <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-600">
          عرض للمتابعة فقط: صفتك «مالك المنصة» ليست عضوية في الشركة، ولا تمنحك وصولًا لعملائها وأجهزتها وسجلاتها التشغيلية.
          دعوة الأعضاء وتعطيلهم وتخصيص صلاحياتهم من مسؤولية مدير الشركة؛ ومن صلاحيتك هنا دعوة المدير ونقل الإدارة وحالة الشركة.
          العضويات المعطلة والمزالة تبقى ظاهرة مع سجلاتها ولا تُحذف.
        </p>
        <ul className="divide-y divide-slate-100">
          {list.map((m) => (
            <li key={String(m.id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-semibold">{s(m, "full_name") ?? "—"} · {roleLabel(String(m.role), m.is_primary === true)}{m.is_primary === true ? " (المدير الأساسي)" : ""}</p>
                <p className="text-xs text-slate-500"><span dir="ltr">{s(m, "email") ?? String(m.user_id).slice(0, 8) + "…"}</span>
                  {s(m, "job_title") && ` · ${s(m, "job_title")}`} · انضم {formatDate(s(m, "created_at"))}
                  {s(m, "removed_at") && ` · أُزيل ${formatDate(s(m, "removed_at"))}`}
                  {Array.isArray(m.permissions) && " · صلاحيات مخصصة"}</p>
              </div>
              <StatusBadge {...(companyMemberStatus[String(m.status)] ?? { label: String(m.status), tone: "neutral" })} />
            </li>
          ))}
          {list.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">لا يوجد أعضاء بعد. يدير مدير الشركة أعضاءها بعد قبوله الدعوة.</li>}
        </ul>
      </section>

      {schemaReady && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>سجل التدقيق</h2></div>
          <ul className="divide-y divide-slate-100 text-sm">
            {((audit.data ?? []) as Row[]).map((a) => (
              <li key={String(a.id)} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                <span>{companyAuditAction[String(a.action)] ?? String(a.action)} <span className="text-xs text-slate-500" dir="ltr">{s(a, "actor_email") ?? "النظام"}</span></span>
                <span className="text-xs text-slate-500">{formatDateTime(s(a, "created_at"))}</span>
              </li>
            ))}
            {(audit.data ?? []).length === 0 && <li className="px-5 py-4 text-slate-500">لا توجد عمليات مسجلة.</li>}
          </ul>
        </section>
      )}

      {dep && (
        <section className={`${card} ${company.status === "archived" ? "border-red-200" : ""}`}>
          <div className={cardHeader}><h2 className={cardTitle}>الإيقاف والأرشفة والحذف</h2></div>
          <div className="space-y-4 p-5 text-sm">
            <ul className="list-disc space-y-1 ps-5 text-slate-600">
              <li><b>الإيقاف</b>: يمنع أعضاء الشركة من الوصول فورًا مع الاحتفاظ بكل بياناتها، ويمكن إعادة التفعيل.</li>
              <li><b>الأرشفة</b>: إخراج الشركة من الخدمة مع الاحتفاظ بسجلاتها التاريخية؛ لا يصل إليها أحد من أعضائها.</li>
              <li><b>الحذف النهائي</b>: للشركة المؤرشفة التي ليس لها أي سجل تشغيلي فقط. الشركات ذات السجلات تبقى مؤرشفة ولا تُحذف.</li>
            </ul>
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-4">
              {([["العملاء", "customers"], ["المواقع", "sites"], ["الفنيون", "technicians"], ["الأجهزة", "devices"], ["أوامر العمل", "work_orders"],
                ["الزيارات", "visits"], ["سجلات الصيانة", "maintenance_records"], ["المرفقات", "attachments"], ["عناصر الكتالوج", "catalog_items"],
                ["العضويات", "memberships"], ["الدعوات", "invitations"], ["أنظمة السلامة", "safety_systems"]] as const).map(([t, k]) => (
                <div key={k}><dt className="text-xs text-slate-500">{t}</dt><dd className="font-semibold">{Number(dep[k] ?? 0)}</dd></div>
              ))}
            </dl>
            {company.status !== "archived" ? (
              <p className="text-slate-600">الحذف متاح بعد أرشفة الشركة.</p>
            ) : !dep.can_delete ? (
              <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">للشركة {Number(dep.operational_records)} سجلًا تشغيليًا؛ تبقى مؤرشفة للحفاظ على السجلات التاريخية ولا يمكن حذفها.</p>
            ) : may("platform.companies.delete") ? (
              <>
                <p className="text-slate-600">سيُحذف سجل الشركة مع إعداداتها (العضويات والدعوات وأنظمة السلامة الافتراضية وسجل الهوية والإشعارات)، وتُحفظ لقطة منها في سجل التدقيق الذي يبقى بعد الحذف. ملفات الشعار والختم المرفوعة سابقًا تبقى في التخزين.</p>
                <DeleteCompanyForm id={id} refNo={s(company, "ref_no")} />
              </>
            ) : <p className="text-slate-600">الحذف يتطلب صلاحية حذف الشركات.</p>}
          </div>
        </section>
      )}

      {owner && <PurgeSection id={id} name={String(company.name)} purge={purge} />}
    </div>
  );
}

const PURGE_LABELS: [string, string][] = [
  ["customers", "العملاء"], ["customer_sites", "المواقع"], ["devices", "الأجهزة"], ["visits", "الزيارات"],
  ["visit_devices", "بنود الفحص"], ["maintenance_records", "سجلات الصيانة"], ["device_faults", "البلاغات والأعطال"],
  ["work_orders", "أوامر العمل"], ["attachments", "المرفقات"], ["technicians", "الفنيون"], ["company_memberships", "العضويات"],
  ["company_invitations", "الدعوات"], ["notifications", "الإشعارات"], ["catalog_items", "عناصر الكتالوج"],
];
const KEEP_REASON: Record<string, string> = {
  other_company: "عضو في شركة أخرى", platform: "صفة في المنصة", self: "حسابك", legacy: "بيانات في النظام القديم", no_account: "بلا حساب",
};

type PurgePreview = {
  counts: Record<string, number>; total_rows: number; audit_entries_kept: number;
  files: { count: number; bytes: number };
  members: { user_id: string; email: string | null; full_name: string | null; role: string; removable: boolean; keep_reason: string | null }[];
};

/** الحذف الكامل لمالك المنصة: الأعداد ومصير الحسابات والملفات قبل القرار */
function PurgeSection({ id, name, purge }: { id: string; name: string; purge: { data: unknown; error: { code?: string } | null } | null }) {
  const p = (purge && !purge.error ? purge.data : null) as PurgePreview | null;
  return (
    <section className={`${card} border-red-300`}>
      <div className={cardHeader}><h2 className={cardTitle}>الحذف الكامل للشركة (مالك المنصة)</h2></div>
      <div className="space-y-4 p-5 text-sm">
        {!p ? (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
            {isMissingSchema(purge?.error) ? "الحذف الكامل يتطلب تطبيق ترحيل قاعدة البيانات المقترح (20261109000100) بعد موافقتك." : "تعذر تحميل معاينة الحذف. أعد تحميل الصفحة."}
          </p>
        ) : (
          <>
            <p className="text-slate-700">يحذف الشركة وكل ما يرتبط بها في معاملة واحدة: العملاء والمواقع والأجهزة والزيارات ونتائج الفحص والأعطال وأوامر العمل
              والإسنادات والعضويات والدعوات والإشعارات والكتالوج، ثم ملفاتها في التخزين (الشعارات وصور الأجهزة والمرفقات).
              تُحفظ لقطة في سجل تدقيق المنصة، ويبقى سجل تدقيق الشركة ({p.audit_entries_kept} قيدًا). لا يمس أي شركة أخرى.</p>
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-red-200 bg-red-50/40 p-4 sm:grid-cols-4">
              {PURGE_LABELS.map(([k, t]) => (
                <div key={k}><dt className="text-xs text-slate-500">{t}</dt><dd className="font-semibold">{Number(p.counts[k] ?? 0)}</dd></div>
              ))}
              <div><dt className="text-xs text-slate-500">الملفات</dt><dd className="font-semibold">{p.files.count} ({(p.files.bytes / 1048576).toFixed(1)} م.ب)</dd></div>
              <div><dt className="text-xs text-slate-500">إجمالي السجلات</dt><dd className="font-semibold">{p.total_rows}</dd></div>
            </dl>
            {p.members.length > 0 && (
              <div>
                <p className="mb-2 font-semibold">حسابات الأعضاء</p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {p.members.map((m) => (
                    <li key={m.user_id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span>{m.full_name ?? "—"} <span dir="ltr" className="text-xs text-slate-500">{m.email ?? ""}</span></span>
                      <span className="text-xs text-slate-600">{m.removable ? "يمكن حذف حسابه (اختياري)" : `يبقى حسابه: ${KEEP_REASON[m.keep_reason ?? ""] ?? m.keep_reason}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <PurgeCompanyForm id={id} name={name} totalRows={p.total_rows} files={p.files.count}
              removableAccounts={p.members.filter((m) => m.removable).length} />
          </>
        )}
      </div>
    </section>
  );
}
