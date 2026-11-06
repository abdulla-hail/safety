import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, param, params, type SearchParams } from "@/lib/list";

export const MAX_PRINT_DEVICES = 600;

/**
 * نطاق الأجهزة للطباعة من الرابط: ids (أجهزة محددة) أو customer أو site أو all=1 (كل ما يسمح به RLS للمستخدم).
 * الأجهزة المؤرشفة تُستبعد من النطاقات الجماعية وتبقى قابلة للطباعة إذا حُددت صراحةً.
 */
export async function loadPrintDevices<T>(supabase: SupabaseClient, orgId: string, sp: SearchParams, select: string) {
  const ids = params(sp, "ids").filter(isUuid).slice(0, MAX_PRINT_DEVICES);
  const customer = param(sp, "customer");
  const site = param(sp, "site");
  let q = supabase.from("devices").select(select, { count: "exact" }).eq("company_id", orgId)
    .order("customer_id").order("site_id", { nullsFirst: true }).order("ref_no").limit(MAX_PRINT_DEVICES);
  let scope: { kind: "ids" | "customer" | "site" | "all" | "none"; hidden: Record<string, string> };
  if (ids.length) { q = q.in("id", ids); scope = { kind: "ids", hidden: { ids: ids.join(",") } }; }
  else if (isUuid(site)) { q = q.eq("site_id", site).is("archived_at", null); scope = { kind: "site", hidden: { site } }; }
  else if (isUuid(customer)) { q = q.eq("customer_id", customer).is("archived_at", null); scope = { kind: "customer", hidden: { customer } }; }
  else if (param(sp, "all") === "1") { q = q.is("archived_at", null); scope = { kind: "all", hidden: { all: "1" } }; }
  else return { list: [] as T[], total: 0, truncated: false, scope: { kind: "none" as const, hidden: {} } };
  const { data, count } = await q;
  const list = (data ?? []) as T[];
  return { list, total: count ?? list.length, truncated: (count ?? 0) > list.length, scope };
}

export const SCOPE_LABEL: Record<string, string> = {
  ids: "الأجهزة المحددة", customer: "جميع أجهزة العميل", site: "جميع أجهزة الموقع", all: "جميع الأجهزة المسموح بها", none: "",
};
