// اختبار وظيفي للوحدات التشغيلية والهوية والصلاحيات على قاعدة cgwn داخل معاملة يُتراجع عنها دائمًا.
// يستخدم حسابات المالك والمدير الفعلية بصفتها فقط داخل المعاملة؛ لا يُحفظ أي شيء.
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });
let n = 0;
async function as(uid, sql, params = []) {
  const sp = `s${++n}`;
  await c.query(`savepoint ${sp}`);
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid ?? "", JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })]);
    await c.query(uid ? "set local role authenticated" : "set local role anon");
    const r = (await c.query(sql, params)).rows;
    await c.query("reset role");
    await c.query(`release savepoint ${sp}`);
    return { rows: r };
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return { error: e.message, code: e.code };
  }
}

const before = await fingerprint(c);
await c.query("begin");
try {
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const mgr = (await c.query(`select m.user_id, m.company_id from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.role = 'company_manager' and m.status = 'active' and c.status = 'active' limit 1`)).rows[0];
  ok("يوجد مدير شركة فعلي للاختبار", !!mgr);
  const other = (await c.query("select id from public.companies where id <> $1 limit 1", [mgr.company_id])).rows[0]?.id;

  const ctx = (await as(mgr.user_id, "select public.get_my_context() as r")).rows?.[0]?.r;
  ok("get_my_context للمدير: عضوية شركته فقط وصلاحيات كاملة", ctx && ctx.memberships.length >= 1
    && ctx.memberships.every((m) => m.company_id === mgr.company_id || m.role)
    && ctx.memberships.find((m) => m.company_id === mgr.company_id)?.permissions.includes("catalog.manage"));
  ok("get_my_context لا يتضمن شركات لا عضوية فيها", ctx && !ctx.memberships.some((m) => m.company_id === other));
  const octx = (await as(owner, "select public.get_my_context() as r")).rows?.[0]?.r;
  ok("get_my_context للمالك: is_platform_admin = true", octx?.is_platform_admin === true);

  const seeded = (await as(mgr.user_id, "select count(*)::int n from public.safety_systems where company_id = $1", [mgr.company_id])).rows?.[0]?.n;
  ok("الكتالوج الافتراضي ظاهر للمدير", seeded >= 7, `${seeded}`);
  const sys = await as(mgr.user_id, "insert into public.safety_systems (company_id, name, default_interval_days) values ($1, $2, 90) returning ref_no", [mgr.company_id, `نظام تحقق ${Date.now()}`]);
  ok("المدير يضيف نظامًا للكتالوج (كان يفشل سابقًا)", /^SYS-\d{6}$/.test(sys.rows?.[0]?.ref_no ?? ""), sys.error ?? sys.rows?.[0]?.ref_no);
  if (other) {
    const cross = await as(mgr.user_id, "insert into public.safety_systems (company_id, name) values ($1, 'تسلل عبر الشركات')", [other]);
    ok("المدير لا يضيف لكتالوج شركة أخرى", cross.code === "42501");
    ok("المدير لا يرى كتالوج شركة أخرى", ((await as(mgr.user_id, "select id from public.safety_systems where company_id = $1", [other])).rows ?? [1]).length === 0);
  }
  const brand = await as(mgr.user_id, "select public.company_update_branding($1, $2::jsonb)", [mgr.company_id, JSON.stringify({ primary_color: "#123456", header_text: "ترويسة تحقق" })]);
  ok("المدير يحفظ الهوية (كان يفشل سابقًا)", !brand.error, brand.error);
  ok("الهوية المحفوظة تُقرأ", (await as(mgr.user_id, "select primary_color from public.companies where id = $1", [mgr.company_id])).rows?.[0]?.primary_color === "#123456");
  const ownerBrand = await as(owner, "select public.company_update_branding($1, $2::jsonb)", [mgr.company_id, JSON.stringify({ primary_color: "#000000" })]);
  ok("مالك المنصة لا يعدّل هوية شركة (من مسؤولية مديرها)", ownerBrand.code === "42501");
  const cust = await as(mgr.user_id, "insert into public.customers (company_id, name) values ($1, 'عميل تحقق') returning ref_no", [mgr.company_id]);
  ok("المدير يضيف عميلًا برقم مرجعي", /^CUS-\d{6}$/.test(cust.rows?.[0]?.ref_no ?? ""), cust.error);
  ok("anon لا يقرأ العملاء", (await as(null, "select 1 from public.customers")).code === "42501");
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
ok("لم يُحفظ أي أثر للاختبار (البصمات مطابقة)", JSON.stringify(after) === JSON.stringify(before));
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ rolled_back: true, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
