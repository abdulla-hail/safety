import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, param, type SearchParams } from "@/lib/list";

/**
 * خيارات فلتر العميل/الموقع وقيمهما الصالحة. العملاء والمواقع تُقرأ بصلاحيات المستخدم (RLS)،
 * فالفني يرى عملاءه المسندين فقط. الموقع يُقبل فقط إن كان تابعًا للعميل المحدد.
 */
export async function customerSiteFilter(supabase: SupabaseClient, orgId: string, sp: SearchParams) {
  const rawCustomer = param(sp, "customer");
  const rawSite = param(sp, "site");
  const [customers, sites] = await Promise.all([
    // المؤرشفون يظهرون في آخر القائمة حتى تبقى أجهزتهم ومواقعهم قابلة للتصفية
    supabase.from("customers").select("id, name, archived_at").eq("company_id", orgId)
      .order("archived_at", { ascending: true, nullsFirst: true }).order("name").limit(1000),
    isUuid(rawCustomer)
      ? supabase.from("customer_sites").select("id, name, archived_at").eq("company_id", orgId).eq("customer_id", rawCustomer)
        .order("archived_at", { ascending: true, nullsFirst: true }).order("name").limit(1000)
      : Promise.resolve({ data: [] }),
  ]);
  type Row = { id: string; name: string; archived_at: string | null };
  const label = (r: Row) => ({ id: r.id, name: r.archived_at ? `${r.name} (مؤرشف)` : r.name });
  const customerList = ((customers.data ?? []) as Row[]).map(label);
  const siteList = ((sites.data ?? []) as Row[]).map(label);
  const customer = customerList.some((c) => c.id === rawCustomer) ? rawCustomer : "";
  const site = customer && siteList.some((s) => s.id === rawSite) ? rawSite : "";
  const query = Object.fromEntries(Object.entries(sp)
    .filter(([k, v]) => k !== "customer" && k !== "site" && typeof v === "string" && v !== "")) as Record<string, string>;
  return { customers: customerList, sites: siteList, customer, site, query };
}
