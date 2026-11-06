// اختبار وظيفي لدورة الدعوات على قاعدة cgwn الحقيقية داخل معاملة واحدة يُتراجع عنها دائمًا (لا يُحفظ أي شيء).
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget, fingerprint } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
const results = [];
const ok = (name, cond) => results.push({ name, ok: !!cond });
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
    return { error: e.message };
  }
}
const rpc = async (uid, fn, args) => {
  const r = await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
  return r.error ? { error: r.error } : { data: r.rows[0].r };
};

const before = await fingerprint(c);
await c.query("begin");
try {
  const owner = (await c.query("select user_id from public.platform_admins limit 1")).rows[0].user_id;
  const tag = Date.now().toString(36);
  const mk = async (name) => (await c.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), $1, now(), $2) returning id",
    [`${name}.${tag}@ays-test.invalid`, JSON.stringify({ full_name: name })])).rows[0].id;
  const manager = await mk("manager"), tech = await mk("tech"), stranger = await mk("stranger");

  const created = await rpc(owner, "platform_create_company", [`شركة اختبار ${tag}`, `manager.${tag}@ays-test.invalid`, null, null, "الرياض", 24]);
  ok("مالك المنصة ينشئ شركة ودعوة مدير", created.data?.token && /^ORG-\d{6}$/.test(created.data.ref_no));
  const company = created.data?.company_id;
  ok("غير المالك لا ينشئ شركة", (await rpc(stranger, "platform_create_company", ["x", "a@b.cc", null, null, null, 24])).error?.includes("صلاحية هذه العملية في إدارة المنصة"));
  ok("الدعوة لا تُقبل ببريد مختلف", (await rpc(stranger, "accept_company_invitation", [created.data?.token])).error?.includes("لبريد آخر"));
  ok("المالك لا يقبل دعوة شركة", (await rpc(owner, "accept_company_invitation", [created.data?.token])).error?.includes("مالك المنصة"));
  ok("المدير يقبل دعوته", !(await rpc(manager, "accept_company_invitation", [created.data?.token])).error);
  ok("لا يمكن استخدام الدعوة مرتين", (await rpc(manager, "accept_company_invitation", [created.data?.token])).error?.includes("استُخدمت"));
  const st = (await c.query("select status from public.companies where id=$1", [company])).rows[0]?.status;
  ok("الشركة أصبحت نشطة بعد قبول المدير", st === "active");
  ok("دور المدير في شركته company_manager", (await rpc(manager, "current_company_role", [company])).data === "company_manager");

  const inv = await rpc(manager, "company_invite_member", [company, `tech.${tag}@ays-test.invalid`, "technician", "فني اختبار", "فني", "إنذار", 24]);
  ok("المدير يدعو فنيًا", !!inv.data?.token);
  ok("المدير لا يمنح دور مدير بالدعوة", (await rpc(manager, "company_invite_member", [company, "z@y.zz", "company_manager", null, null, null, 24])).error?.includes("دور غير مسموح"));
  ok("الفني يقبل دعوته", !(await rpc(tech, "accept_company_invitation", [inv.data?.token])).error);
  ok("الفني لا يرى دعوات الشركة", ((await as(tech, "select id from public.company_invitations")).rows ?? [1]).length === 0);
  ok("الفني لا يدعو أعضاء", (await rpc(tech, "company_invite_member", [company, "q@y.zz", "technician", null, null, null, 24])).error?.includes("لمدير الشركة"));
  ok("غير العضو لا يرى الشركة", ((await as(stranger, "select id from public.companies where id=$1", [company])).rows ?? [1]).length === 0);
  ok("لا قراءة لبصمة الرمز", (await as(manager, "select token_hash from public.company_invitations")).error?.includes("permission denied"));
  ok("لا كتابة مباشرة على العضويات", (await as(manager, "update public.company_memberships set role='company_manager'")).error?.includes("permission denied"));
  const audit = (await c.query("select action from public.company_audit_log where company_id=$1 order by id", [company])).rows.map((r) => r.action);
  ok("سجل التدقيق سجّل العمليات", ["company_created", "invitation_created", "invitation_accepted"].every((a) => audit.includes(a)));
} finally {
  await c.query("rollback");
}
const after = await fingerprint(c);
ok("لم يُحفظ أي أثر للاختبار (البصمات مطابقة)", JSON.stringify(after) === JSON.stringify(before));
await c.end();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ rolled_back: true, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
