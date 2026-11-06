-- =====================================================================
-- عين السلامة — صور الأجهزة + ربط الفني بعضويته + صلاحيات مخصصة في الدعوة (مشروع cgwnusudjhhxkwnqjzfr)
--
-- 1) devices.image_path: صورة اختيارية للجهاز في الحاوية الخاصة org-files بالمسار
--    {company_id}/device-image/{device_id}/{file}. لا Base64 في السجل. سياسات قراءة/حذف خاصة بهذا المسار.
-- 2) الفني عضو في الشركة: عند تفعيل عضوية بدور فني يُنشأ له سجل فني تشغيلي مرتبط بـ user_id
--    (أو يُربط سجل قائم بالبريد نفسه دون ربط) فلا يتكرر الشخص. التعطيل/الإزالة يوقف السجل دون حذفه،
--    وتغيير بريد العضوية ينقل الربط للحساب الجديد. دالة للمدير لربط عضو فني قائم.
-- 3) company_invitations.permissions: صلاحيات مخصصة تُحدد عند الدعوة وتُطبق على العضوية عند القبول،
--    وتنتقل إلى الدعوة البديلة عند إعادة الإرسال.
--
-- لا يحذف ولا يعدّل أي صف قائم. لا يمس جداول safety_* ولا دوالها.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) صورة الجهاز
-- ---------------------------------------------------------------------
alter table public.devices add column if not exists image_path text;

create or replace function app_private.devices_image_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.image_path is not null
     and new.image_path !~ ('^' || new.company_id::text || '/device-image/' || new.id::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'مسار صورة الجهاز غير صالح' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_devices_image_check on public.devices;
create trigger trg_devices_image_check before insert or update of image_path on public.devices
  for each row execute function app_private.devices_image_check();

-- القراءة: من يرى الجهاز (RLS على devices داخل الشرط)، أو من يملك تسجيل/تعديل الأجهزة في الشركة نفسها
drop policy if exists ays_device_images_read on storage.objects;
create policy ays_device_images_read on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and split_part(name, '/', 2) = 'device-image'
    and (exists (select 1 from public.devices d where d.image_path = storage.objects.name)
         or public.company_has_any_perm(app_private.storage_company(name), array['devices.update', 'devices.create'])));
-- الحذف (استبدال الصورة أو إزالتها): لمن يملك تعديل/تسجيل الأجهزة في الشركة نفسها فقط
drop policy if exists ays_device_images_delete on storage.objects;
create policy ays_device_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-files' and split_part(name, '/', 2) = 'device-image'
    and public.company_has_any_perm(app_private.storage_company(name), array['devices.update', 'devices.create']));
-- الرفع إلى org-files مغطى بالسياسة القائمة ays_files_write (devices.update / devices.create لمسار الشركة)

-- ---------------------------------------------------------------------
-- 2) سجل الفني التشغيلي مرتبط بعضويته
-- ---------------------------------------------------------------------
create or replace function app_private.technician_specialties(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct k order by k), '{}') from (
    select btrim(x) k from unnest(string_to_array(coalesce(p_text, ''), ',')) x) s
  where k in ('alarm', 'extinguishers', 'sprinklers', 'pumps', 'emergency_lighting', 'gas_suppression', 'hose_reels')
$$;

-- يضمن سجل فني واحد للعضو الفني النشط ويعيد معرّفه
create or replace function app_private.ensure_technician(p_membership uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships; v_id uuid;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null or m.status <> 'active' then return null; end if;
  select id into v_id from public.technicians where company_id = m.company_id and user_id = m.user_id;
  if v_id is not null then
    update public.technicians set is_active = true where id = v_id and not is_active and archived_at is null;
    return v_id;
  end if;
  -- سجل قائم أضافه المدير يدويًا بالبريد نفسه دون ربط: يُربط بدل إنشاء سجل مكرر
  select id into v_id from public.technicians
   where company_id = m.company_id and user_id is null and archived_at is null and lower(email) = lower(m.email)
   order by created_at limit 1;
  if v_id is not null then
    update public.technicians set user_id = m.user_id, is_active = true where id = v_id;
    return v_id;
  end if;
  insert into public.technicians (company_id, full_name, email, job_title, specialties, user_id)
  values (m.company_id,
          coalesce(nullif(btrim(m.full_name), ''), split_part(coalesce(m.email, 'فني'), '@', 1), 'فني'),
          lower(m.email), m.job_title, app_private.technician_specialties(m.specialty), m.user_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app_private.link_technician_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    update public.technicians set user_id = new.user_id where company_id = new.company_id and user_id = old.user_id;
  end if;
  if new.role = 'technician' and new.status = 'active' then
    perform app_private.ensure_technician(new.id);
  elsif tg_op = 'UPDATE' and new.status in ('suspended', 'removed') and old.status = 'active' then
    -- لا حذف: يتوقف السجل التشغيلي وتبقى سجلات الصيانة والإسنادات التاريخية
    update public.technicians set is_active = false where company_id = new.company_id and user_id = new.user_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_memberships_link_technician on public.company_memberships;
create trigger trg_memberships_link_technician after insert or update of role, status, user_id on public.company_memberships
  for each row execute function app_private.link_technician_member();

-- للمدير (أو من يملك إضافة الفنيين): ربط عضو فني قائم قبل هذا الترحيل بسجل فني
create or replace function public.company_link_technician_member(p_membership uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.company_memberships; v_id uuid;
begin
  select * into m from public.company_memberships where id = p_membership;
  if m.id is null then raise exception 'العضوية غير موجودة' using errcode = 'P0002'; end if;
  if not public.company_has_perm(m.company_id, 'technicians.create') then
    raise exception 'ليست لديك صلاحية إضافة الفنيين' using errcode = '42501';
  end if;
  if m.role <> 'technician' or m.status <> 'active' then
    raise exception 'الربط للأعضاء النشطين بدور فني فقط' using errcode = 'P0001';
  end if;
  v_id := app_private.ensure_technician(m.id);
  perform public.company_audit(m.company_id, 'technician_linked', 'technician', v_id, jsonb_build_object('membership_id', m.id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3) صلاحيات مخصصة في الدعوة
-- ---------------------------------------------------------------------
alter table public.company_invitations add column if not exists permissions text[];

create or replace function public.company_set_invitation_permissions(p_invitation uuid, p_permissions text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.company_invitations;
begin
  select * into v from public.company_invitations where id = p_invitation for update;
  if v.id is null then raise exception 'الدعوة غير موجودة' using errcode = 'P0002'; end if;
  if coalesce(public.current_company_role(v.company_id), '') <> 'company_manager' then
    raise exception 'هذه العملية لمدير الشركة فقط' using errcode = '42501';
  end if;
  if v.kind <> 'member' or v.status <> 'pending' then raise exception 'يمكن تخصيص صلاحيات دعوة عضو معلّقة فقط' using errcode = 'P0001'; end if;
  if p_permissions is not null and exists (select 1 from unnest(p_permissions) k
       where not exists (select 1 from public.permission_definitions d where d.key = k)) then
    raise exception 'صلاحية غير معروفة' using errcode = '22023';
  end if;
  update public.company_invitations
     set permissions = case when p_permissions is null then null else array(select distinct k from unnest(p_permissions) k order by k) end
   where id = v.id;
  perform public.company_audit(v.company_id, 'invitation_permissions', 'invitation', v.id,
    jsonb_build_object('permissions', to_jsonb(p_permissions)));
end $$;

create or replace function app_private.invitation_permissions_flow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- القبول: تُطبق الصلاحيات المخصصة على العضوية الناتجة
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.kind = 'member' and new.permissions is not null then
    update public.company_memberships set permissions = new.permissions
     where company_id = new.company_id and user_id = new.accepted_by and role <> 'company_manager';
  end if;
  -- إعادة الإرسال: الدعوة البديلة ترث الصلاحيات
  if new.replaced_by is not null and old.replaced_by is null and new.permissions is not null then
    update public.company_invitations set permissions = new.permissions where id = new.replaced_by and permissions is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_invitations_permissions on public.company_invitations;
create trigger trg_invitations_permissions after update of status, replaced_by on public.company_invitations
  for each row execute function app_private.invitation_permissions_flow();

-- ---------------------------------------------------------------------
-- 4) الصلاحيات على الدوال
-- ---------------------------------------------------------------------
revoke all on function app_private.devices_image_check(), app_private.technician_specialties(text), app_private.ensure_technician(uuid),
  app_private.link_technician_member(), app_private.invitation_permissions_flow() from public, anon, authenticated;
revoke all on function public.company_link_technician_member(uuid), public.company_set_invitation_permissions(uuid, text[]) from public, anon;
grant execute on function public.company_link_technician_member(uuid), public.company_set_invitation_permissions(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
