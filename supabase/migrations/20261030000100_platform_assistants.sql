-- =====================================================================
-- عين السلامة — مساعدو مالك المنصة (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) طلب انضمام «مساعد مالك»: يرسله أي مستخدم مسجل ليس مالكًا ولا عضوًا نشطًا في شركة. لا يمنح أي صلاحية.
-- 2) المالك الأساسي وحده يراجع الطلبات (قبول بصلاحيات محددة / رفض)، ويعدّل صلاحيات المساعد ويعطله ويلغيه.
-- 3) صلاحيات المساعد محددة ومنفصلة عن صلاحيات الشركات:
--      platform.companies.view · platform.companies.create · platform.companies.update
--      platform.companies.status · platform.companies.invitations · platform.companies.delete
--    وتُطبق داخل دوال المنصة القائمة (السطر الحارس فقط تغيّر) وسياسات قراءة إضافية.
-- 4) الفصل: المساعد لا يصبح عضوًا في شركة ولا مديرًا لها، ولا يرى بياناتها التشغيلية (عملاء/أجهزة/...).
--    إدارة المساعدين (الطلبات والصلاحيات) للمالك الأساسي فقط.
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------
create table if not exists public.platform_permission_definitions (
  key text primary key,
  label_ar text not null,
  sort_order integer not null default 0
);
insert into public.platform_permission_definitions (key, label_ar, sort_order) values
  ('platform.companies.view', 'عرض الشركات وأعضائها ودعواتها وسجل تدقيقها', 1),
  ('platform.companies.create', 'تسجيل شركة جديدة ودعوة مديرها', 2),
  ('platform.companies.update', 'تعديل بيانات الشركات', 3),
  ('platform.companies.status', 'تفعيل الشركات وإيقافها وأرشفتها', 4),
  ('platform.companies.invitations', 'دعوات مديري الشركات ونقل الإدارة وإعادة الإرسال والإلغاء', 5),
  ('platform.companies.delete', 'حذف الشركات المؤرشفة نهائيًا', 6)
on conflict (key) do update set label_ar = excluded.label_ar, sort_order = excluded.sort_order;

create table if not exists public.platform_assistant_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  message text check (message is null or length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists platform_assistant_requests_one_pending on public.platform_assistant_requests (user_id) where status = 'pending';
create index if not exists platform_assistant_requests_status_idx on public.platform_assistant_requests (status, created_at desc);

create table if not exists public.platform_assistants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  permissions text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  request_id uuid references public.platform_assistant_requests(id) on delete set null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) فحص الصلاحيات
-- ---------------------------------------------------------------------
create or replace function public.platform_assistant_permissions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.permissions from public.platform_assistants a where a.user_id = auth.uid() and a.status = 'active'), '{}')
$$;

-- المالك يملك كل صلاحيات المنصة؛ المساعد النشط ما مُنح له فقط
create or replace function public.platform_has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or p_perm = any (public.platform_assistant_permissions())
$$;

create or replace function public.require_platform_perm(p_perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.platform_has_perm(p_perm) then
    raise exception 'ليست لديك صلاحية هذه العملية في إدارة المنصة' using errcode = '42501';
  end if;
end $$;

create or replace function app_private.is_platform_staff_email(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u join public.platform_admins p on p.user_id = u.id where lower(u.email) = lower(btrim(p_email)))
      or exists (select 1 from public.platform_assistants a where lower(a.email) = lower(btrim(p_email)) and a.status = 'active')
$$;

-- ---------------------------------------------------------------------
-- 3) طلب الانضمام ومراجعته وإدارة المساعدين
-- ---------------------------------------------------------------------
create or replace function public.platform_request_assistant(p_full_name text, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_id uuid; o record;
begin
  if v_uid is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  if public.is_platform_admin() then raise exception 'أنت مالك المنصة' using errcode = 'P0001'; end if;
  if exists (select 1 from public.platform_assistants where user_id = v_uid and status = 'active') then
    raise exception 'أنت مساعد مالك بالفعل' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.company_memberships where user_id = v_uid and status = 'active') then
    raise exception 'حسابك عضو في شركة؛ مساعد المالك يجب أن يكون حسابًا منفصلًا عن الشركات' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.platform_assistant_requests where user_id = v_uid and status = 'pending') then
    raise exception 'لديك طلب قيد المراجعة بالفعل' using errcode = '23505';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then raise exception 'بريد الحساب غير مؤكد' using errcode = '42501'; end if;
  insert into public.platform_assistant_requests (user_id, email, full_name, message)
  values (v_uid, v_email, nullif(btrim(p_full_name), ''), nullif(btrim(p_message), ''))
  returning id into v_id;
  for o in select user_id from public.platform_admins loop
    perform app_private.notify(null, o.user_id, 'assistant_request', 'طلب انضمام مساعد مالك',
      coalesce(nullif(btrim(p_full_name), ''), v_email), '/platform-admin/assistants', 'assistant_request', v_id, 'assistant_request:' || v_id);
  end loop;
  return v_id;
end $$;

create or replace function public.platform_cancel_assistant_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.platform_assistant_requests set status = 'cancelled'
   where id = p_request and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'لا يوجد طلب معلّق لإلغائه' using errcode = 'P0002'; end if;
end $$;

create or replace function app_private.valid_platform_permissions(p_permissions text[]) returns text[]
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) k
             where not exists (select 1 from public.platform_permission_definitions d where d.key = k)) then
    raise exception 'صلاحية منصة غير معروفة' using errcode = '22023';
  end if;
  return array(select distinct k from unnest(coalesce(p_permissions, '{}')) k order by k);
end $$;

-- المالك الأساسي فقط: قبول بصلاحيات محددة أو رفض
create or replace function public.platform_review_assistant_request(p_request uuid, p_approve boolean, p_permissions text[], p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.platform_assistant_requests; v_perms text[];
begin
  perform public.require_platform_admin();
  select * into r from public.platform_assistant_requests where id = p_request for update;
  if r.id is null then raise exception 'الطلب غير موجود' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب من قبل' using errcode = 'P0001'; end if;
  if p_approve then
    v_perms := app_private.valid_platform_permissions(p_permissions);
    if cardinality(v_perms) = 0 then raise exception 'حدد صلاحية واحدة على الأقل للمساعد' using errcode = '22023'; end if;
    if exists (select 1 from public.platform_admins where user_id = r.user_id) then
      raise exception 'هذا الحساب مالك للمنصة' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.company_memberships where user_id = r.user_id and status = 'active') then
      raise exception 'صاحب الطلب أصبح عضوًا في شركة؛ لا يمكن جمع العضوية مع صفة مساعد المالك' using errcode = 'P0001';
    end if;
    insert into public.platform_assistants (user_id, email, full_name, permissions, status, request_id, granted_by, granted_at, updated_by, updated_at)
    values (r.user_id, r.email, r.full_name, v_perms, 'active', r.id, auth.uid(), now(), auth.uid(), now())
    on conflict (user_id) do update set permissions = excluded.permissions, status = 'active', request_id = excluded.request_id,
      email = excluded.email, full_name = coalesce(excluded.full_name, public.platform_assistants.full_name),
      updated_by = auth.uid(), updated_at = now();
  end if;
  update public.platform_assistant_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(btrim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = r.id;
  perform app_private.notify(null, r.user_id, 'assistant_review',
    case when p_approve then 'تمت الموافقة على طلبك: أنت الآن مساعد مالك' else 'لم تتم الموافقة على طلب مساعد المالك' end,
    nullif(btrim(p_note), ''), case when p_approve then '/platform-admin' else '/onboarding' end, 'assistant_request', r.id, 'assistant_review:' || r.id);
end $$;

-- المالك الأساسي فقط: تعديل الصلاحيات أو التعطيل/التفعيل أو الإلغاء (الإلغاء لا يحذف السجل)
create or replace function public.platform_update_assistant(p_user uuid, p_permissions text[], p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.platform_assistants; v_perms text[];
begin
  perform public.require_platform_admin();
  select * into a from public.platform_assistants where user_id = p_user for update;
  if a.user_id is null then raise exception 'المساعد غير موجود' using errcode = 'P0002'; end if;
  if p_status not in ('active', 'suspended', 'revoked') then raise exception 'حالة غير صالحة' using errcode = '22023'; end if;
  v_perms := case when p_permissions is null then a.permissions else app_private.valid_platform_permissions(p_permissions) end;
  if p_status = 'active' and cardinality(v_perms) = 0 then raise exception 'حدد صلاحية واحدة على الأقل' using errcode = '22023'; end if;
  if p_status = 'active' and a.status <> 'active'
     and exists (select 1 from public.company_memberships where user_id = p_user and status = 'active') then
    raise exception 'الحساب عضو في شركة؛ لا يمكن إعادة تفعيله مساعدًا' using errcode = 'P0001';
  end if;
  update public.platform_assistants set permissions = v_perms, status = p_status, updated_by = auth.uid(), updated_at = now()
   where user_id = p_user;
end $$;

-- الفصل: المساعد النشط لا يصبح عضوًا في شركة (يشمل قبول الدعوات)
create or replace function app_private.block_assistant_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and exists (select 1 from public.platform_assistants where user_id = new.user_id and status = 'active') then
    raise exception 'حساب مساعد المالك لا يقبل عضوية في الشركات' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_memberships_block_assistant on public.company_memberships;
create trigger trg_memberships_block_assistant before insert or update of status, user_id on public.company_memberships
  for each row execute function app_private.block_assistant_membership();

-- ---------------------------------------------------------------------
-- 4) دوال المنصة القائمة: نفس المنطق، والحارس صار بالصلاحية المحددة
-- ---------------------------------------------------------------------
create or replace function public.platform_create_company(
  p_name text, p_manager_email text, p_commercial_registration text default null,
  p_phone text default null, p_city text default null, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company public.companies; v_inv jsonb; v_email text := lower(btrim(p_manager_email));
begin
  perform public.require_platform_perm('platform.companies.create');
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'اسم الشركة مطلوب' using errcode = '22023'; end if;
  if app_private.is_platform_staff_email(v_email) then
    raise exception 'بريد مدير الشركة لا يمكن أن يكون حساب مالك المنصة أو مساعده' using errcode = '22023';
  end if;
  insert into public.companies (name, status, manager_email, commercial_registration, phone, city, created_by)
  values (btrim(p_name), 'pending', v_email, nullif(btrim(p_commercial_registration), ''),
          nullif(btrim(p_phone), ''), nullif(btrim(p_city), ''), auth.uid())
  returning * into v_company;
  perform public.company_audit(v_company.id, 'company_created', 'company', v_company.id,
    jsonb_build_object('name', v_company.name, 'ref_no', v_company.ref_no, 'manager_email', v_email));
  v_inv := public.company_create_invitation(v_company.id, 'manager', v_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
  return v_inv || jsonb_build_object('company_id', v_company.id, 'ref_no', v_company.ref_no);
end $$;

create or replace function public.platform_update_company(
  p_company uuid, p_name text, p_commercial_registration text, p_phone text, p_city text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.companies;
begin
  perform public.require_platform_perm('platform.companies.update');
  select * into v_old from public.companies where id = p_company for update;
  if v_old.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'اسم الشركة مطلوب' using errcode = '22023'; end if;
  update public.companies set name = btrim(p_name),
    commercial_registration = nullif(btrim(p_commercial_registration), ''),
    phone = nullif(btrim(p_phone), ''), city = nullif(btrim(p_city), '')
  where id = p_company;
  perform public.company_audit(p_company, 'company_updated', 'company', p_company,
    jsonb_build_object('before', jsonb_build_object('name', v_old.name, 'commercial_registration', v_old.commercial_registration, 'phone', v_old.phone, 'city', v_old.city)));
end $$;

create or replace function public.platform_set_company_status(p_company uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform public.require_platform_perm('platform.companies.status');
  if p_status not in ('active', 'suspended', 'archived') then raise exception 'حالة غير صالحة' using errcode = '22023'; end if;
  select status into v_old from public.companies where id = p_company for update;
  if v_old is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if p_status = 'active' and not exists (select 1 from public.company_memberships where company_id = p_company and is_primary and status = 'active') then
    raise exception 'لا يمكن تفعيل الشركة قبل قبول مديرها للدعوة' using errcode = 'P0001';
  end if;
  update public.companies set status = p_status,
    suspended_at = case when p_status = 'suspended' then now() when p_status = 'active' then null else suspended_at end,
    archived_at = case when p_status = 'archived' then now() when p_status = 'active' then null else archived_at end
  where id = p_company;
  perform public.company_audit(p_company, 'company_status', 'company', p_company, jsonb_build_object('from', v_old, 'to', p_status));
end $$;

create or replace function public.platform_invite_manager(p_company uuid, p_email text, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_email text := lower(btrim(p_email)); v_kind text;
begin
  perform public.require_platform_perm('platform.companies.invitations');
  select status into v_status from public.companies where id = p_company for update;
  if v_status is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if v_status = 'archived' then raise exception 'الشركة مؤرشفة' using errcode = 'P0001'; end if;
  if app_private.is_platform_staff_email(v_email) then
    raise exception 'بريد مدير الشركة لا يمكن أن يكون حساب مالك المنصة أو مساعده' using errcode = '22023';
  end if;
  v_kind := case when exists (select 1 from public.company_memberships where company_id = p_company and is_primary) then 'manager_transfer' else 'manager' end;
  if v_kind = 'manager' then
    update public.companies set manager_email = v_email where id = p_company;
  end if;
  return public.company_create_invitation(p_company, v_kind, v_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
end $$;

create or replace function public.platform_delete_company(p_company uuid, p_confirm_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.companies;
begin
  perform public.require_platform_perm('platform.companies.delete');
  select * into v from public.companies where id = p_company for update;
  if v.id is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if v.status <> 'archived' then raise exception 'يجب أرشفة الشركة قبل حذفها' using errcode = 'P0001'; end if;
  if upper(btrim(coalesce(p_confirm_ref, ''))) <> v.ref_no then raise exception 'رقم التأكيد لا يطابق رقم الشركة' using errcode = '22023'; end if;
  if exists (select 1 from public.company_memberships where company_id = p_company) then
    raise exception 'للشركة عضويات مرتبطة؛ تبقى مؤرشفة للحفاظ على السجلات' using errcode = '23503';
  end if;
  if exists (select 1 from public.company_invitations where company_id = p_company and status = 'accepted') then
    raise exception 'للشركة دعوات مقبولة؛ تبقى مؤرشفة للحفاظ على السجلات' using errcode = '23503';
  end if;
  perform public.company_audit(p_company, 'company_deleted', 'company', p_company,
    jsonb_build_object('name', v.name, 'ref_no', v.ref_no));
  delete from public.company_invitations where company_id = p_company;
  delete from public.companies where id = p_company;
end $$;

create or replace function public.company_transfer_management(p_company uuid, p_new_email text, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.platform_has_perm('platform.companies.invitations') and not exists (
    select 1 from public.company_memberships m where m.company_id = p_company and m.user_id = auth.uid() and m.is_primary and m.status = 'active') then
    raise exception 'نقل الإدارة لمالك المنصة أو المدير الأساسي فقط' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_memberships where company_id = p_company and is_primary) then
    raise exception 'لا يوجد مدير أساسي لنقل الإدارة منه' using errcode = 'P0001';
  end if;
  return public.company_create_invitation(p_company, 'manager_transfer', p_new_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
end $$;

create or replace function public.company_can_manage_invitation(p_inv public.company_invitations) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_inv.kind in ('manager', 'manager_transfer')
              then public.platform_has_perm('platform.companies.invitations')
                   or (p_inv.kind = 'manager_transfer' and exists (select 1 from public.company_memberships m
                         where m.company_id = p_inv.company_id and m.user_id = auth.uid() and m.is_primary and m.status = 'active'))
              else coalesce(public.current_company_role(p_inv.company_id), '') = 'company_manager' end
$$;

-- السياق: صفة المنصة (مالك/مساعد) وصلاحياتها، إضافةً للحقول السابقة دون تغيير
create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'platform_role', case when public.is_platform_admin() then 'owner'
                          when cardinality(public.platform_assistant_permissions()) > 0 then 'assistant' end,
    'platform_permissions', case when public.is_platform_admin() then to_jsonb(array(select key from public.platform_permission_definitions order by sort_order))
                                 else to_jsonb(public.platform_assistant_permissions()) end,
    'unread_notifications', (select count(*) from public.notifications where recipient_user_id = auth.uid() and read_at is null),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'company_id', c.id, 'company_name', c.name, 'company_ref', c.ref_no, 'company_status', c.status,
        'role', m.role, 'status', m.status, 'is_primary', m.is_primary,
        'permissions', to_jsonb(public.company_effective_permissions(m.role, m.permissions)),
        'primary_color', c.primary_color, 'secondary_color', c.secondary_color, 'logo_path', c.logo_path
      ) order by m.created_at)
      from public.company_memberships m join public.companies c on c.id = m.company_id
      where m.user_id = auth.uid() and m.status <> 'removed'), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------
-- 5) RLS: قراءة إضافية للمساعد حسب الصلاحية (الكتابة عبر الدوال فقط)
-- ---------------------------------------------------------------------
alter table public.platform_permission_definitions enable row level security;
alter table public.platform_assistant_requests enable row level security;
alter table public.platform_assistants enable row level security;
revoke all on public.platform_permission_definitions, public.platform_assistant_requests, public.platform_assistants from anon;
revoke all on public.platform_permission_definitions, public.platform_assistant_requests, public.platform_assistants from authenticated;
grant select on public.platform_permission_definitions, public.platform_assistant_requests, public.platform_assistants to authenticated;

drop policy if exists ppd_select on public.platform_permission_definitions;
create policy ppd_select on public.platform_permission_definitions for select to authenticated using (true);
drop policy if exists par_select on public.platform_assistant_requests;
create policy par_select on public.platform_assistant_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));
drop policy if exists pa_select on public.platform_assistants;
create policy pa_select on public.platform_assistants for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));

drop policy if exists companies_select_platform_assistant on public.companies;
create policy companies_select_platform_assistant on public.companies for select to authenticated
  using ((select public.platform_has_perm('platform.companies.view')));
drop policy if exists memberships_select_platform_assistant on public.company_memberships;
create policy memberships_select_platform_assistant on public.company_memberships for select to authenticated
  using ((select public.platform_has_perm('platform.companies.view')));
drop policy if exists company_invitations_select_platform_assistant on public.company_invitations;
create policy company_invitations_select_platform_assistant on public.company_invitations for select to authenticated
  using ((select public.platform_has_perm('platform.companies.view')));
drop policy if exists company_audit_log_select_platform_assistant on public.company_audit_log;
create policy company_audit_log_select_platform_assistant on public.company_audit_log for select to authenticated
  using ((select public.platform_has_perm('platform.companies.view')));

-- ---------------------------------------------------------------------
-- 6) الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.is_platform_staff_email(text), app_private.valid_platform_permissions(text[]),
  app_private.block_assistant_membership() from public, anon, authenticated;
revoke all on function public.require_platform_perm(text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'public.platform_assistant_permissions()', 'public.platform_has_perm(text)',
    'public.platform_request_assistant(text, text)', 'public.platform_cancel_assistant_request(uuid)',
    'public.platform_review_assistant_request(uuid, boolean, text[], text)', 'public.platform_update_assistant(uuid, text[], text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
