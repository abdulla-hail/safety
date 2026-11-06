-- =====================================================================
-- عين السلامة — الحذف الكامل للشركة بيد مالك المنصة (مشروع cgwnusudjhhxkwnqjzfr) — مقترح، لا يُطبَّق دون موافقة
--
-- الحذف الآمن الحالي (م1: platform_delete_company) يبقى كما هو: للمؤرشفة بلا سجلات تشغيلية.
-- هذا الترحيل يضيف مسارًا منفصلًا لمالك المنصة الأساسي فقط (لا المساعدين):
-- 1) platform_company_purge_preview(company): أعداد كل ما سيُحذف في كل جدول + ملفات التخزين وحجمها + الأعضاء
--    وأي حساباتهم يمكن حذفها (لا ينتمي لشركة أخرى ولا يملك صفة منصة ولا بيانات في النظام القديم safety_*).
-- 2) platform_purge_company(company, اسم الشركة للتأكيد، حذف الحسابات؟): معاملة واحدة تحذف كل صفوف الشركة في 28 جدولًا
--    (العملاء، المواقع، الأجهزة، الزيارات وبنودها، نتائج الفحص وسجلات الصيانة، البلاغات وأحداثها، أوامر العمل، المرفقات،
--    الإسنادات وسجلها، الكتالوج، العضويات، الدعوات، الإشعارات، سجل الهوية...) ثم الشركة نفسها، وتعيد مسارات ملفاتها
--    في التخزين ليحذفها الخادم عبر واجهة Storage (حذف storage.objects بـ SQL ممنوع في Supabase).
--    - لقطة في platform_audit_log (بيانات الشركة، أعداد المحذوف، الأعضاء، الحسابات المحذوفة، مسارات الملفات) وفي company_audit_log.
--    - company_audit_log للشركة يبقى (سجل تدقيق غير قابل للحذف بالتصميم)، ورموز QR في app_private.device_tokens تبقى حتى لا يتكرر رمز مطبوع.
--    - الحسابات: لا تُحذف إلا بطلب صريح، وفقط حسابات أعضاء هذه الشركة القابلة للحذف (انظر 1).
-- 3) استثناء حذف الشركة في مشغلات منع تعديل السجل التاريخي (block_change) ومشغلات التدقيق (audit_row/audit_link):
--    يسري فقط عندما تضبط دالة الحذف في المعاملة نفسها app.company_purge = معرّف الشركة، وعلى صفوف تلك الشركة فقط.
-- 4) Storage: مالك المنصة يقرأ ويحذف فقط ملفات org-files/org-branding التي تتبع شركة لم تعد موجودة (لا تمس أي شركة قائمة)،
--    و platform_orphan_company_files() تسرد هذه الملفات (لإعادة محاولة الحذف أو تنظيف ملفات الاختبار القديمة).
--
-- لا يحذف ولا يعدّل أي صف قائم عند التطبيق. لا يمس جداول/دوال safety_* (قراءة فقط لاستبعاد حسابات النظام القديم).
-- ملاحظة: الاستدعاء من الواجهة يخضع لمهلة دور authenticated (8 ثوانٍ)؛ عند تجاوزها تُلغى المعاملة كاملة دون حذف أي شيء.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) استثناء الحذف الكامل في مشغلات السجل التاريخي والتدقيق
-- ---------------------------------------------------------------------
create or replace function app_private.block_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- الحذف الكامل للشركة فقط (يضبطه platform_purge_company داخل معاملته) وعلى صفوفها فقط
  if tg_op = 'DELETE' and coalesce(current_setting('app.company_purge', true), '') = (to_jsonb(old) ->> 'company_id') then
    return old;
  end if;
  raise exception 'هذا السجل تاريخي ولا يمكن تعديله أو حذفه' using errcode = '42501';
end $$;

create or replace function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text; v_changes jsonb := '{}'::jsonb; k text;
begin
  -- الحذف الكامل للشركة يُسجَّل مرة واحدة كلقطة، لا قيدًا لكل صف محذوف
  if coalesce(current_setting('app.company_purge', true), '') = (v_row ->> 'company_id') then return null; end if;
  if tg_op = 'INSERT' then v_action := 'create';
  elsif tg_op = 'DELETE' then v_action := 'delete'; v_changes := v_old - array['updated_at', 'created_at'];
  else
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
    v_action := case when v_changes ? 'archived_at' then case when (v_new ->> 'archived_at') is null then 'restore' else 'archive' end
                     when v_changes ? 'status' then 'status_change' else 'update' end;
  end if;
  perform public.company_audit((v_row ->> 'company_id')::uuid, v_action, tg_argv[0],
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    jsonb_build_object('ref_no', v_row ->> 'ref_no',
      'name', coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', v_row ->> 'device_name_snapshot'),
      'changes', v_changes));
  return null;
end $$;

create or replace function app_private.audit_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  if coalesce(current_setting('app.company_purge', true), '') = (v ->> 'company_id') then return null; end if;
  perform public.company_audit((v ->> 'company_id')::uuid, case when tg_op = 'INSERT' then 'assign' else 'unassign' end,
    tg_argv[0], null, v - array['created_at']);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 2) جداول الشركة بترتيب الحذف (الأبناء قبل الآباء)
-- ---------------------------------------------------------------------
create or replace function app_private.company_purge_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'notifications', 'device_fault_events', 'maintenance_corrections', 'maintenance_record_technicians', 'maintenance_records',
    'visit_devices', 'device_faults', 'visit_technicians', 'attachments', 'visits', 'work_order_devices', 'work_order_technicians',
    'work_orders', 'device_due_changes', 'device_maintenance_cycles', 'device_transfers', 'technician_customer_sites',
    'technician_customers', 'technician_assignment_events', 'devices', 'customer_sites', 'customers', 'technicians',
    'catalog_items', 'safety_systems', 'company_branding_history', 'company_invitations', 'company_memberships']
$$;

-- هل للحساب بيانات في النظام القديم safety_*؟ (قراءة فقط؛ مفاتيحها بلا حذف متتالٍ فلا يُحذف حسابها أبدًا)
create or replace function app_private.user_has_legacy_rows(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v boolean := false;
begin
  if to_regclass('public.safety_tenants') is not null then
    execute 'select exists (select 1 from public.safety_tenants where user_id = $1)' into v using p_user;
    if v then return true; end if;
  end if;
  if to_regclass('public.safety_owner_workspaces') is not null then
    execute 'select exists (select 1 from public.safety_owner_workspaces where user_id = $1)' into v using p_user;
    if v then return true; end if;
  end if;
  if to_regclass('public.safety_company_access') is not null then
    execute 'select exists (select 1 from public.safety_company_access where user_id = $1 or account_id = $1)' into v using p_user;
    if v then return true; end if;
  end if;
  return false;
end $$;

-- أعضاء الشركة (العضويات + سجلات الفنيين المرتبطة بحساب) ومصير حساب كل منهم
create or replace function app_private.company_purge_users(p_company uuid)
returns table (user_id uuid, email text, full_name text, role text, removable boolean, keep_reason text)
language sql stable security definer set search_path = '' as $$
  with u as (
    select m.user_id, m.email, m.full_name, m.role from public.company_memberships m where m.company_id = p_company
    union all
    select t.user_id, null, t.full_name, 'technician' from public.technicians t
    where t.company_id = p_company and t.user_id is not null
      and not exists (select 1 from public.company_memberships m where m.company_id = p_company and m.user_id = t.user_id)
  ), r as (
    select distinct on (u.user_id) u.user_id, coalesce(lower(au.email), u.email) email, u.full_name, u.role,
      case
        when au.id is null then 'no_account'
        when u.user_id = auth.uid() then 'self'
        when exists (select 1 from public.platform_admins pa where pa.user_id = u.user_id)
          or exists (select 1 from public.platform_assistants a where a.user_id = u.user_id) then 'platform'
        when exists (select 1 from public.company_memberships m where m.user_id = u.user_id and m.company_id <> p_company)
          or exists (select 1 from public.technicians t where t.user_id = u.user_id and t.company_id <> p_company) then 'other_company'
        when app_private.user_has_legacy_rows(u.user_id) then 'legacy'
      end keep_reason
    from u left join auth.users au on au.id = u.user_id
    order by u.user_id
  )
  select r.user_id, r.email, r.full_name, r.role, r.keep_reason is null, r.keep_reason from r
$$;

-- هل يتبع مسار التخزين شركة لم تعد موجودة؟ (المسار يبدأ بمعرّف الشركة)
create or replace function app_private.storage_company_gone(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.storage_company(p_name) is not null
    and not exists (select 1 from public.companies c where c.id = app_private.storage_company(p_name))
$$;

-- ---------------------------------------------------------------------
-- 3) المعاينة
-- ---------------------------------------------------------------------
create or replace function public.platform_company_purge_preview(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.companies; t text; n bigint; v_counts jsonb := '{}'::jsonb; v_total bigint := 0;
begin
  perform public.require_platform_admin();
  select * into v from public.companies where id = p_company;
  if v.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  foreach t in array app_private.company_purge_tables() loop
    execute format('select count(*) from public.%I where company_id = $1', t) into n using p_company;
    v_counts := v_counts || jsonb_build_object(t, n);
    v_total := v_total + n;
  end loop;
  return jsonb_build_object(
    'company', jsonb_build_object('id', v.id, 'name', v.name, 'ref_no', v.ref_no, 'status', v.status),
    'counts', v_counts,
    'total_rows', v_total,
    'audit_entries_kept', (select count(*) from public.company_audit_log where company_id = p_company),
    'files', (select jsonb_build_object('count', count(*), 'bytes', coalesce(sum(((to_jsonb(o) -> 'metadata') ->> 'size')::bigint), 0))
              from storage.objects o where o.bucket_id in ('org-files', 'org-branding') and o.name like p_company::text || '/%'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', x.email, 'full_name', x.full_name,
              'role', x.role, 'removable', x.removable, 'keep_reason', x.keep_reason) order by x.removable desc, x.email)
              from app_private.company_purge_users(p_company) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4) الحذف الكامل (معاملة واحدة)
-- ---------------------------------------------------------------------
create or replace function public.platform_purge_company(p_company uuid, p_confirm_name text, p_delete_accounts boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.companies; t text; n bigint;
  v_counts jsonb := '{}'::jsonb; v_files jsonb; v_members jsonb; v_del uuid[] := '{}'; v_del_emails jsonb := '[]'::jsonb;
  v_deleted_accounts integer := 0;
begin
  perform public.require_platform_admin();
  -- قفل صف الشركة: أي إدراج متزامن في جداولها (يتحقق من المفتاح الأجنبي) ينتظر ثم يفشل بعد الحذف
  select * into v from public.companies where id = p_company for update;
  if v.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if btrim(coalesce(p_confirm_name, '')) = '' or btrim(p_confirm_name) <> btrim(v.name) then
    raise exception 'الاسم المكتوب لا يطابق اسم الشركة' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name) order by o.bucket_id, o.name), '[]'::jsonb)
    into v_files from storage.objects o where o.bucket_id in ('org-files', 'org-branding') and o.name like p_company::text || '/%';
  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', x.email, 'full_name', x.full_name, 'role', x.role,
           'account', case when x.removable and p_delete_accounts then 'deleted' else coalesce(x.keep_reason, 'kept') end)), '[]'::jsonb)
    into v_members from app_private.company_purge_users(p_company) x;
  if p_delete_accounts then
    select coalesce(array_agg(x.user_id), '{}'), coalesce(jsonb_agg(x.email), '[]'::jsonb) into v_del, v_del_emails
      from app_private.company_purge_users(p_company) x where x.removable;
  end if;

  -- الاستثناء يخص هذه المعاملة وهذه الشركة فقط
  perform set_config('app.company_purge', p_company::text, true);
  perform set_config('app.visit_work', 'company_purge', true);
  foreach t in array app_private.company_purge_tables() loop
    execute format('delete from public.%I where company_id = $1', t) using p_company;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object(t, n);
  end loop;
  -- إلغاء الإسناد يُسجّل أحداثًا جديدة بمشغّل؛ تُحذف معها
  delete from public.technician_assignment_events where company_id = p_company;
  delete from app_private.ref_counters where company_id = p_company;
  delete from public.companies where id = p_company;
  perform set_config('app.company_purge', '', true);
  perform set_config('app.visit_work', '', true);

  if cardinality(v_del) > 0 then
    -- تحقق أخير: لا مالك منصة ولا مساعد ولا عضو في شركة أخرى (حذف الحساب يحذف هوياته وجلساته وإشعاراته)
    delete from auth.users au where au.id = any (v_del) and au.id is distinct from auth.uid()
      and not exists (select 1 from public.platform_admins pa where pa.user_id = au.id)
      and not exists (select 1 from public.platform_assistants a where a.user_id = au.id)
      and not exists (select 1 from public.company_memberships m where m.user_id = au.id)
      and not exists (select 1 from public.technicians tt where tt.user_id = au.id);
    get diagnostics v_deleted_accounts = row_count;
  end if;

  perform public.company_audit(p_company, 'company_purged', 'company', p_company,
    jsonb_build_object('name', v.name, 'ref_no', v.ref_no, 'deleted', v_counts, 'files', jsonb_array_length(v_files),
      'deleted_accounts', v_deleted_accounts));
  perform app_private.platform_audit('company_purged', jsonb_build_object(
    'company', to_jsonb(v), 'deleted', v_counts, 'members', v_members,
    'accounts_requested', p_delete_accounts, 'deleted_accounts', v_deleted_accounts, 'deleted_account_emails', v_del_emails,
    'files', case when jsonb_array_length(v_files) <= 2000 then v_files else jsonb_build_array(jsonb_build_object('truncated', jsonb_array_length(v_files))) end));

  return jsonb_build_object('deleted', v_counts, 'files', v_files, 'deleted_accounts', v_deleted_accounts);
end $$;

-- ---------------------------------------------------------------------
-- 5) ملفات الشركات المحذوفة في التخزين: قراءة وحذف لمالك المنصة فقط
-- ---------------------------------------------------------------------
create or replace function public.platform_orphan_company_files(p_limit integer default 1000)
returns table (bucket text, name text, bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_platform_admin();
  return query
    select o.bucket_id::text, o.name::text, coalesce(((to_jsonb(o) -> 'metadata') ->> 'size')::bigint, 0)
    from storage.objects o
    where o.bucket_id in ('org-files', 'org-branding') and app_private.storage_company_gone(o.name)
    order by o.bucket_id, o.name
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
end $$;

drop policy if exists ays_purged_company_files_read on storage.objects;
create policy ays_purged_company_files_read on storage.objects for select to authenticated
  using (bucket_id in ('org-files', 'org-branding') and public.is_platform_admin() and app_private.storage_company_gone(name));
drop policy if exists ays_purged_company_files_delete on storage.objects;
create policy ays_purged_company_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('org-files', 'org-branding') and public.is_platform_admin() and app_private.storage_company_gone(name));

revoke all on function app_private.company_purge_tables(), app_private.user_has_legacy_rows(uuid),
  app_private.company_purge_users(uuid) from public, anon, authenticated;
revoke all on function app_private.storage_company_gone(text) from public, anon;
grant execute on function app_private.storage_company_gone(text) to authenticated;
revoke all on function public.platform_company_purge_preview(uuid), public.platform_purge_company(uuid, text, boolean),
  public.platform_orphan_company_files(integer) from public, anon;
grant execute on function public.platform_company_purge_preview(uuid), public.platform_purge_company(uuid, text, boolean),
  public.platform_orphan_company_files(integer) to authenticated;

notify pgrst, 'reload schema';
