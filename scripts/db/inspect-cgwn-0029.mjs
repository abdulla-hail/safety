// فحص قراءة فقط قبل ترحيل صور الأجهزة وربط الفنيين بعضوياتهم (لا يطبع أي بيانات شخصية).
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
const q = async (sql) => (await c.query(sql)).rows;
const out = {
  target: "cgwn…zfr ✓",
  technician_memberships: await q(`select m.status, count(*)::int n,
      count(t.id)::int linked from public.company_memberships m
      left join public.technicians t on t.company_id = m.company_id and t.user_id = m.user_id
      where m.role = 'technician' group by 1`),
  technicians: await q(`select count(*)::int total, count(user_id)::int with_user from public.technicians`),
  unlinked_same_email: await q(`select count(*)::int n from public.technicians t join public.company_memberships m
      on m.company_id = t.company_id and lower(m.email) = lower(t.email) where t.user_id is null`),
  devices: await q("select count(*)::int n from public.devices"),
  buckets: await q("select id, public, file_size_limit from storage.buckets order by id"),
  conflicts: await q(`select 'column:'||table_name||'.'||column_name n from information_schema.columns
      where table_schema='public' and ((table_name='devices' and column_name='image_path') or (table_name='company_invitations' and column_name='permissions'))
      union all select 'function:'||proname from pg_proc where proname in ('company_set_invitation_permissions','link_technician_membership','devices_image_check','invitation_apply_permissions')`),
  specialty_values: await q("select count(*)::int n, count(specialty)::int with_specialty from public.company_memberships where role='technician'"),
};
await c.query("rollback");
await c.end();
console.log(JSON.stringify(out, null, 2));
