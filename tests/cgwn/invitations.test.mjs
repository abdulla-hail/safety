// اختبار مقترح الشركات والعضويات والدعوات على نسخة محلية مطابقة لبنية مشروع cgwn (PGlite).
// لا يتصل بأي قاعدة حقيقية. تشغيل: npm run test:invites
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
let db;
const u = {};

async function as(userId, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await tx.exec(userId ? "set local role authenticated" : "set local role anon");
    return (await tx.query(sql, params)).rows;
  });
}
async function err(p) {
  try { await p; return null; } catch (e) { return e.message; }
}
async function user(email) {
  const { rows } = await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email]);
  return rows[0].id;
}
const rpc = async (who, fn, args) => (await as(who, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))[0].r;

before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(import.meta.dirname, "current-schema.sql"), "utf8"));
  // كما في الإنتاج: شركة نشطة واحدة قائمة بلا عضويات
  await db.query("insert into public.companies (name, status) values ('شركة قائمة', 'active')");
  await db.exec(fs.readFileSync(path.join(root, "supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"), "utf8"));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  u.manager = await user("manager@company-a.invalid");
  u.manager2 = await user("new.manager@company-a.invalid");
  u.tech = await user("tech@company-a.invalid");
  u.tech2 = await user("tech.new@company-a.invalid");
  u.other = await user("manager@company-b.invalid");
  u.stranger = await user("stranger@ays.invalid");
});

const S = {};

test("الشركة القائمة حُفظت ورُقّمت، وتحوّلت حالتها المسموحة", async () => {
  const rows = (await db.query("select name, ref_no, status from public.companies")).rows;
  assert.deepEqual(rows, [{ name: "شركة قائمة", ref_no: "ORG-000001", status: "active" }]);
});

test("مالك المنصة فقط ينشئ شركة، ويحصل على رابط دعوة المدير مرة واحدة", async () => {
  assert.match(await err(rpc(u.stranger, "platform_create_company", ["x", "a@b.cc", null, null, null, 72])), /لمالك المنصة فقط/);
  const r = await rpc(u.owner, "platform_create_company", ["شركة أ", "Manager@Company-A.invalid", "1010", "0500000000", "الرياض", 48]);
  assert.equal(r.ref_no, "ORG-000002");
  assert.equal(r.email, "manager@company-a.invalid");
  assert.ok(r.token.length >= 40);
  S.companyA = r.company_id;
  S.managerToken = r.token;
  const [c] = (await db.query("select status, manager_email from public.companies where id = $1", [r.company_id])).rows;
  assert.deepEqual(c, { status: "pending", manager_email: "manager@company-a.invalid" });
  // الرمز غير مخزن، فقط بصمته
  const [inv] = (await db.query("select token_hash from public.company_invitations where company_id = $1", [r.company_id])).rows;
  assert.notEqual(inv.token_hash, r.token);
  assert.equal(inv.token_hash.length, 64);
  // لا يمكن قراءة البصمة من الواجهة حتى لمالك المنصة
  assert.match(await err(as(u.owner, "select token_hash from public.company_invitations")), /permission denied/);
  const b = await rpc(u.owner, "platform_create_company", ["شركة ب", "manager@company-b.invalid", null, null, null, 72]);
  S.companyB = b.company_id;
  S.managerBToken = b.token;
});

test("لا تفعيل يدوي لشركة قبل قبول مديرها، ولا كتابة مباشرة على الجداول", async () => {
  assert.match(await err(rpc(u.owner, "platform_set_company_status", [S.companyA, "active"])), /قبل قبول مديرها/);
  assert.match(await err(as(u.owner, "update public.companies set status = 'active' where id = $1", [S.companyA])), /permission denied/);
  assert.match(await err(as(u.owner, "insert into public.company_memberships (company_id, user_id, role) values ($1, $2, 'company_manager')", [S.companyA, u.stranger])), /permission denied/);
});

test("قبول دعوة المدير: البريد المطابق فقط، مرة واحدة، والشركة تصبح نشطة", async () => {
  assert.match(await err(rpc(u.stranger, "accept_company_invitation", [S.managerToken])), /لبريد آخر/);
  assert.match(await err(rpc(u.owner, "accept_company_invitation", [S.managerToken])), /مالك المنصة لا يقبل/);
  assert.match(await err(rpc(u.manager, "accept_company_invitation", [S.managerToken + "x"])), /غير صالح/);
  const p = await rpc(u.manager, "invitation_preview", [S.managerToken]);
  assert.equal(p.status, "pending");
  assert.equal(p.email_matches, true);
  await rpc(u.manager, "accept_company_invitation", [S.managerToken]);
  assert.match(await err(rpc(u.manager, "accept_company_invitation", [S.managerToken])), /استُخدمت/);
  const [m] = await as(u.manager, "select role, is_primary, status from public.company_memberships where user_id = $1", [u.manager]);
  assert.deepEqual(m, { role: "company_manager", is_primary: true, status: "active" });
  const [c] = await as(u.manager, "select status from public.companies where id = $1", [S.companyA]);
  assert.equal(c.status, "active");
  await rpc(u.other, "accept_company_invitation", [S.managerBToken]);
});

test("مدير الشركة يدعو أعضاء لشركته فقط وبالأدوار المسموحة", async () => {
  const r = await rpc(u.manager, "company_invite_member", [S.companyA, "tech@company-a.invalid", "technician", "فني أ", "فني إنذار", "أنظمة الإنذار", 24]);
  S.techToken = r.token;
  S.techInvitation = r.invitation_id;
  assert.match(await err(rpc(u.manager, "company_invite_member", [S.companyB, "x@y.zz", "technician", null, null, null, 24])), /لمدير الشركة فقط/);
  assert.match(await err(rpc(u.manager, "company_invite_member", [S.companyA, "x@y.zz", "company_manager", null, null, null, 24])), /دور غير مسموح/);
  assert.match(await err(rpc(u.tech, "company_invite_member", [S.companyA, "x@y.zz", "technician", null, null, null, 24])), /لمدير الشركة فقط/);
  // مدير ب لا يرى دعوات أ ولا أعضاءها
  assert.equal((await as(u.other, "select id from public.company_invitations where company_id = $1", [S.companyA])).length, 0);
  assert.equal((await as(u.other, "select id from public.company_memberships where company_id = $1", [S.companyA])).length, 0);
  assert.equal((await as(u.other, "select id from public.companies where id = $1", [S.companyA])).length, 0);
});

test("إعادة الإرسال تبطل الرمز القديم، والإلغاء والانتهاء يمنعان القبول", async () => {
  const again = await rpc(u.manager, "company_resend_invitation", [S.techInvitation, 24]);
  assert.match(await err(rpc(u.tech, "accept_company_invitation", [S.techToken])), /أُلغيت/);
  S.techToken = again.token;
  // دعوة تنتهي صلاحيتها
  const exp = await rpc(u.manager, "company_invite_member", [S.companyA, "late@company-a.invalid", "accountant", null, null, null, 1]);
  await db.query("update public.company_invitations set expires_at = now() - interval '1 minute' where id = $1", [exp.invitation_id]);
  const late = await user("late@company-a.invalid");
  assert.match(await err(rpc(late, "accept_company_invitation", [exp.token])), /انتهت صلاحية/);
  // دعوة ملغاة
  const rev = await rpc(u.manager, "company_invite_member", [S.companyA, "rev@company-a.invalid", "storekeeper", null, null, null, 24]);
  await rpc(u.manager, "company_revoke_invitation", [rev.invitation_id]);
  const revUser = await user("rev@company-a.invalid");
  assert.match(await err(rpc(revUser, "accept_company_invitation", [rev.token])), /أُلغيت/);
  // مدير آخر لا يلغي دعوات غير شركته
  assert.match(await err(rpc(u.other, "company_revoke_invitation", [S.techInvitation])), /غير مصرح/);
});

test("قبول دعوة العضو ينشئ عضوية واحدة بالدور المحدد، ويمنع التكرار", async () => {
  await rpc(u.tech, "accept_company_invitation", [S.techToken]);
  const [m] = await as(u.tech, "select role, full_name, job_title, specialty, status from public.company_memberships where user_id = $1", [u.tech]);
  assert.deepEqual(m, { role: "technician", full_name: "فني أ", job_title: "فني إنذار", specialty: "أنظمة الإنذار", status: "active" });
  assert.match(await err(rpc(u.manager, "company_invite_member", [S.companyA, "tech@company-a.invalid", "supervisor", null, null, null, 24])), /عضوية قائمة/);
  // الفني لا يرى دعوات الشركة ولا سجل التدقيق
  assert.equal((await as(u.tech, "select id from public.company_invitations")).length, 0);
  assert.equal((await as(u.tech, "select id from public.company_audit_log")).length, 0);
});

test("إدارة العضو: تغيير الدور والتعطيل والإزالة، مع حماية المدير الأساسي والنفس", async () => {
  const [tm] = await as(u.manager, "select id from public.company_memberships where user_id = $1", [u.tech]);
  const [mm] = await as(u.manager, "select id from public.company_memberships where user_id = $1", [u.manager]);
  await rpc(u.manager, "company_set_member_role", [tm.id, "supervisor"]);
  assert.match(await err(rpc(u.manager, "company_set_member_role", [tm.id, "company_manager"])), /دور غير مسموح/);
  assert.match(await err(rpc(u.manager, "company_set_member_status", [mm.id, "suspended"])), /المدير الأساسي محمي/);
  assert.match(await err(rpc(u.tech, "company_set_member_status", [mm.id, "removed"])), /لمدير الشركة فقط|محمي/);
  await rpc(u.manager, "company_set_member_status", [tm.id, "suspended"]);
  assert.equal((await as(u.tech, "select id from public.companies")).length, 0); // العضو الموقوف لا يرى شركته
  await rpc(u.manager, "company_set_member_status", [tm.id, "active"]);
  S.techMembership = tm.id;
});

test("تغيير بريد عضو يتطلب قبول البريد الجديد وينقل العضوية دون تكرار", async () => {
  const r = await rpc(u.manager, "company_change_member_email", [S.techMembership, "tech.new@company-a.invalid", 24]);
  assert.match(await err(rpc(u.tech, "accept_company_invitation", [r.token])), /لبريد آخر/);
  await rpc(u.tech2, "accept_company_invitation", [r.token]);
  const [m] = (await db.query("select user_id, email, role from public.company_memberships where id = $1", [S.techMembership])).rows;
  assert.deepEqual(m, { user_id: u.tech2, email: "tech.new@company-a.invalid", role: "supervisor" });
  assert.equal((await as(u.tech, "select id from public.companies")).length, 0);
});

test("نقل الإدارة: المدير الجديد أساسي والسابق يصبح مشرفًا دون حذف", async () => {
  const r = await rpc(u.owner, "platform_invite_manager", [S.companyA, "new.manager@company-a.invalid", 24]);
  await rpc(u.manager2, "accept_company_invitation", [r.token]);
  const rows = (await db.query("select user_id, role, is_primary from public.company_memberships where company_id = $1 and user_id in ($2, $3) order by is_primary desc", [S.companyA, u.manager2, u.manager])).rows;
  assert.deepEqual(rows, [{ user_id: u.manager2, role: "company_manager", is_primary: true }, { user_id: u.manager, role: "supervisor", is_primary: false }]);
  assert.equal((await db.query("select manager_email from public.companies where id = $1", [S.companyA])).rows[0].manager_email, "new.manager@company-a.invalid");
});

test("الإيقاف والأرشفة والحذف الآمن، وسجل التدقيق ثابت", async () => {
  await rpc(u.owner, "platform_set_company_status", [S.companyA, "suspended"]);
  // سياسة القراءة القائمة تُبقي صف الشركة مرئيًا لأعضائها (لعرض رسالة الإيقاف)، لكن لا دور تشغيلي
  assert.equal(await rpc(u.manager2, "current_company_role", [S.companyA]), null);
  assert.match(await err(rpc(u.manager2, "company_invite_member", [S.companyA, "z@y.zz", "technician", null, null, null, 24])), /لمدير الشركة فقط/);
  await rpc(u.owner, "platform_set_company_status", [S.companyA, "active"]);
  assert.match(await err(rpc(u.owner, "platform_delete_company", [S.companyA, "ORG-000002"])), /أرشفة الشركة قبل/);
  await rpc(u.owner, "platform_set_company_status", [S.companyA, "archived"]);
  assert.match(await err(rpc(u.owner, "platform_delete_company", [S.companyA, "ORG-000002"])), /عضويات مرتبطة/);
  // شركة بلا عضويات تُحذف بعد الأرشفة وتأكيد رقمها، ويبقى سجلها
  const c = await rpc(u.owner, "platform_create_company", ["شركة مؤقتة", "tmp@ays-tmp.invalid", null, null, null, 24]);
  await rpc(u.owner, "platform_set_company_status", [c.company_id, "archived"]);
  assert.match(await err(rpc(u.owner, "platform_delete_company", [c.company_id, "ORG-999999"])), /لا يطابق/);
  await rpc(u.owner, "platform_delete_company", [c.company_id, c.ref_no]);
  assert.equal((await db.query("select count(*)::int n from public.companies where id = $1", [c.company_id])).rows[0].n, 0);
  const actions = (await db.query("select action from public.company_audit_log where company_id = $1 order by id", [c.company_id])).rows.map((r) => r.action);
  assert.deepEqual(actions, ["company_created", "invitation_created", "company_status", "company_deleted"]);
  assert.match(await err(as(u.owner, "delete from public.company_audit_log")), /permission denied/);
  assert.match(await err(db.query("delete from public.company_audit_log")), /لا يُعدَّل ولا يُحذف/);
  // الحذف المتسلسل للعضويات أُلغي
  assert.match(await err(db.query("delete from public.companies where id = $1", [S.companyA])), /foreign key|violates/);
});

test("الرقم المرجعي فريد وثابت", async () => {
  assert.match(await err(db.query("update public.companies set ref_no = 'ORG-000050' where id = $1", [S.companyB])), /الرقم المرجعي/);
  const refs = (await db.query("select ref_no from public.companies")).rows.map((r) => r.ref_no);
  assert.equal(new Set(refs).size, refs.length);
});
