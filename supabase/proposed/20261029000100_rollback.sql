-- =====================================================================
-- التراجع عن 20261029000100_device_images_technician_members.sql
-- يرفض التنفيذ كليًا إذا وُجدت بيانات أُنشئت بعد الترحيل: صور أجهزة (في السجلات أو التخزين)،
-- صلاحيات مخصصة في دعوات، أو سجلات فنيين أنشأها الربط التلقائي (created_by فارغ ومرتبطة بحساب).
-- بعد بدء الاستخدام يُعالج أي خلل بترحيل تصحيحي، لا بهذا الملف.
-- =====================================================================
do $$
declare v_found text[] := '{}';
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'devices' and column_name = 'image_path')
     and exists (select 1 from public.devices where image_path is not null) then
    v_found := array_append(v_found, 'devices.image_path'::text);
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'org-files' and split_part(name, '/', 2) = 'device-image') then
    v_found := array_append(v_found, 'storage.device-image'::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'permissions')
     and exists (select 1 from public.company_invitations where permissions is not null) then
    v_found := array_append(v_found, 'company_invitations.permissions'::text);
  end if;
  if exists (select 1 from public.technicians where created_by is null and user_id is not null) then
    v_found := array_append(v_found, 'technicians (ربط تلقائي)'::text);
  end if;
  if cardinality(v_found) > 0 then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل في %', array_to_string(v_found, '، ');
  end if;
end $$;

drop trigger if exists trg_invitations_permissions on public.company_invitations;
drop function if exists app_private.invitation_permissions_flow();
drop function if exists public.company_set_invitation_permissions(uuid, text[]);
alter table public.company_invitations drop column if exists permissions;

drop trigger if exists trg_memberships_link_technician on public.company_memberships;
drop function if exists public.company_link_technician_member(uuid);
drop function if exists app_private.link_technician_member();
drop function if exists app_private.ensure_technician(uuid);
drop function if exists app_private.technician_specialties(text);

drop policy if exists ays_device_images_read on storage.objects;
drop policy if exists ays_device_images_delete on storage.objects;
drop trigger if exists trg_devices_image_check on public.devices;
drop function if exists app_private.devices_image_check();
alter table public.devices drop column if exists image_path;

notify pgrst, 'reload schema';
