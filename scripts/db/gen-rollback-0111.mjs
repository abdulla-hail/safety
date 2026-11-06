// يولّد ملف التراجع لترحيل 20261111000100 من تعريفات cgwn الحالية (قراءة فقط، قبل التطبيق).
// الاستخدام: node scripts/db/gen-rollback-0111.mjs
import fs from "node:fs";
import pg from "pg";
import { pgConfig } from "./env.mjs";
import { assertTarget } from "./cgwn-fingerprint.mjs";

const cfg = pgConfig();
assertTarget(cfg.connectionString);
const c = new pg.Client(cfg);
await c.connect();
await c.query("begin transaction read only");
if ((await c.query("select to_regclass('public.brands') b")).rows[0].b) {
  throw new Error("الترحيل مطبّق بالفعل؛ التعريفات الحالية ليست تعريفات ما قبل الترحيل — توقف.");
}
const fns = ["app_private.quotations_guard()", "app_private.quotation_items_guard()", "public.quotation_from_visit(uuid)",
  "public.quotation_set_status(uuid, text, text)", "public.shared_document(text)", "app_private.run_maintenance_alerts_for(uuid, date)"];
const defs = [];
for (const f of fns) defs.push((await c.query("select pg_get_functiondef($1::regprocedure) d", [f])).rows[0].d.trim() + ";");
const pols = (await c.query(`select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'
  and ((tablename = 'quotations' and policyname in ('ays_qt_select', 'ays_qt_insert', 'ays_qt_update'))
    or (tablename = 'quotation_items' and policyname in ('ays_qi_insert', 'ays_qi_update', 'ays_qi_delete'))) order by 1, 2`)).rows;
const cons = (await c.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
  where conname in ('customers_customer_type_check', 'quotations_status_check')`)).rows;
const inPub = (await c.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'`)).rows[0].n > 0;
const touch = (await c.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.company_memberships'::regclass
  and tgname = 'company_memberships_touch' and not tgisinternal`)).rows[0].n;
await c.query("rollback");
await c.end();
if (touch !== 1) throw new Error("مُشغّل company_memberships_touch غير موجود كما هو متوقع — توقف.");
if (pols.length !== 6) throw new Error(`عُثر على ${pols.length} سياسات بدل 6 — توقف.`);
if (cons.length !== 2) throw new Error("لم يُعثر على القيدين المتوقعين — توقف.");

const polSql = pols.map((p) => {
  const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, "").split(",")).join(", ");
  return `drop policy if exists ${p.policyname} on public.${p.tablename};\ncreate policy ${p.policyname} on public.${p.tablename} for ${p.cmd.toLowerCase()} to ${roles}`
    + (p.qual ? ` using (${p.qual})` : "") + (p.with_check ? ` with check (${p.with_check})` : "") + ";";
}).join("\n");
const conSql = cons.map((k) => `alter table ${k.t} drop constraint if exists ${k.conname};\nalter table ${k.t} add constraint ${k.conname} ${k.d};`).join("\n");

const sql = `-- =====================================================================
-- التراجع عن 20261111000100_brands_tech_quotes_activity.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت بيانات تعتمد على الترحيل (ماركات، بريد شركة، تفضيلات إشعارات، عروض بانتظار المراجعة، عملاء «مؤسسة»،
-- إشعارات أنشطة، أو مواعيد تنبيه مخصصة).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.brands) or exists (select 1 from public.company_mail_settings)
     or exists (select 1 from public.notification_preferences) or exists (select 1 from public.quotations where status = 'review' or submitted_at is not null)
     or exists (select 1 from public.customers where customer_type = 'establishment')
     or exists (select 1 from public.notifications where actor_user_id is not null)
     or exists (select 1 from public.survey_items where brand is not null) or exists (select 1 from public.quotation_items where brand is not null)
     or exists (select 1 from public.companies where alert_lead_days <> '{30,15,7,1}')
     or exists (select 1 from public.company_invitations where 'quotes.create' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل' using errcode = 'P0001';
  end if;
end $$;
${inPub ? "" : `do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end $$;`}
drop trigger if exists trg_visits_activity on public.visits;
drop trigger if exists trg_devices_activity on public.devices;
drop trigger if exists trg_attachments_activity on public.attachments;
drop trigger if exists trg_maintenance_activity on public.maintenance_records;
drop trigger if exists trg_due_changes_activity on public.device_due_changes;
drop trigger if exists trg_quotations_activity on public.quotations;
drop trigger if exists trg_quotation_items_activity on public.quotation_items;
drop trigger if exists trg_quotation_items_audit on public.quotation_items;
drop trigger if exists trg_survey_items_brand on public.survey_items;
drop trigger if exists trg_quotation_items_brand on public.quotation_items;
drop function if exists app_private.activity_visits();
drop function if exists app_private.activity_devices();
drop function if exists app_private.activity_attachments();
drop function if exists app_private.activity_maintenance();
drop function if exists app_private.activity_due_changes();
drop function if exists app_private.activity_quotations();
drop function if exists app_private.activity_quote_items();
drop function if exists app_private.quotation_items_audit();
drop function if exists app_private.item_brand_sync();

${defs.join("\n\n")}

drop function if exists app_private.run_ops_digest_for(uuid, date);
drop function if exists app_private.notify_activity(uuid, text, text, text, text, text, text, uuid, text);
drop function if exists app_private.actor_name(uuid, uuid);
drop function if exists public.set_alert_lead_days(uuid, integer[]);
drop function if exists public.company_mail_test_result(uuid, boolean, text);
drop function if exists public.company_mail_config(uuid);

${polSql}
drop function if exists app_private.quote_can_edit(uuid);
drop function if exists app_private.quote_in_scope(uuid, uuid, uuid);

${conSql}

drop table if exists public.notification_preferences;
drop table if exists public.company_mail_settings;
alter table public.notifications drop column if exists actor_user_id;
alter table public.companies drop constraint if exists companies_alert_lead_days_chk;
alter table public.companies drop column if exists alert_lead_days;
alter table public.quotations drop column if exists submitted_at, drop column if exists approved_by, drop column if exists approved_at;
alter table public.survey_items drop column if exists brand_id, drop column if exists brand;
alter table public.quotation_items drop column if exists brand_id, drop column if exists brand;
drop table if exists public.brands;

-- عضويات الفنيين التي عدّلها الترحيل: تُعاد صلاحياتها ووقت آخر تحديث كما كانت بالضبط من النسخة المحفوظة،
-- ما لم تُعدَّل بعد الترحيل (عندها يُزال quotes.create فقط ويبقى تعديل المدير). مُشغّل اللمس يُوقف مؤقتًا داخل المعاملة فقط.
do $$ begin
  if to_regclass('app_private.migration_0111_memberships') is not null then
    alter table public.company_memberships disable trigger company_memberships_touch;
    update public.company_memberships m set permissions = b.permissions, updated_at = b.updated_at
    from app_private.migration_0111_memberships b
    where m.id = b.membership_id and m.permissions = array_append(b.permissions, 'quotes.create') and m.updated_at = b.migrated_at;
    alter table public.company_memberships enable trigger company_memberships_touch;
  end if;
end $$;
update public.company_memberships set permissions = array_remove(permissions, 'quotes.create') where 'quotes.create' = any (permissions);
drop table if exists app_private.migration_0111_memberships;
delete from public.company_role_permissions where permission_key = 'quotes.create';
delete from public.permission_definitions where key = 'quotes.create';

notify pgrst, 'reload schema';
`;
fs.writeFileSync("supabase/proposed/20261111000100_rollback.sql", sql);
console.log("wrote supabase/proposed/20261111000100_rollback.sql", { functions: defs.length, policies: pols.length, constraints: cons.length, notificationsInPublication: inPub });
