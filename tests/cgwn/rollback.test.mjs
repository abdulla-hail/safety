// يتحقق أن ملف التراجع يعيد البنية الأصلية بالضبط (أعمدة، قيود، سياسات، صلاحيات، دوال) مع الحفاظ على البيانات.
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
    columns: await q(`select table_name, column_name, udt_name, is_nullable, column_default from information_schema.columns
      where table_schema='public' order by 1,2`),
    constraints: await q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
      where connamespace='public'::regnamespace order by 1,2`),
    policies: await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by 1,2`),
    grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3`),
    functions: await q(`select proname from pg_proc where pronamespace='public'::regnamespace order by 1`),
    data: await q(`select name, status from public.companies order by name`),
  };
}

test("التطبيق ثم التراجع يعيد البنية الأصلية دون فقد بيانات", async () => {
  const db = new PGlite();
  await db.exec(read("tests", "cgwn", "current-schema.sql"));
  await db.query("insert into public.companies (name, status) values ('شركة قائمة', 'active'), ('بانتظار', 'waiting_list'), ('مغلقة', 'closed')");
  const before = await snapshot(db);
  await db.exec(read("supabase", "migrations", "20261027000100_companies_memberships_invitations.sql"));
  const mid = (await db.query("select name, status from public.companies order by name")).rows;
  assert.deepEqual(mid.map((r) => r.status).sort(), ["active", "pending", "suspended"]);
  await db.exec(read("supabase", "proposed", "20261027000100_rollback.sql"));
  const after = await snapshot(db);
  assert.deepEqual(after, before);
});
