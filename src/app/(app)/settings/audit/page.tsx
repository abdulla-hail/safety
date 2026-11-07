import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import FilterBar from "@/components/ui/FilterBar";
import Pagination from "@/components/ui/Pagination";
import { card } from "@/components/ui/styles";
import { requireOrg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { auditAction, auditEntity, companyAuditAction } from "@/lib/labels";
import { isUuid, orIlike, pageOf, param, rangeOf, type SearchParams } from "@/lib/list";

export const metadata = { title: "سجل التدقيق | عين السلامة" };

const ACTIONS: Record<string, string> = { ...auditAction, ...companyAuditAction, branding_updated: "تعديل الهوية", member_permissions: "تغيير صلاحيات عضو" };

function describe(details: Record<string, unknown> | null): string {
  const changes = (details?.changes ?? {}) as Record<string, unknown>;
  const keys = Object.keys(changes).filter((k) => !["id", "company_id"].includes(k));
  if (keys.length === 0) return String(details?.name ?? "");
  return keys.slice(0, 6).join("، ") + (keys.length > 6 ? ` (+${keys.length - 6})` : "");
}

/** سجل تدقيق الشركة (company_audit_log): للمدير الأساسي ولمن يملك audit.view من المديرين وفق سياسة RLS، ولا يُعدّل ولا يُحذف. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrg();
  if (!ctx.active.is_primary && !ctx.can("audit.view")) redirect("/forbidden");
  const sp = await searchParams;
  const page = pageOf(sp);
  const supabase = await createClient();
  let q = supabase.from("company_audit_log").select("id, action, target_type, target_id, actor_email, details, created_at", { count: "exact" })
    .eq("company_id", ctx.orgId).order("created_at", { ascending: false }).range(...rangeOf(page, 30));
  if (param(sp, "action")) q = q.eq("action", param(sp, "action"));
  if (param(sp, "entity_type")) q = q.eq("target_type", param(sp, "entity_type"));
  if (isUuid(param(sp, "entity"))) q = q.eq("target_id", param(sp, "entity"));
  if (param(sp, "from")) q = q.gte("created_at", `${param(sp, "from")}T00:00:00+03:00`);
  if (param(sp, "to")) q = q.lte("created_at", `${param(sp, "to")}T23:59:59+03:00`);
  const s = orIlike(["actor_email", "details->>name", "details->>ref_no"], param(sp, "q"));
  if (s) q = q.or(s);
  const { data, count, error } = await q;

  return (
    <div>
      <PageHeader title="سجل التدقيق" description="سجل ثابت لعمليات الشركة: الإنشاء والتعديل والأرشفة والحذف والإسناد والدعوات والصلاحيات والهوية. لا يمكن تعديله أو حذفه." />
      <section className={card}>
        <FilterBar action="/settings/audit" searchParams={sp} showArchive={false} searchPlaceholder="بحث بالاسم أو الرقم المرجعي أو بريد المنفّذ..." hidden={["entity"]} fields={[
          { name: "action", label: "العملية", type: "select", options: Object.entries(ACTIONS).map(([value, label]) => ({ value, label })) },
          { name: "entity_type", label: "الكيان", type: "select", options: Object.entries(auditEntity).map(([value, label]) => ({ value, label })) },
          { name: "from", label: "من", type: "date" },
          { name: "to", label: "إلى", type: "date" },
        ]} />
        {error && <p role="alert" className="p-5 text-sm text-red-700">تعذر تحميل سجل التدقيق.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-right text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr><th className="px-4 py-3">الوقت</th><th className="px-4 py-3">المنفّذ</th><th className="px-4 py-3">العملية</th><th className="px-4 py-3">الكيان</th><th className="px-4 py-3">السجل / الحقول</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data ?? []).map((a) => {
                const d = (a.details ?? {}) as Record<string, unknown>;
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">{formatDateTime(a.created_at)}</td>
                    <td className="px-4 py-2.5 text-xs" dir="ltr">{a.actor_email ?? "النظام"}</td>
                    <td className="px-4 py-2.5">{ACTIONS[a.action] ?? a.action}</td>
                    <td className="px-4 py-2.5">{auditEntity[a.target_type] ?? a.target_type}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      <span className="font-mono" dir="ltr">{String(d.ref_no ?? "")}</span> {describe(d)}
                      <details><summary className="cursor-pointer text-slate-400">التفاصيل</summary>
                        <pre className="mt-2 max-h-48 max-w-md overflow-auto rounded bg-slate-50 p-2 text-[10px]" dir="ltr">{JSON.stringify(d, null, 1)}</pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
              {(data ?? []).length === 0 && !error && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">لا توجد سجلات مطابقة.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination basePath="/settings/audit" searchParams={sp} page={page} total={count ?? 0} pageSize={30} />
      </section>
    </div>
  );
}
