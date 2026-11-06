"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getContext, orgForAction } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, isRelationError } from "@/lib/errors";
import { isUuid } from "@/lib/list";
import { str, type ActionState } from "@/lib/action-state";
import type { Permission } from "@/lib/permissions";

export async function switchOrganization(fd: FormData) {
  const org = str(fd, "org");
  const ctx = await getContext();
  // لا يُقبل إلا معرّف شركة يملك المستخدم فيها عضوية فعّالة
  if (ctx && ctx.memberships.some((m) => m.organization_id === org && m.member_status === "active")) {
    (await cookies()).set(ACTIVE_ORG_COOKIE, org, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/dashboard");
}

/** الجداول المسموح أرشفتها/حذفها من الواجهة، والوحدة ومسار القائمة لكل منها. */
const RECORDS = {
  customers: { module: "customers", list: "/customers", detail: "/customers" },
  technicians: { module: "technicians", list: "/team", detail: "/technicians" },
  customer_sites: { module: "sites", list: "/sites", detail: "/sites" },
  safety_systems: { module: "catalog", list: "/catalog", detail: "/catalog" },
  catalog_items: { module: "catalog", list: "/catalog", detail: null },
  devices: { module: "devices", list: "/devices", detail: "/devices" },
  visits: { module: "visits", list: "/visits", detail: "/visits" },
} as const;

type RecordTable = keyof typeof RECORDS;

function resolve(fd: FormData) {
  const table = str(fd, "table") as RecordTable;
  const id = str(fd, "id");
  const cfg = RECORDS[table];
  if (!cfg || !isUuid(id)) return null;
  return { table, id, cfg };
}

export async function setArchived(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = resolve(fd);
  if (!r) return { ok: false, message: "طلب غير صالح." };
  const archive = str(fd, "archive") === "1";
  const ctx = await orgForAction(`${r.cfg.module}.archive` as Permission);
  if (!ctx) return { ok: false, message: "ليست لديك صلاحية الأرشفة أو الاستعادة." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(r.table)
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", r.id)
    .eq("company_id", ctx.orgId)
    .select("id");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, message: "السجل غير موجود أو لا تملك صلاحية تعديله." };

  revalidatePath(r.cfg.list);
  const back = str(fd, "back");
  if (back.startsWith("/") && !back.startsWith("//")) redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${archive ? "archived" : "restored"}`);
  return { ok: true, message: archive ? "تمت الأرشفة." : "تمت الاستعادة." };
}

export async function deleteRecord(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = resolve(fd);
  if (!r) return { ok: false, message: "طلب غير صالح." };
  const ctx = await orgForAction(`${r.cfg.module}.delete` as Permission);
  if (!ctx) return { ok: false, message: "ليست لديك صلاحية الحذف النهائي." };

  const supabase = await createClient();
  const { data, error } = await supabase.from(r.table).delete().eq("id", r.id).eq("company_id", ctx.orgId).select("id");
  if (error) {
    return {
      ok: false,
      message: isRelationError(error)
        ? "لا يمكن حذف هذا السجل لارتباطه بسجلات تاريخية أو تشغيلية. استخدم «أرشفة» لإخفائه مع الحفاظ على السجلات."
        : dbErrorMessage(error),
    };
  }
  if (!data?.length) return { ok: false, message: "السجل غير موجود أو لا تملك صلاحية حذفه." };
  revalidatePath(r.cfg.list);
  const back = str(fd, "back");
  redirect(`${back.startsWith("/") && !back.startsWith("//") ? back : r.cfg.list}?ok=deleted`);
}

export async function markNotificationRead(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "يجب تسجيل الدخول." };
  const supabase = await createClient();
  const id = str(fd, "id");
  const q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null).eq("recipient_user_id", ctx.user.id);
  const { error } = id === "all" ? await q : isUuid(id) ? await q.eq("id", id) : { error: { code: "22P02" } };
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/notifications");
  return { ok: true, message: "تم التحديد كمقروء." };
}
