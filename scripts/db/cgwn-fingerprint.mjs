// بصمة قراءة فقط لبيانات مشروع cgwn: يتحقق من المشروع المستهدف، ويحسب عدد الصفوف وبصمة MD5
// لمحتوى كل جدول (دون طباعة أي بيانات)، ويفحص تعارض أسماء الكائنات التي ينشئها المقترح.
// الاستخدام: node scripts/db/cgwn-fingerprint.mjs [--out file.json]
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";

export const EXPECTED_REF = "cgwnusudjhhxkwnqjzfr";

export function assertTarget(connectionString) {
  const user = decodeURIComponent(new URL(connectionString).username);
  if (user !== `postgres.${EXPECTED_REF}`) throw new Error("DATABASE_URL لا يشير إلى مشروع cgwn — توقف.");
}

export async function fingerprint(client) {
  const tables = (await client.query(`select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t);
  const out = {};
  for (const t of tables) {
    const r = (await client.query(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') h from public."${t}" x`)).rows[0];
    out[t] = { rows: r.n, md5: r.h };
  }
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const cfg = pgConfig();
  assertTarget(cfg.connectionString);
  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("begin transaction read only");
  const fp = await fingerprint(c);
  const conflicts = (await c.query(`
    select 'table:'||table_name n from information_schema.tables where table_schema='public' and table_name in ('company_invitations','company_audit_log')
    union all select 'sequence:'||sequencename from pg_sequences where schemaname='public' and sequencename='company_ref_seq'
    union all select 'column:companies.'||column_name from information_schema.columns where table_schema='public' and table_name='companies'
      and column_name in ('ref_no','commercial_registration','phone','city','manager_email','suspended_at','archived_at','created_by')
    union all select 'column:company_memberships.'||column_name from information_schema.columns where table_schema='public' and table_name='company_memberships'
      and column_name in ('full_name','email','job_title','specialty','is_primary','invited_by','removed_at','updated_at')
    union all select 'function:'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('company_next_ref','companies_before_update','company_memberships_touch','company_audit_block','company_audit','company_token_hash',
       'company_create_invitation','current_company_role','require_company_manager','require_platform_admin','platform_create_company',
       'platform_update_company','platform_set_company_status','platform_invite_manager','platform_delete_company','company_invite_member',
       'company_transfer_management','company_can_manage_invitation','company_revoke_invitation','company_resend_invitation','company_member_guard',
       'company_update_member','company_set_member_role','company_set_member_status','company_change_member_email','invitation_preview','accept_company_invitation')`)).rows.map((r) => r.n);
  const statuses = (await c.query("select status, count(*)::int n from public.companies group by 1")).rows;
  const roles = (await c.query("select role, status, count(*)::int n from public.company_memberships group by 1,2")).rows;
  const dupes = (await c.query("select count(*)::int n from (select company_id from public.company_memberships group by company_id, user_id having count(*)>1) d")).rows[0].n;
  await c.query("rollback");
  await c.end();
  const result = { target: "cgwn…zfr ✓", read_only: true, fingerprint: fp, conflicts, company_statuses: statuses, membership_roles: roles, duplicate_memberships: dupes };
  const i = process.argv.indexOf("--out");
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
