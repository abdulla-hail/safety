import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import InviteForm from "@/components/InviteForm";
import { card, cardHeader, cardTitle, link } from "@/components/ui/styles";
import { requirePlatform } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { companyStatus } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { orIlike, pageOf, param, rangeOf, sortOf, type SearchParams } from "@/lib/list";
import { cleanOrphanFiles, createCompany } from "./actions";
import StatusButtons from "./StatusButtons";
import OrphanFilesButton from "./OrphanFilesButton";

export const metadata: Metadata = { title: "إدارة الشركات | عين السلامة" };

interface Company {
  id: string;
  name: string;
  status: string;
  created_at: string;
  ref_no?: string | null;
  manager_email?: string | null;
  city?: string | null;
  members: { count: number }[];
  managers: { count: number }[];
}

const FILTERS = [
  { value: "pending", label: "بانتظار قبول الدعوة" },
  { value: "active", label: "نشطة" },
  { value: "suspended", label: "موقوفة" },
  { value: "archived", label: "مؤرشفة" },
];

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // المالك أو مساعد بصلاحية العرض؛ RLS ودوال القاعدة تحمي البيانات والعمليات حتى لو فُتح الرابط مباشرة
  const ctx = await requirePlatform("platform.companies.view");
  const sp = await searchParams;
  const page = pageOf(sp);
  const sort = sortOf(sp, ["created_at", "name"] as const, "created_at");
  const supabase = await createClient();

  let q = supabase
    .from("companies")
    .select("*, members:company_memberships(count), managers:company_memberships(count)", { count: "exact" })
    // العدّ للعضويات النشطة فقط (المعطلة والمزالة تبقى في السجلات ولا تُحسب)
    .eq("members.status", "active")
    .eq("managers.role", "company_manager").eq("managers.status", "active")
    .order(sort.column, { ascending: sort.ascending })
    .range(...rangeOf(page));
  const search = orIlike(["name"], param(sp, "q"));
  if (search) q = q.or(search);
  const status = param(sp, "status");
  if (["pending", "active", "suspended", "archived"].includes(status)) q = q.eq("status", status);
  // جولة متوازية واحدة (كانت طلبين متتابعين ≈ 2 × 350 مللي ثانية)
  const owner = ctx.platformRole === "owner";
  const [{ data, count, error }, { data: all }, orphans] = await Promise.all([
    q,
    supabase.from("companies").select("status"),
    owner ? supabase.rpc("platform_orphan_company_files", { p_limit: 1000 }) : Promise.resolve(null),
  ]);
  const orphanFiles = (orphans && !orphans.error ? orphans.data : null) as { bytes: number }[] | null;
  const filesLeft = Number(param(sp, "files_left")) || 0;
  const tally = (s: string[]) => (all ?? []).filter((c) => s.includes(c.status as string)).length;

  const columns: Column<Company>[] = [
    { key: "ref", label: "الرقم", render: (c) => <span className="font-mono text-xs" dir="ltr">{c.ref_no ?? "—"}</span> },
    { key: "name", label: "الشركة", sortKey: "name", render: (c) => (
      <div><Link href={`/platform-admin/${c.id}`} className={link}>{c.name}</Link><p className="text-xs text-slate-500">{c.city ?? ""}</p></div>
    ) },
    { key: "manager", label: "بريد المدير", render: (c) => <span className="text-xs" dir="ltr">{c.manager_email ?? "—"}</span> },
    { key: "members", label: "الأعضاء النشطون / المديرون", render: (c) => `${c.members?.[0]?.count ?? 0} / ${c.managers?.[0]?.count ?? 0}` },
    { key: "created", label: "التسجيل", sortKey: "created_at", render: (c) => formatDate(c.created_at) },
    { key: "status", label: "الحالة", render: (c) => <StatusBadge {...(companyStatus[c.status] ?? { label: c.status, tone: "neutral" })} /> },
    ...(ctx.platformPermissions.has("platform.companies.status")
      ? [{ key: "actions", label: "الإجراءات", render: (c: Company) => <StatusButtons id={c.id} name={c.name} status={c.status} small /> }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="إدارة الشركات" description="تسجيل شركات صيانة السلامة ودعوة مديريها واعتمادها وإيقافها وأرشفتها. هذه الصفحة لمالك المنصة فقط، ومحمية من الخادم وقاعدة البيانات." />
      {filesLeft > 0 && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          حُذفت الشركة، وتعذر حذف {filesLeft} من ملفاتها في التخزين الآن. يمكنك إعادة المحاولة من «ملفات شركات محذوفة» أدناه.
        </p>
      )}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[["بانتظار قبول الدعوة", tally(["pending"])], ["نشطة", tally(["active"])], ["موقوفة", tally(["suspended"])], ["مؤرشفة", tally(["archived"])]].map(([t, v]) => (
          <div key={t as string} className={`${card} p-5`}><p className="text-sm text-slate-500">{t}</p><p className="mt-1 text-2xl font-extrabold">{v}</p></div>
        ))}
      </section>
      <section className={card}>
        <FilterBar action="/platform-admin" searchParams={sp} showArchive={false} searchPlaceholder="بحث باسم الشركة..."
          fields={[{ name: "status", label: "الحالة", type: "select", options: FILTERS }]} />
        {error ? (
          <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل الشركات. حاول مرة أخرى.</p>
        ) : (
          <DataTable columns={columns} rows={(data ?? []) as unknown as Company[]} basePath="/platform-admin" searchParams={sp} sort={sort} minWidth={900}
            empty="لا توجد شركات مطابقة." />
        )}
        <Pagination basePath="/platform-admin" searchParams={sp} page={page} total={count ?? 0} />
      </section>
      {orphanFiles && orphanFiles.length > 0 && (
        <section className={card}>
          <div className={cardHeader}><h2 className={cardTitle}>ملفات شركات محذوفة ({orphanFiles.length})</h2></div>
          <div className="space-y-3 p-5 text-sm">
            <p className="text-slate-600">ملفات في التخزين تتبع شركات لم تعد موجودة ({(orphanFiles.reduce((s, f) => s + Number(f.bytes ?? 0), 0) / 1048576).toFixed(1)} م.ب).
              حذفها لا يمس ملفات أي شركة قائمة.</p>
            <OrphanFilesButton action={cleanOrphanFiles} />
          </div>
        </section>
      )}
      {ctx.platformPermissions.has("platform.companies.create") && <section className={card}>
        <div className={cardHeader}><h2 className={cardTitle}>تسجيل شركة صيانة جديدة ودعوة مديرها</h2></div>
        <div className="p-5">
          <p className="mb-4 text-sm text-slate-500">
            يُنشأ رقم الشركة تلقائيًا، وتُنشأ دعوة مرتبطة ببريد المدير. لا يحصل المدير على أي صلاحية إلا بعد فتح الرابط وتسجيل الدخول بحساب Google بالبريد نفسه.
          </p>
          <InviteForm action={createCompany} submitLabel="تسجيل الشركة وإنشاء الدعوة" fields={[
            { name: "name", label: "اسم الشركة / الاسم التجاري", required: true },
            { name: "manager_email", label: "بريد مدير الشركة", type: "email", required: true, dir: "ltr" },
            { name: "commercial_registration", label: "السجل التجاري", dir: "ltr" },
            { name: "phone", label: "رقم الهاتف", type: "tel", dir: "ltr" },
            { name: "city", label: "المدينة" },
            { name: "expires_hours", label: "صلاحية الدعوة (ساعة)", type: "number", defaultValue: "72", help: "من ساعة إلى 720 ساعة (30 يومًا)." },
          ]} />
        </div>
      </section>}
    </div>
  );
}
