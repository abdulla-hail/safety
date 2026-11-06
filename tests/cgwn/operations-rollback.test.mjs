// التطبيق ثم التراجع للترحيل التشغيلي يعيد البنية كما كانت بعد ترحيل الدعوات، دون فقد بيانات الشركات والعضويات.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    columns: await q(`select table_schema, table_name, column_name, udt_name from information_schema.columns where table_schema in ('public','storage') order by 1,2,3`),
    constraints: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1,2`),
    policies: await q(`select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies order by 1,2,3`),
    grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3`),
    functions: await q(`select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1,2`),
    triggers: await q(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal order by 1,2`),
    schemas: await q(`select nspname from pg_namespace where nspname in ('app_private') order by 1`),
    data: await q(`select c.name, c.status, (select count(*)::int from public.company_memberships m where m.company_id = c.id) members from public.companies c order by c.name`),
  };
}

test("تطبيق الترحيل التشغيلي ثم التراجع يعيد الحالة السابقة تمامًا", async () => {
  const db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.exec(read("tests", "cgwn", "storage-stub.sql"));
  await db.query("insert into public.companies (name, status) values ('شركة قائمة', 'active')");
  await db.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
  const before = await snapshot(db);
  await db.exec(read("supabase", "migrations", "20261028000100_operations_permissions_branding.sql"));
  assert.equal((await db.query("select count(*)::int n from public.safety_systems")).rows[0].n, 7);
  await db.exec(read("supabase", "proposed", "20261028000100_rollback.sql"));
  const after = await snapshot(db);
  assert.deepEqual(after, before);
});

test("التراجع يُرفض عند وجود أي بيانات أُنشئت بعد الترحيل (حماية من فقد البيانات)", async () => {
  const cases = [
    ["عميل", "insert into public.customers (company_id, name) select id, 'عميل' from public.companies limit 1"],
    ["هوية", "update public.companies set primary_color = '#000000'"],
    ["نظام معدّل", "update public.safety_systems set name = name || ' (معدل)' where id = (select id from public.safety_systems limit 1)"],
    ["إشعار", "insert into public.notifications (recipient_user_id, kind, title) values ((select id from auth.users limit 1), 'x', 'x')"],
  ];
  for (const [label, sql] of cases) {
    const db = new PGlite();
    await db.exec(read("tests", "cgwn", "current-schema.sql"));
    await db.exec(read("tests", "cgwn", "storage-stub.sql"));
    await db.query("insert into auth.users (id, email) values (gen_random_uuid(), 'x@y.invalid')");
    await db.query("insert into public.companies (name, status) values ('شركة قائمة', 'active')");
    await db.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
    await db.exec(read("supabase", "migrations", "20261028000100_operations_permissions_branding.sql"));
    await db.exec(sql);
    await assert.rejects(db.exec(read("supabase", "proposed", "20261028000100_rollback.sql")), /التراجع مرفوض/, label);
    // لم يُحذف شيء
    assert.equal((await db.query("select count(*)::int n from public.safety_systems")).rows[0].n, 7, label);
  }
});
