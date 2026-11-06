-- =====================================================================
-- عين السلامة — صفحة الدعوة بهوية الشركة، شعار المنصة، دعوات مساعد المالك (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) invitation_landing(token): للزائر قبل الدخول وبعده. بلا رمز صالح لا يُكشف شيء؛ برمز صالح:
--    اسم الشركة وألوانها وشعارها، وتفاصيل الدعوة المعلّقة (الدور، المسمى، التخصصات، الصلاحيات الفعلية للدعوة).
--    لا يُكشف أي عضو أو بيانات تشغيلية. الشعار يُقرأ فقط إن كان شعار شركة لديها دعوة معلّقة سارية.
-- 2) شعار المنصة: إعداد مفرد platform_settings + حاوية عامة platform-branding؛ التغيير بصلاحية منصة
--    مستقلة platform.branding (المالك يملكها؛ لا يملكها المساعد إلا بمنح صريح؛ مديرو الشركات لا يملكونها).
-- 3) دعوات مساعد المالك من المالك فقط (بريد + صلاحيات محددة سلفًا)، ورابط آمن يُستخدم مرة واحدة بالبريد نفسه.
--    يُغلق مسار «طلب الانضمام» (تُسحب صلاحية تنفيذ دالته) مع الإبقاء على جدوله وسجلاته كما هي.
-- 4) سجل تدقيق للمنصة (الدعوات، القبول، تغييرات المساعدين، الشعار).
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول/دوال safety_*.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) سجل تدقيق المنصة
-- ---------------------------------------------------------------------
create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_log_created_idx on public.platform_audit_log (created_at desc);

create or replace function app_private.platform_audit(p_action text, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.platform_audit_log (actor_id, actor_email, action, details)
  values (auth.uid(), (select lower(email) from auth.users where id = auth.uid()), p_action, coalesce(p_details, '{}'::jsonb));
end $$;

-- كل تغيير على المساعدين (إنشاء، صلاحيات، تعطيل، إلغاء) يُسجَّل دون تعديل دوال الترحيل السابق
create or replace function app_private.audit_platform_assistant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.platform_audit(case when tg_op = 'INSERT' then 'assistant_granted' else 'assistant_updated' end,
    jsonb_build_object('user_id', new.user_id, 'email', new.email, 'status', new.status, 'permissions', to_jsonb(new.permissions),
      'previous', case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status, 'permissions', to_jsonb(old.permissions)) end));
  return null;
end $$;
drop trigger if exists trg_platform_assistants_audit on public.platform_assistants;
create trigger trg_platform_assistants_audit after insert or update on public.platform_assistants
  for each row execute function app_private.audit_platform_assistant();

-- ---------------------------------------------------------------------
-- 1) صفحة الدعوة بهوية الشركة
-- ---------------------------------------------------------------------
create or replace function public.invitation_landing(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.company_invitations; c public.companies; v_email text; v_status text;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{20,100}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into v from public.company_invitations where token_hash = public.company_token_hash(p_token);
  if v.id is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into c from public.companies where id = v.company_id;
  v_status := case when v.status = 'pending' and v.expires_at <= now() then 'expired' else v.status end;
  -- دعوة غير صالحة للاستخدام: الهوية فقط لعرض رسالة واضحة بها، دون أي تفاصيل
  if v_status <> 'pending' then
    return jsonb_build_object('status', v_status, 'company_name', c.name, 'primary_color', c.primary_color, 'secondary_color', c.secondary_color);
  end if;
  if auth.uid() is not null then
    select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  end if;
  return jsonb_build_object(
    'status', 'pending', 'kind', v.kind, 'role', v.role, 'full_name', v.full_name, 'job_title', v.job_title, 'specialty', v.specialty,
    'permissions', to_jsonb(public.company_effective_permissions(v.role, v.permissions)), 'custom_permissions', v.permissions is not null,
    'company_name', c.name, 'company_status', c.status, 'primary_color', c.primary_color, 'secondary_color', c.secondary_color,
    'header_text', c.header_text, 'logo_path', c.logo_path,
    'email_hint', left(v.email, 2) || '***@' || split_part(v.email, '@', 2),
    'signed_in', auth.uid() is not null, 'email_matches', case when auth.uid() is null then null else v_email is not distinct from v.email end,
    'expires_at', v.expires_at);
end $$;

-- الشعار الحالي لشركة لديها دعوة معلّقة سارية فقط (تستخدمه سياسة القراءة أدناه)
create or replace function public.storage_invite_logo_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.companies c
    where c.id = app_private.storage_company(p_name) and c.logo_path = p_name
      and exists (select 1 from public.company_invitations i where i.company_id = c.id and i.status = 'pending' and i.expires_at > now()))
$$;
drop policy if exists ays_branding_invite_read on storage.objects;
create policy ays_branding_invite_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'org-branding' and public.storage_invite_logo_allowed(name));

-- ---------------------------------------------------------------------
-- 2) شعار المنصة
-- ---------------------------------------------------------------------
insert into public.platform_permission_definitions (key, label_ar, sort_order)
values ('platform.branding', 'تغيير شعار المنصة', 7)
on conflict (key) do update set label_ar = excluded.label_ar, sort_order = excluded.sort_order;

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  logo_path text check (logo_path is null or logo_path ~ '^logo/[A-Za-z0-9._-]{1,120}$'),
  logo_updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- قراءة عامة لمسار الشعار فقط (صفحة الدخول قبل تسجيله)، دون منح anon أي صلاحية على الجدول
create or replace function public.platform_public_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('logo_path', s.logo_path, 'logo_updated_at', s.logo_updated_at) from public.platform_settings s where s.id
$$;

create or replace function public.platform_set_logo(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform public.require_platform_perm('platform.branding');
  if p_path is not null then
    if p_path !~ '^logo/[A-Za-z0-9._-]{1,120}$' then raise exception 'مسار الشعار غير صالح' using errcode = '22023'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'platform-branding' and name = p_path) then
      raise exception 'ملف الشعار غير موجود في التخزين' using errcode = 'P0002';
    end if;
  end if;
  select logo_path into v_old from public.platform_settings where id for update;
  update public.platform_settings set logo_path = p_path, logo_updated_at = now(), updated_by = auth.uid() where id;
  perform app_private.platform_audit('platform_logo_updated', jsonb_build_object('from', v_old, 'to', p_path));
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('platform-branding', 'platform-branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists ays_platform_branding_write on storage.objects;
create policy ays_platform_branding_write on storage.objects for insert to authenticated
  with check (bucket_id = 'platform-branding' and name ~ '^logo/' and public.platform_has_perm('platform.branding'));
drop policy if exists ays_platform_branding_delete on storage.objects;
create policy ays_platform_branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'platform-branding' and public.platform_has_perm('platform.branding'));

-- ---------------------------------------------------------------------
-- 3) دعوات مساعد المالك
-- ---------------------------------------------------------------------
create table if not exists public.platform_assistant_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  permissions text[] not null check (cardinality(permissions) > 0),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  email_sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  replaced_by uuid references public.platform_assistant_invitations(id) on delete set null
);
create index if not exists platform_assistant_invitations_email_idx on public.platform_assistant_invitations (email, status);

create or replace function public.platform_invite_assistant(p_email text, p_full_name text, p_permissions text[], p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_perms text[];
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_expires_hours, 72), 1), 720));
  v_replaced uuid[];
begin
  -- المالك الأساسي وحده؛ المساعد لا يدعو مساعدين ولا يمنح صلاحيات
  perform public.require_platform_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الإلكتروني غير صالح' using errcode = '22023'; end if;
  v_perms := app_private.valid_platform_permissions(p_permissions);
  if cardinality(v_perms) = 0 then raise exception 'حدد صلاحية واحدة على الأقل للمساعد' using errcode = '22023'; end if;
  if exists (select 1 from auth.users u join public.platform_admins p on p.user_id = u.id where lower(u.email) = v_email) then
    raise exception 'هذا البريد لمالك المنصة' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_assistants where lower(email) = v_email and status = 'active') then
    raise exception 'صاحب هذا البريد مساعد نشط بالفعل؛ عدّل صلاحياته من قائمة المساعدين' using errcode = '23505';
  end if;
  v_token := translate(encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_');
  with old as (
    update public.platform_assistant_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
     where email = v_email and status = 'pending' returning id)
  select array_agg(id) into v_replaced from old;
  insert into public.platform_assistant_invitations (email, full_name, permissions, token_hash, expires_at, invited_by)
  values (v_email, nullif(btrim(p_full_name), ''), v_perms, public.company_token_hash(v_token), v_expires, auth.uid())
  returning id into v_id;
  if v_replaced is not null then update public.platform_assistant_invitations set replaced_by = v_id where id = any (v_replaced); end if;
  perform app_private.platform_audit('assistant_invited', jsonb_build_object('invitation_id', v_id, 'email', v_email, 'permissions', to_jsonb(v_perms), 'expires_at', v_expires));
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'expires_at', v_expires, 'email', v_email);
end $$;

create or replace function public.platform_resend_assistant_invitation(p_invitation uuid, p_expires_hours integer default 72)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.platform_assistant_invitations;
begin
  perform public.require_platform_admin();
  select * into v from public.platform_assistant_invitations where id = p_invitation;
  if v.id is null then raise exception 'الدعوة غير موجودة' using errcode = 'P0002'; end if;
  if v.status = 'accepted' then raise exception 'الدعوة مقبولة بالفعل' using errcode = 'P0001'; end if;
  return public.platform_invite_assistant(v.email, v.full_name, v.permissions, p_expires_hours);
end $$;

create or replace function public.platform_revoke_assistant_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.platform_assistant_invitations;
begin
  perform public.require_platform_admin();
  select * into v from public.platform_assistant_invitations where id = p_invitation for update;
  if v.id is null then raise exception 'الدعوة غير موجودة' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'يمكن إلغاء الدعوات المعلّقة فقط' using errcode = 'P0001'; end if;
  update public.platform_assistant_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid() where id = v.id;
  perform app_private.platform_audit('assistant_invitation_revoked', jsonb_build_object('invitation_id', v.id, 'email', v.email));
end $$;

-- يُستدعى فقط بعد نجاح إرسال البريد فعليًا (لا يُسجَّل إرسال لم يتم)
create or replace function public.platform_mark_assistant_invitation_emailed(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_platform_admin();
  update public.platform_assistant_invitations set email_sent_at = now() where id = p_invitation and status = 'pending';
  perform app_private.platform_audit('assistant_invitation_emailed', jsonb_build_object('invitation_id', p_invitation));
end $$;

create or replace function public.assistant_invitation_landing(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.platform_assistant_invitations; v_email text; v_status text;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{20,100}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into v from public.platform_assistant_invitations where token_hash = public.company_token_hash(p_token);
  if v.id is null then return jsonb_build_object('status', 'invalid'); end if;
  v_status := case when v.status = 'pending' and v.expires_at <= now() then 'expired' else v.status end;
  if v_status <> 'pending' then return jsonb_build_object('status', v_status); end if;
  if auth.uid() is not null then
    select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  end if;
  return jsonb_build_object('status', 'pending', 'full_name', v.full_name, 'permissions', to_jsonb(v.permissions),
    'email_hint', left(v.email, 2) || '***@' || split_part(v.email, '@', 2), 'expires_at', v.expires_at,
    'signed_in', auth.uid() is not null, 'email_matches', case when auth.uid() is null then null else v_email is not distinct from v.email end);
end $$;

create or replace function public.accept_platform_assistant_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.platform_assistant_invitations; v_uid uuid := auth.uid(); v_email text; v_name text;
begin
  if v_uid is null then raise exception 'سجّل الدخول أولًا' using errcode = '42501'; end if;
  select * into v from public.platform_assistant_invitations where token_hash = public.company_token_hash(coalesce(p_token, '')) for update;
  if v.id is null then raise exception 'رابط الدعوة غير صالح' using errcode = 'P0002'; end if;
  if v.status = 'accepted' then raise exception 'استُخدمت هذه الدعوة من قبل' using errcode = 'P0001'; end if;
  if v.status = 'revoked' then raise exception 'أُلغيت هذه الدعوة' using errcode = 'P0001'; end if;
  if v.status = 'expired' or v.expires_at <= now() then
    update public.platform_assistant_invitations set status = 'expired' where id = v.id and status = 'pending';
    raise exception 'انتهت صلاحية هذه الدعوة؛ اطلب دعوة جديدة من مالك المنصة' using errcode = 'P0001';
  end if;
  if public.is_platform_admin() then raise exception 'أنت مالك المنصة' using errcode = '42501'; end if;
  select lower(email), coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
    into v_email, v_name from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null or v_email <> v.email then
    raise exception 'هذه الدعوة لبريد آخر؛ سجّل الدخول بالبريد المدعو' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_memberships where user_id = v_uid and status = 'active') then
    raise exception 'حسابك عضو في شركة؛ مساعد المالك يجب أن يكون حسابًا منفصلًا عن الشركات' using errcode = 'P0001';
  end if;
  insert into public.platform_assistants (user_id, email, full_name, permissions, status, granted_by, granted_at, updated_by, updated_at)
  values (v_uid, v_email, coalesce(v.full_name, v_name), v.permissions, 'active', v.invited_by, now(), v.invited_by, now())
  on conflict (user_id) do update set permissions = excluded.permissions, status = 'active', email = excluded.email,
    full_name = coalesce(excluded.full_name, public.platform_assistants.full_name), updated_by = excluded.updated_by, updated_at = now();
  update public.platform_assistant_invitations set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = v.id;
  perform app_private.platform_audit('assistant_invitation_accepted', jsonb_build_object('invitation_id', v.id, 'email', v_email, 'permissions', to_jsonb(v.permissions)));
  return jsonb_build_object('status', 'accepted', 'permissions', to_jsonb(v.permissions));
end $$;

-- مسار «طلب الانضمام» أُلغي: تبقى الدالة والجدول وسجلاته، وتُسحب صلاحية التنفيذ فقط
revoke execute on function public.platform_request_assistant(text, text) from authenticated;

-- ---------------------------------------------------------------------
-- 4) السياق: شعار المنصة (للقائمة دون طلب إضافي)
-- ---------------------------------------------------------------------
create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'platform_role', case when public.is_platform_admin() then 'owner'
                          when cardinality(public.platform_assistant_permissions()) > 0 then 'assistant' end,
    'platform_permissions', case when public.is_platform_admin() then to_jsonb(array(select key from public.platform_permission_definitions order by sort_order))
                                 else to_jsonb(public.platform_assistant_permissions()) end,
    'platform_logo', (select jsonb_build_object('path', s.logo_path, 'updated_at', s.logo_updated_at) from public.platform_settings s where s.id),
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
-- 5) RLS والصلاحيات
-- ---------------------------------------------------------------------
alter table public.platform_audit_log enable row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_assistant_invitations enable row level security;
revoke all on public.platform_audit_log, public.platform_settings, public.platform_assistant_invitations from anon, authenticated;
grant select on public.platform_audit_log, public.platform_settings, public.platform_assistant_invitations to authenticated;
drop policy if exists pal_select on public.platform_audit_log;
create policy pal_select on public.platform_audit_log for select to authenticated using ((select public.is_platform_admin()));
drop policy if exists ps_select on public.platform_settings;
create policy ps_select on public.platform_settings for select to authenticated using (true);
drop policy if exists pai_select on public.platform_assistant_invitations;
create policy pai_select on public.platform_assistant_invitations for select to authenticated using ((select public.is_platform_admin()));

revoke all on function app_private.platform_audit(text, jsonb), app_private.audit_platform_assistant() from public, anon, authenticated;
revoke all on function public.invitation_landing(text), public.storage_invite_logo_allowed(text), public.platform_public_settings(),
  public.assistant_invitation_landing(text) from public;
grant execute on function public.invitation_landing(text), public.storage_invite_logo_allowed(text), public.platform_public_settings(),
  public.assistant_invitation_landing(text) to anon, authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'public.platform_set_logo(text)', 'public.platform_invite_assistant(text, text, text[], integer)',
    'public.platform_resend_assistant_invitation(uuid, integer)', 'public.platform_revoke_assistant_invitation(uuid)',
    'public.platform_mark_assistant_invitation_emailed(uuid)', 'public.accept_platform_assistant_invitation(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
