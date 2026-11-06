-- =====================================================================
-- عين السلامة — مقترح: الشركات والعضويات والدعوات (مشروع cgwnusudjhhxkwnqjzfr)
-- الحالة: مقترح للمراجعة فقط — لم يُطبَّق. لا يُنقل إلى supabase/migrations إلا بموافقة صريحة.
--
-- المبادئ:
-- * يبني على الجداول القائمة companies و company_memberships و platform_admins (لا نظام موازٍ).
-- * لا يمس جداول safety_* ولا بياناتها، ولا ينقل بيانات تلقائيًا.
-- * لا يحذف أي صف. يغيّر قيود الحالة والدور، ويحوّل الحذف المتسلسل للعضويات إلى منع.
-- * الكتابة على الشركات والعضويات والدعوات عبر دوال SECURITY DEFINER تتحقق من الصلاحية وتسجّل في سجل التدقيق.
-- * رمز الدعوة لا يُخزَّن؛ تُخزَّن بصمته SHA-256 فقط، ويُعاد الرمز مرة واحدة عند الإنشاء.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الشركات: رقم مرجعي تلقائي، بيانات تعريفية، حالات جديدة
-- ---------------------------------------------------------------------
create sequence if not exists public.company_ref_seq;
-- الصلاحيات الافتراضية في Supabase تمنح anon/authenticated استخدام التسلسلات الجديدة؛ يُستخدم عبر دالة المالك فقط
revoke all on sequence public.company_ref_seq from public, anon, authenticated;

create or replace function public.company_next_ref() returns text
language sql volatile security definer set search_path = '' as $$
  select 'ORG-' || case when length(v::text) >= 6 then v::text else lpad(v::text, 6, '0') end
  from (select nextval('public.company_ref_seq') as v) s
$$;
revoke all on function public.company_next_ref() from public, anon, authenticated;

alter table public.companies
  add column if not exists ref_no text,
  add column if not exists commercial_registration text,
  add column if not exists phone text,
  add column if not exists city text,
  add column if not exists manager_email text,
  add column if not exists suspended_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ترقيم الشركات القائمة مرة واحدة حسب تاريخ الإنشاء (دون تغيير أي بيانات أخرى)
do $$
declare r record;
begin
  for r in select id from public.companies where ref_no is null order by created_at, id loop
    update public.companies set ref_no = public.company_next_ref() where id = r.id;
  end loop;
end $$;

alter table public.companies alter column ref_no set default public.company_next_ref();
alter table public.companies alter column ref_no set not null;
create unique index if not exists companies_ref_no_key on public.companies (ref_no);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_manager_email_chk') then
    alter table public.companies add constraint companies_manager_email_chk
      check (manager_email is null or (manager_email = lower(btrim(manager_email)) and manager_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
  end if;
end $$;

-- الحالات: pending (بانتظار قبول دعوة المدير) · active · suspended · archived
-- القيم القديمة: waiting_list → pending ، closed → suspended
alter table public.companies drop constraint if exists companies_status_check;
update public.companies set status = 'pending' where status = 'waiting_list';
update public.companies set status = 'suspended', suspended_at = coalesce(suspended_at, now()) where status = 'closed';
alter table public.companies add constraint companies_status_check
  check (status in ('pending', 'active', 'suspended', 'archived'));
alter table public.companies alter column status set default 'pending';

create or replace function public.companies_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ref_no is distinct from old.ref_no then
    raise exception 'لا يمكن تعديل الرقم المرجعي للشركة' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists companies_before_update on public.companies;
create trigger companies_before_update before update on public.companies
  for each row execute function public.companies_before_update();

-- ---------------------------------------------------------------------
-- 2) العضويات: بيانات العضو، دور أمين المستودع، حالة الإزالة، المدير الأساسي
-- ---------------------------------------------------------------------
alter table public.company_memberships
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists job_title text,
  add column if not exists specialty text,
  add column if not exists is_primary boolean not null default false,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists removed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.company_memberships drop constraint if exists company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role in ('company_manager', 'supervisor', 'technician', 'accountant', 'storekeeper'));

alter table public.company_memberships drop constraint if exists company_memberships_status_check;
alter table public.company_memberships add constraint company_memberships_status_check
  check (status in ('active', 'suspended', 'removed'));

-- حذف الشركة لا يحذف عضوياتها تلقائيًا (كان ON DELETE CASCADE)
alter table public.company_memberships drop constraint if exists company_memberships_company_id_fkey;
alter table public.company_memberships add constraint company_memberships_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete restrict;

create unique index if not exists company_memberships_one_primary
  on public.company_memberships (company_id) where is_primary;

drop trigger if exists company_memberships_touch on public.company_memberships;
create or replace function public.company_memberships_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger company_memberships_touch before update on public.company_memberships
  for each row execute function public.company_memberships_touch();

-- ---------------------------------------------------------------------
-- 3) الدعوات
-- ---------------------------------------------------------------------
create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  -- member: عضو جديد · manager: أول مدير للشركة · manager_transfer: نقل الإدارة · email_change: تغيير بريد عضو
  kind text not null check (kind in ('member', 'manager', 'manager_transfer', 'email_change')),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('company_manager', 'supervisor', 'technician', 'accountant', 'storekeeper')),
  full_name text,
  job_title text,
  specialty text,
  membership_id uuid references public.company_memberships(id) on delete restrict,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  replaced_by uuid references public.company_invitations(id) on delete set null
);
create unique index if not exists company_invitations_one_pending
  on public.company_invitations (company_id, email, kind) where status = 'pending';
create index if not exists company_invitations_company_idx on public.company_invitations (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4) سجل التدقيق (لا يُعدَّل ولا يُحذف)
-- ---------------------------------------------------------------------
create table if not exists public.company_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,               -- بلا مفتاح أجنبي: يبقى السجل بعد حذف الشركة
  actor_user_id uuid,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists company_audit_log_company_idx on public.company_audit_log (company_id, created_at desc);

create or replace function public.company_audit_block() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'سجل التدقيق لا يُعدَّل ولا يُحذف' using errcode = '42501'; end $$;
drop trigger if exists company_audit_log_block on public.company_audit_log;
create trigger company_audit_log_block before update or delete on public.company_audit_log
  for each row execute function public.company_audit_block();

-- ---------------------------------------------------------------------
-- 5) دوال مساعدة داخلية (غير قابلة للاستدعاء من الواجهة)
-- ---------------------------------------------------------------------
create or replace function public.company_audit(p_company uuid, p_action text, p_target_type text, p_target uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.company_audit_log (company_id, actor_user_id, actor_email, action, target_type, target_id, details)
  values (p_company, auth.uid(), (select lower(email) from auth.users where id = auth.uid()),
          p_action, p_target_type, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.company_token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- يُنشئ دعوة ويعيد الرمز الخام مرة واحدة فقط (256 بت عشوائية، بصيغة URL آمنة)
create or replace function public.company_create_invitation(
  p_company uuid, p_kind text, p_email text, p_role text, p_full_name text, p_job_title text,
  p_specialty text, p_membership uuid, p_hours integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 720));
  v_email text := lower(btrim(p_email));
  v_replaced uuid[];
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'البريد الإلكتروني غير صالح' using errcode = '22023';
  end if;
  v_token := translate(encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_');
  -- دعوة معلّقة سابقة لنفس البريد والنوع تُلغى وتُستبدل بالجديدة
  with old as (
    update public.company_invitations
       set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
     where company_id = p_company and email = v_email and kind = p_kind and status = 'pending'
    returning id)
  select array_agg(id) into v_replaced from old;
  insert into public.company_invitations (company_id, kind, email, role, full_name, job_title, specialty, membership_id, token_hash, expires_at, invited_by)
  values (p_company, p_kind, v_email, p_role, nullif(btrim(p_full_name), ''), nullif(btrim(p_job_title), ''),
          nullif(btrim(p_specialty), ''), p_membership, public.company_token_hash(v_token), v_expires, auth.uid())
  returning id into v_id;
  if v_replaced is not null then
    update public.company_invitations set replaced_by = v_id where id = any (v_replaced);
  end if;
  perform public.company_audit(p_company, 'invitation_created', 'invitation', v_id,
    jsonb_build_object('kind', p_kind, 'email', v_email, 'role', p_role, 'expires_at', v_expires));
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'expires_at', v_expires, 'email', v_email);
end $$;

revoke all on function public.company_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.company_create_invitation(uuid, text, text, text, text, text, text, uuid, integer) from public, anon, authenticated;

-- دور المستخدم الحالي في شركة نشطة (أو pending للمدير قبل التفعيل الكامل)
create or replace function public.current_company_role(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.company_memberships m
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
    and c.status = 'active'
  limit 1
$$;
revoke all on function public.current_company_role(uuid) from public, anon;
grant execute on function public.current_company_role(uuid) to authenticated;

create or replace function public.require_company_manager(p_company uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.current_company_role(p_company), '') <> 'company_manager' then
    raise exception 'هذه العملية لمدير الشركة فقط' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_company_manager(uuid) from public, anon, authenticated;

create or replace function public.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'هذه العملية لمالك المنصة فقط' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_platform_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) دوال مالك المنصة
-- ---------------------------------------------------------------------
create or replace function public.platform_create_company(
  p_name text, p_manager_email text, p_commercial_registration text default null,
  p_phone text default null, p_city text default null, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company public.companies; v_inv jsonb; v_email text := lower(btrim(p_manager_email));
begin
  perform public.require_platform_admin();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'اسم الشركة مطلوب' using errcode = '22023'; end if;
  if exists (select 1 from auth.users u join public.platform_admins p on p.user_id = u.id where lower(u.email) = v_email) then
    raise exception 'بريد مدير الشركة لا يمكن أن يكون حساب مالك المنصة' using errcode = '22023';
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
  perform public.require_platform_admin();
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

-- active · suspended · archived ؛ ولا يُفعَّل pending يدويًا إلا إذا وُجد مدير أساسي
create or replace function public.platform_set_company_status(p_company uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform public.require_platform_admin();
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

-- دعوة مدير (أول مدير، أو نقل الإدارة إلى بريد جديد عند وجود مدير)
create or replace function public.platform_invite_manager(p_company uuid, p_email text, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_email text := lower(btrim(p_email)); v_kind text;
begin
  perform public.require_platform_admin();
  select status into v_status from public.companies where id = p_company for update;
  if v_status is null then raise exception 'الشركة غير موجودة' using errcode = 'P0002'; end if;
  if v_status = 'archived' then raise exception 'الشركة مؤرشفة' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users u join public.platform_admins p on p.user_id = u.id where lower(u.email) = v_email) then
    raise exception 'بريد مدير الشركة لا يمكن أن يكون حساب مالك المنصة' using errcode = '22023';
  end if;
  v_kind := case when exists (select 1 from public.company_memberships where company_id = p_company and is_primary) then 'manager_transfer' else 'manager' end;
  if v_kind = 'manager' then
    update public.companies set manager_email = v_email where id = p_company;
  end if;
  return public.company_create_invitation(p_company, v_kind, v_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
end $$;

-- حذف نهائي: فقط لشركة مؤرشفة بلا أي عضويات ولا دعوات مقبولة. سجل التدقيق يبقى.
create or replace function public.platform_delete_company(p_company uuid, p_confirm_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.companies;
begin
  perform public.require_platform_admin();
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

-- ---------------------------------------------------------------------
-- 7) دوال مدير الشركة (والمالك عند الحاجة)
-- ---------------------------------------------------------------------
create or replace function public.company_invite_member(
  p_company uuid, p_email text, p_role text, p_full_name text default null, p_job_title text default null,
  p_specialty text default null, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email));
begin
  perform public.require_company_manager(p_company);
  if p_role not in ('supervisor', 'technician', 'accountant', 'storekeeper') then
    raise exception 'دور غير مسموح؛ تعيين مدير الشركة يتم بإجراء نقل الإدارة' using errcode = '22023';
  end if;
  if exists (select 1 from public.company_memberships m join auth.users u on u.id = m.user_id
             where m.company_id = p_company and m.status <> 'removed' and lower(u.email) = v_email) then
    raise exception 'لهذا البريد عضوية قائمة في الشركة' using errcode = '23505';
  end if;
  return public.company_create_invitation(p_company, 'member', v_email, p_role, p_full_name, p_job_title, p_specialty, null, p_expires_hours);
end $$;

create or replace function public.company_transfer_management(p_company uuid, p_new_email text, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() and not exists (
    select 1 from public.company_memberships m where m.company_id = p_company and m.user_id = auth.uid() and m.is_primary and m.status = 'active') then
    raise exception 'نقل الإدارة لمالك المنصة أو المدير الأساسي فقط' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_memberships where company_id = p_company and is_primary) then
    raise exception 'لا يوجد مدير أساسي لنقل الإدارة منه' using errcode = 'P0001';
  end if;
  return public.company_create_invitation(p_company, 'manager_transfer', p_new_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
end $$;

-- يتحقق أن المنفّذ مدير شركة الدعوة (أو مالك المنصة لدعوات المدير)
create or replace function public.company_can_manage_invitation(p_inv public.company_invitations) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_inv.kind in ('manager', 'manager_transfer')
              then public.is_platform_admin()
                   or (p_inv.kind = 'manager_transfer' and exists (select 1 from public.company_memberships m
                         where m.company_id = p_inv.company_id and m.user_id = auth.uid() and m.is_primary and m.status = 'active'))
              else coalesce(public.current_company_role(p_inv.company_id), '') = 'company_manager' end
$$;
revoke all on function public.company_can_manage_invitation(public.company_invitations) from public, anon, authenticated;

create or replace function public.company_revoke_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.company_invitations;
begin
  select * into v from public.company_invitations where id = p_invitation for update;
  if v.id is null or not public.company_can_manage_invitation(v) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v.status <> 'pending' then raise exception 'يمكن إلغاء الدعوات المعلّقة فقط' using errcode = 'P0001'; end if;
  update public.company_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid() where id = p_invitation;
  perform public.company_audit(v.company_id, 'invitation_revoked', 'invitation', v.id, jsonb_build_object('email', v.email));
end $$;

-- إعادة الإرسال = دعوة بديلة برمز جديد (الرمز القديم يتوقف فورًا)
create or replace function public.company_resend_invitation(p_invitation uuid, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.company_invitations;
begin
  select * into v from public.company_invitations where id = p_invitation for update;
  if v.id is null or not public.company_can_manage_invitation(v) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v.status = 'accepted' then raise exception 'الدعوة مقبولة بالفعل' using errcode = 'P0001'; end if;
  return public.company_create_invitation(v.company_id, v.kind, v.email, v.role, v.full_name, v.job_title, v.specialty, v.membership_id, p_expires_hours);
end $$;

-- إدارة الأعضاء: لا تمس المدير الأساسي ولا حساب المنفّذ نفسه
create or replace function public.company_member_guard(p_membership uuid) returns public.company_memberships
language plpgsql stable security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform public.require_company_manager(m.company_id);
  if m.is_primary then raise exception 'المدير الأساسي محمي؛ استخدم إجراء نقل الإدارة' using errcode = '42501'; end if;
  if m.user_id = auth.uid() then raise exception 'لا يمكنك تعديل عضويتك بنفسك' using errcode = '42501'; end if;
  return m;
end $$;
revoke all on function public.company_member_guard(uuid) from public, anon, authenticated;

create or replace function public.company_update_member(p_membership uuid, p_full_name text, p_job_title text, p_specialty text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  perform public.require_company_manager(m.company_id);
  update public.company_memberships set full_name = nullif(btrim(p_full_name), ''), job_title = nullif(btrim(p_job_title), ''),
    specialty = nullif(btrim(p_specialty), '') where id = p_membership;
  perform public.company_audit(m.company_id, 'member_updated', 'membership', m.id, '{}'::jsonb);
end $$;

create or replace function public.company_set_member_role(p_membership uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  m := public.company_member_guard(p_membership);
  if p_role not in ('supervisor', 'technician', 'accountant', 'storekeeper') then
    raise exception 'دور غير مسموح؛ تعيين مدير الشركة يتم بإجراء نقل الإدارة' using errcode = '22023';
  end if;
  update public.company_memberships set role = p_role where id = p_membership;
  perform public.company_audit(m.company_id, 'member_role', 'membership', m.id, jsonb_build_object('from', m.role, 'to', p_role));
end $$;

-- active · suspended · removed (الإزالة لا تحذف الصف؛ تحافظ على السجلات التاريخية)
create or replace function public.company_set_member_status(p_membership uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  m := public.company_member_guard(p_membership);
  if p_status not in ('active', 'suspended', 'removed') then raise exception 'حالة غير صالحة' using errcode = '22023'; end if;
  update public.company_memberships set status = p_status,
    removed_at = case when p_status = 'removed' then now() else null end where id = p_membership;
  perform public.company_audit(m.company_id, 'member_status', 'membership', m.id, jsonb_build_object('from', m.status, 'to', p_status));
end $$;

-- تغيير بريد عضو: دعوة للبريد الجديد؛ عند قبولها تُنقل العضوية للحساب الذي يثبت ملكية البريد الجديد
create or replace function public.company_change_member_email(p_membership uuid, p_new_email text, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships;
begin
  m := public.company_member_guard(p_membership);
  if m.status = 'removed' then raise exception 'العضوية مزالة' using errcode = 'P0001'; end if;
  return public.company_create_invitation(m.company_id, 'email_change', p_new_email, m.role, m.full_name, m.job_title, m.specialty, m.id, p_expires_hours);
end $$;

-- ---------------------------------------------------------------------
-- 8) معاينة الدعوة وقبولها
-- ---------------------------------------------------------------------
create or replace function public.invitation_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.company_invitations; c public.companies; v_email text;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthenticated'); end if;
  select * into v from public.company_invitations where token_hash = public.company_token_hash(coalesce(p_token, ''));
  if v.id is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into c from public.companies where id = v.company_id;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  return jsonb_build_object(
    'status', case when v.status = 'pending' and v.expires_at <= now() then 'expired' else v.status end,
    'kind', v.kind, 'role', v.role, 'company_name', c.name, 'company_status', c.status,
    'email_hint', left(v.email, 2) || '***@' || split_part(v.email, '@', 2),
    'email_matches', v_email is not distinct from v.email, 'expires_at', v.expires_at);
end $$;

create or replace function public.accept_company_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.company_invitations;
  c public.companies;
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_member public.company_memberships;
  v_id uuid;
begin
  if v_uid is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  select * into v from public.company_invitations where token_hash = public.company_token_hash(coalesce(p_token, '')) for update;
  if v.id is null then raise exception 'رابط الدعوة غير صالح' using errcode = 'P0002'; end if;
  if v.status = 'accepted' then raise exception 'استُخدمت هذه الدعوة من قبل' using errcode = 'P0001'; end if;
  if v.status = 'revoked' then raise exception 'أُلغيت هذه الدعوة' using errcode = 'P0001'; end if;
  if v.status = 'expired' or v.expires_at <= now() then
    update public.company_invitations set status = 'expired' where id = v.id and status = 'pending';
    raise exception 'انتهت صلاحية هذه الدعوة؛ اطلب دعوة جديدة' using errcode = 'P0001';
  end if;
  if public.is_platform_admin() then raise exception 'حساب مالك المنصة لا يقبل دعوات الشركات' using errcode = '42501'; end if;

  select lower(email), coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null or v_email <> v.email then
    raise exception 'هذه الدعوة لبريد آخر؛ سجّل الدخول بالبريد المدعو' using errcode = '42501';
  end if;

  select * into c from public.companies where id = v.company_id for update;
  if c.status in ('suspended', 'archived') then raise exception 'الشركة غير متاحة حاليًا' using errcode = 'P0001'; end if;
  if v.kind in ('member', 'email_change') and c.status <> 'active' then raise exception 'الشركة لم تُفعّل بعد' using errcode = 'P0001'; end if;

  select * into v_member from public.company_memberships where company_id = v.company_id and user_id = v_uid for update;

  if v.kind = 'email_change' then
    if v_member.id is not null and v_member.id <> v.membership_id then
      raise exception 'لهذا الحساب عضوية أخرى في الشركة' using errcode = '23505';
    end if;
    update public.company_memberships set user_id = v_uid, email = v_email
     where id = v.membership_id and company_id = v.company_id and status <> 'removed'
     returning id into v_id;
    if v_id is null then raise exception 'العضوية المستهدفة غير متاحة' using errcode = 'P0001'; end if;
    if exists (select 1 from public.company_memberships where id = v_id and is_primary) then
      update public.companies set manager_email = v_email where id = v.company_id;
    end if;

  elsif v.kind = 'member' then
    if v_member.id is not null and v_member.status = 'active' then
      raise exception 'لديك عضوية نشطة في هذه الشركة بالفعل' using errcode = '23505';
    end if;
    insert into public.company_memberships (company_id, user_id, role, status, full_name, email, job_title, specialty, invited_by)
    values (v.company_id, v_uid, v.role, 'active', coalesce(v.full_name, v_name), v_email, v.job_title, v.specialty, v.invited_by)
    on conflict (company_id, user_id) do update set role = excluded.role, status = 'active', removed_at = null,
      full_name = excluded.full_name, email = excluded.email, job_title = excluded.job_title, specialty = excluded.specialty
    returning id into v_id;

  else -- manager / manager_transfer
    if v.kind = 'manager' and exists (select 1 from public.company_memberships where company_id = v.company_id and is_primary) then
      raise exception 'للشركة مدير أساسي بالفعل' using errcode = 'P0001';
    end if;
    if v.kind = 'manager_transfer' then
      -- المدير السابق يبقى عضوًا بدور مشرف (لا يُحذف ولا تضيع سجلاته)
      update public.company_memberships set is_primary = false, role = 'supervisor'
       where company_id = v.company_id and is_primary and user_id <> v_uid;
    end if;
    insert into public.company_memberships (company_id, user_id, role, status, is_primary, full_name, email, job_title, invited_by)
    values (v.company_id, v_uid, 'company_manager', 'active', true, coalesce(v.full_name, v_name), v_email, 'مدير الشركة', v.invited_by)
    on conflict (company_id, user_id) do update set role = 'company_manager', status = 'active', is_primary = true, removed_at = null, email = excluded.email
    returning id into v_id;
    update public.companies set manager_email = v_email,
      status = case when status = 'pending' then 'active' else status end
     where id = v.company_id;
  end if;

  update public.company_invitations set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_accepted', 'membership', v_id,
    jsonb_build_object('kind', v.kind, 'role', v.role, 'email', v_email, 'invitation_id', v.id));
  return jsonb_build_object('company_id', v.company_id, 'membership_id', v_id, 'kind', v.kind);
end $$;

-- ---------------------------------------------------------------------
-- 9) الصلاحيات وسياسات RLS
-- ---------------------------------------------------------------------
-- الدوال العامة: للمستخدمين المسجلين فقط
do $$
declare f text;
begin
  foreach f in array array[
    'public.platform_create_company(text, text, text, text, text, integer)',
    'public.platform_update_company(uuid, text, text, text, text)',
    'public.platform_set_company_status(uuid, text)',
    'public.platform_invite_manager(uuid, text, integer)',
    'public.platform_delete_company(uuid, text)',
    'public.company_invite_member(uuid, text, text, text, text, text, integer)',
    'public.company_transfer_management(uuid, text, integer)',
    'public.company_revoke_invitation(uuid)',
    'public.company_resend_invitation(uuid, integer)',
    'public.company_update_member(uuid, text, text, text)',
    'public.company_set_member_role(uuid, text)',
    'public.company_set_member_status(uuid, text)',
    'public.company_change_member_email(uuid, text, integer)',
    'public.invitation_preview(text)',
    'public.accept_company_invitation(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- كل الكتابة على الشركات والعضويات عبر الدوال أعلاه فقط (تسجيل تدقيق + تحقق موحّد)
revoke insert, update, delete, truncate, references, trigger on public.companies from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.company_memberships from anon, authenticated;
revoke select on public.companies, public.company_memberships from anon;
drop policy if exists companies_insert_platform_admin on public.companies;
drop policy if exists companies_update_platform_admin on public.companies;
drop policy if exists companies_delete_platform_admin on public.companies;
-- سياسات القراءة القائمة (companies_select_authorized, memberships_select_authorized) تبقى كما هي.

alter table public.company_invitations enable row level security;
alter table public.company_audit_log enable row level security;
revoke all on public.company_invitations, public.company_audit_log from anon, authenticated;
-- بصمة الرمز لا تُقرأ من الواجهة إطلاقًا
grant select (id, company_id, kind, email, role, full_name, job_title, specialty, membership_id, status, expires_at,
              invited_by, created_at, accepted_at, accepted_by, revoked_at, replaced_by)
  on public.company_invitations to authenticated;
grant select on public.company_audit_log to authenticated;

drop policy if exists company_invitations_select on public.company_invitations;
create policy company_invitations_select on public.company_invitations for select to authenticated
  using ((select public.is_platform_admin()) or (select public.current_company_role(company_id)) = 'company_manager');

drop policy if exists company_audit_log_select on public.company_audit_log;
create policy company_audit_log_select on public.company_audit_log for select to authenticated
  using ((select public.is_platform_admin()) or (select public.current_company_role(company_id)) = 'company_manager');

notify pgrst, 'reload schema';
