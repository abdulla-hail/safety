// يولّد ملف التراجع للمقترح 20261027000200 من التعريفات والسياسة الحالية في cgwn (قراءة فقط، قبل أي تطبيق).
// الاستخدام: node scripts/db/gen-rollback-0200.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
const fn = async (sig) => (await c.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d.trim();
const owner = await fn("public.safety_is_owner()");
if (!owner.includes("email")) throw new Error("safety_is_owner لا يحوي فحص البريد؛ يبدو أن المقترح مطبّق بالفعل — توقف.");
const provision = await fn("public.safety_provision_company_manager(uuid)");
const p = (await c.query(`select permissive, roles::text[] roles, cmd, qual, with_check from pg_policies
  where schemaname = 'public' and tablename = 'company_memberships' and policyname = 'memberships_select_authorized'`)).rows[0];
await c.query("rollback");
await c.end();
const roles = p.roles.map((r) => (r === "public" ? "public" : `"${r}"`)).join(", ");

const sql = `-- =====================================================================
-- التراجع عن 20261027000200_owner_and_member_visibility.sql (مولَّد من تعريفات cgwn الحالية قبل أي تطبيق)
-- يعيد الدالتين حرفيًا وسياسة رؤية العضويات كما هي. لا يمس أي بيانات. صلاحيات التنفيذ لا تتغير مع CREATE OR REPLACE.
-- =====================================================================

${owner};

${provision};

drop policy if exists memberships_select_authorized on public.company_memberships;
create policy memberships_select_authorized on public.company_memberships as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${roles}
  using (${p.qual});

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261027000200_rollback.sql", sql);
console.log(JSON.stringify({ written: "supabase/proposed/20261027000200_rollback.sql" }));
