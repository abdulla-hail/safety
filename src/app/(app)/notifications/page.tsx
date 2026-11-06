import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import ActionButton from "@/components/ui/ActionButton";
import { btnSecondary, btnSm, card } from "@/components/ui/styles";
import { requireUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { pageOf, param, rangeOf, type SearchParams } from "@/lib/list";
import { notificationKinds } from "@/lib/labels";
import { markNotificationRead } from "../actions";

export const metadata = { title: "الإشعارات | عين السلامة" };

const KIND: Record<string, string> = {
  assignment: "إسناد", work_order_assigned: "أمر عمل", work_order_status: "حالة أمر عمل", visit_scheduled: "زيارة",
  visit_rescheduled: "تعديل موعد", maintenance_due: "صيانة قادمة", maintenance_overdue: "صيانة متأخرة",
  membership_request: "طلب انضمام", invitation_accepted: "قبول دعوة", permissions_changed: "صلاحيات", membership_status: "عضوية",
  company_approved: "اعتماد الشركة", fault_reported: "عطل", follow_up_assigned: "متابعة",
  ...Object.fromEntries(notificationKinds.map((k) => [k.kind, k.label])),
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const page = pageOf(sp);
  const unreadOnly = param(sp, "filter") === "unread";
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at, actor_user_id", { count: "exact" })
    .eq("recipient_user_id", ctx.user.id).order("created_at", { ascending: false }).range(...rangeOf(page));
  if (unreadOnly) q = q.is("read_at", null);
  const [{ data, count }, techs] = await Promise.all([
    q,
    ctx.active ? supabase.from("technicians").select("user_id, full_name").eq("company_id", ctx.active.organization_id).not("user_id", "is", null) : null,
  ]);
  const techName = new Map((techs?.data ?? []).map((x) => [x.user_id as string, x.full_name]));
  // الاسم مضمّن في نص الإشعار عند إنشائه؛ يُعرض أيضًا كشارة إن كان المنفّذ فنيًا مسجلًا
  const actor = (uid: string | null) => (uid ? techName.get(uid) ?? null : null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="الإشعارات" description="الإشعارات المرسلة إليك فقط. فتح الإشعار يحدده كمقروء."
        actions={<>
          <Link href={unreadOnly ? "/notifications" : "/notifications?filter=unread"} className={btnSecondary}>{unreadOnly ? "عرض الكل" : "غير المقروءة فقط"}</Link>
          <ActionButton action={markNotificationRead} hidden={{ id: "all" }} label="تحديد الكل كمقروء" />
          {ctx.active && <Link href="/notifications/settings" className={btnSecondary}>التفضيلات</Link>}
        </>} />
      <section className={card}>
        <ul className="divide-y divide-slate-100">
          {(data ?? []).map((n) => (
            <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${n.read_at ? "" : "bg-brand-soft"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {!n.read_at && <span className="me-2 inline-block size-2 rounded-full bg-danger align-middle" aria-label="غير مقروء" />}
                  <span className="me-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{KIND[n.kind] ?? n.kind}</span>
                  <span className="font-semibold">{n.title}</span>
                  {actor(n.actor_user_id) && <span className="ms-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-800">الفني: {actor(n.actor_user_id)}</span>}
                </p>
                {n.body && <p className="mt-1 text-sm text-slate-600">{n.body}</p>}
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
              </div>
              <div className="flex gap-2">
                {n.link && <Link href={`/notifications/${n.id}/open`} prefetch={false} className={`${btnSecondary} ${btnSm}`}>عرض التفاصيل</Link>}
                {!n.read_at && <ActionButton action={markNotificationRead} hidden={{ id: n.id }} label="مقروء" className={`${btnSecondary} ${btnSm}`} />}
              </div>
            </li>
          ))}
          {(data ?? []).length === 0 && <li className="px-5 py-12 text-center text-sm text-slate-500">لا توجد إشعارات.</li>}
        </ul>
        <Pagination basePath="/notifications" searchParams={sp} page={page} total={count ?? 0} />
      </section>
    </div>
  );
}
