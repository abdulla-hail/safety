// قياس زمن تنفيذ استعلامات الصفحات داخل قاعدة البيانات نفسها (EXPLAIN ANALYZE) بهوية مدير شركة فعلي وتحت RLS،
// في معاملة قراءة فقط يُتراجع عنها، مع قياس زمن الجولة الكاملة من هذا الجهاز لكل استعلام. لا يطبع أي بيانات.
// الاستخدام: node scripts/perf/measure-db-pages.mjs
import pg from "pg";
import { pgConfig } from "../db/env.mjs";
import { assertTarget } from "../db/cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const m = (await c.query(`select m.user_id, m.company_id from public.company_memberships m join public.companies co on co.id = m.company_id
  where m.role = 'company_manager' and m.status = 'active' and co.status = 'active' limit 1`)).rows[0];
if (!m) { console.log("لا يوجد مدير شركة نشط للقياس"); process.exit(0); }

await c.query("begin transaction read only");
await c.query("set local statement_timeout = '20s'");
await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
  [m.user_id, JSON.stringify({ sub: m.user_id, role: "authenticated" })]);
await c.query("set local role authenticated");
const co = m.company_id;
const Q = {
  "get_my_context": ["select public.get_my_context()", []],
  "customers list (page 1)": ["select id, ref_no, name, city from public.customers where company_id = $1 and archived_at is null order by name limit 25", [co]],
  "devices list (page 1 + joins)": [`select d.id, d.ref_no, d.name, d.status, d.next_maintenance_at, c.name, s.name from public.devices d
    left join public.customers c on c.id = d.customer_id left join public.customer_sites s on s.id = d.site_id
    where d.company_id = $1 and d.archived_at is null order by d.next_maintenance_at nulls last limit 25`, [co]],
  "dashboard: overdue count": ["select count(*) from public.devices where company_id = $1 and archived_at is null and next_maintenance_at < current_date", [co]],
  "dashboard: open work orders": ["select count(*) from public.work_orders where company_id = $1 and archived_at is null and status in ('new','scheduled','in_progress','on_hold')", [co]],
  "dashboard: upcoming visits": ["select id from public.visits where company_id = $1 and archived_at is null and scheduled_start >= now() order by scheduled_start limit 8", [co]],
  "notifications (unread)": ["select id from public.notifications where recipient_user_id = $1 and read_at is null order by created_at desc limit 50", [m.user_id]],
  "team members": ["select id, full_name, email, role, status from public.company_memberships where company_id = $1 order by created_at", [co]],
  "audit log (30)": ["select id, action, created_at from public.company_audit_log where company_id = $1 order by created_at desc limit 30", [co]],
  "report: customer summary": ["select * from public.report_customer_summary where company_id = $1 order by name limit 50", [co]],
};
const out = [];
for (const [name, [sql, params]] of Object.entries(Q)) {
  const runs = [];
  let exec = null;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await c.query("savepoint p");
    try {
      const r = await c.query(`explain (analyze, format json) ${sql}`, params);
      exec = r.rows[0]["QUERY PLAN"][0]["Execution Time"];
      runs.push(Math.round(performance.now() - t));
    } catch (e) { exec = `خطأ ${e.code}`; }
    await c.query("rollback to savepoint p");
  }
  out.push({ query: name, db_execution_ms: typeof exec === "number" ? Number(exec.toFixed(2)) : exec, round_trip_ms: runs });
}
await c.query("rollback");
await c.end();
console.table(out);
