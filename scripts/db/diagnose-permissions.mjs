// تشخيص صلاحيات العضويات الفعلية على cgwn داخل معاملة يُتراجع عنها دائمًا (لا يُحفظ شيء ولا تُطبع بيانات شخصية).
// لكل عضوية: الدور، هل الصلاحيات مخصصة، نتيجة company_has_perm لصلاحيات المواقع والتقارير، ومحاولة إضافة موقع فعليًا.
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
let n = 0;
async function as(uid, sql, params = []) {
  const sp = `s${++n}`;
  await c.query(`savepoint ${sp}`);
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = (await c.query(sql, params)).rows;
    await c.query("reset role");
    await c.query(`release savepoint ${sp}`);
    return { rows: r };
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return { error: `${e.code} ${e.message}` };
  }
}
await c.query("begin");
const out = [];
try {
  const members = (await c.query(`select m.id, m.user_id, m.company_id, m.role, m.status, m.is_primary, m.permissions is not null custom,
      c.status company_status, (select count(*) from public.company_memberships x where x.user_id = m.user_id) user_memberships
    from public.company_memberships m join public.companies c on c.id = m.company_id order by m.created_at`)).rows;
  for (const m of members) {
    const perms = (await as(m.user_id, `select public.company_has_perm($1, 'sites.create') sites_create, public.company_has_perm($1, 'reports.view') reports_view,
        public.company_has_perm($1, 'customers.view') customers_view`, [m.company_id])).rows?.[0];
    const ctx = (await as(m.user_id, "select public.get_my_context() r")).rows?.[0]?.r;
    const cust = (await c.query("select id from public.customers where company_id = $1 limit 1", [m.company_id])).rows[0];
    const ins = cust ? await as(m.user_id, `insert into public.customer_sites (company_id, customer_id, name, city, district, address, contact_name, contact_phone, notes)
        values ($1, $2, 'تشخيص', null, null, null, null, null, null) returning id`, [m.company_id, cust.id]) : { error: "no customer" };
    out.push({ role: m.role, status: m.status, primary: m.is_primary, custom_permissions: m.custom, company_status: m.company_status,
      user_memberships: Number(m.user_memberships), ...perms,
      ctx_permissions_count: ctx?.memberships?.find((x) => x.company_id === m.company_id)?.permissions?.length,
      ctx_platform_role: ctx?.platform_role ?? null,
      site_insert: ins.error ? `ERROR ${ins.error}` : "ok" });
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(JSON.stringify(out, null, 2));
