// اختبار مقترح التقوية (20261027000200) على نسخة محلية مطابقة لبنية cgwn بعد ترحيل الدعوات.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
let db;
const u = {};
const S = {};

async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
}
const rpc = async (uid, fn, args) => (await as(uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args))[0].r;
async function user(email) {
  return (await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) returning id", [crypto.randomUUID(), email])).rows[0].id;
}

// النسخة الأصلية من safety_is_owner ببريد ثابت تجريبي (للمقارنة)
const ORIGINAL_OWNER = `create or replace function public.safety_is_owner() returns boolean language plpgsql stable security definer set search_path to '' as $f$
declare existing_owner boolean := false;
begin
 if auth.uid() is null then return false; end if;
 if to_regclass('public.platform_admins') is not null then
  execute 'select exists(select 1 from public.platform_admins where user_id=$1)' into existing_owner using auth.uid();
 end if;
 return existing_owner or exists(select 1 from auth.users where id=auth.uid() and lower(email)='hardcoded.owner@ays.invalid' and email_confirmed_at is not null);
end $f$;
create table public.safety_tenants (company_key uuid primary key, company_data jsonb not null);
create table public.safety_company_access (id bigint generated always as identity primary key, company_key uuid, email text, role text,
  token uuid default gen_random_uuid(), account_id uuid, accepted_at timestamptz, expires_at timestamptz default now() + interval '7 days',
  revoked boolean not null default false, unique (company_key, email));`;

before(async () => {
  db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.exec(ORIGINAL_OWNER);
  await db.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
  u.owner = await user("owner@ays.invalid");
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);
  u.hard = await user("hardcoded.owner@ays.invalid");
  u.manager = await user("m@a.invalid");
  u.tech = await user("t@a.invalid");
  u.tech2 = await user("t2@a.invalid");
  u.otherManager = await user("m@b.invalid");
  const a = await rpc(u.owner, "platform_create_company", ["شركة أ", "m@a.invalid", null, null, null, 24]);
  const b = await rpc(u.owner, "platform_create_company", ["شركة ب", "m@b.invalid", null, null, null, 24]);
  S.a = a.company_id; S.b = b.company_id;
  await rpc(u.manager, "accept_company_invitation", [a.token]);
  await rpc(u.otherManager, "accept_company_invitation", [b.token]);
  for (const [who, email] of [[u.tech, "t@a.invalid"], [u.tech2, "t2@a.invalid"]]) {
    const i = await rpc(u.manager, "company_invite_member", [S.a, email, "technician", null, null, null, 24]);
    await rpc(who, "accept_company_invitation", [i.token]);
  }
});

test("قبل التقوية: البريد الثابت يمنح صفة المالك لحساب ليس في platform_admins، وكل عضو يرى الجميع", async () => {
  assert.equal(await rpc(u.hard, "safety_is_owner", []), true);
  assert.equal((await as(u.tech, "select id from public.company_memberships")).length, 3);
});

test("بعد التقوية: صفة المالك من platform_admins فقط، والرؤية بأقل صلاحية", async () => {
  await db.exec(read("supabase", "proposed", "20261027000200_owner_and_member_visibility.sql"));
  assert.equal(await rpc(u.owner, "safety_is_owner", []), true);
  assert.equal(await rpc(u.hard, "safety_is_owner", []), false);
  assert.equal(await rpc(u.manager, "safety_is_owner", []), false);
  // سحب صفة المالك يصبح فعّالًا فورًا
  await db.query("delete from public.platform_admins where user_id = $1", [u.owner]);
  assert.equal(await rpc(u.owner, "safety_is_owner", []), false);
  await db.query("insert into public.platform_admins (user_id) values ($1)", [u.owner]);

  const techSees = await as(u.tech, "select user_id from public.company_memberships");
  assert.deepEqual(techSees.map((r) => r.user_id), [u.tech]);
  assert.equal((await as(u.manager, "select id from public.company_memberships where company_id = $1", [S.a])).length, 3);
  assert.equal((await as(u.manager, "select id from public.company_memberships where company_id = $1", [S.b])).length, 0);
  assert.ok((await as(u.owner, "select id from public.company_memberships")).length >= 4);
  // العضو الموقوف يرى عضويته (لعرض حالتها) ولا يرى غيرها
  const [tm] = await as(u.manager, "select id from public.company_memberships where user_id = $1", [u.tech2]);
  await rpc(u.manager, "company_set_member_status", [tm.id, "suspended"]);
  const s = await as(u.tech2, "select status from public.company_memberships");
  assert.deepEqual(s, [{ status: "suspended" }]);
  // مسار الدعوات يبقى سليمًا
  const i = await rpc(u.manager, "company_invite_member", [S.a, "x@a.invalid", "storekeeper", null, null, null, 24]);
  const x = await user("x@a.invalid");
  await rpc(x, "accept_company_invitation", [i.token]);
  assert.equal((await as(x, "select role from public.company_memberships"))[0].role, "storekeeper");
});

test("safety_provision_company_manager يرفض بريد مالك المنصة دون بريد ثابت", async () => {
  const key = crypto.randomUUID();
  await db.query("insert into public.safety_tenants values ($1, $2)", [key, JSON.stringify({ email: "owner@ays.invalid" })]);
  await assert.rejects(as(u.owner, "select public.safety_provision_company_manager($1)", [key]), /بريد مالك المنصة|إدارة المنصة/);
  await db.query("update public.safety_tenants set company_data = $2 where company_key = $1", [key, JSON.stringify({ email: "boss@c.invalid" })]);
  await as(u.owner, "select public.safety_provision_company_manager($1)", [key]);
  assert.equal((await db.query("select role from public.safety_company_access where company_key = $1", [key])).rows[0].role, "manager");
});
