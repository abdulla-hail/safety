-- =====================================================================
-- التراجع عن 20261030000100_platform_assistants.sql (مولَّد من تعريفات cgwn قبل الترحيل)
-- يرفض التنفيذ كليًا إذا وُجدت طلبات أو مساعدون (بيانات أُنشئت بعد الترحيل).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_assistant_requests) or exists (select 1 from public.platform_assistants) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد طلبات أو مساعدون أُنشئوا بعد الترحيل';
  end if;
end $$;

drop policy if exists companies_select_platform_assistant on public.companies;
drop policy if exists memberships_select_platform_assistant on public.company_memberships;
drop policy if exists company_invitations_select_platform_assistant on public.company_invitations;
drop policy if exists company_audit_log_select_platform_assistant on public.company_audit_log;
drop trigger if exists trg_memberships_block_assistant on public.company_memberships;

-- الدوال المعدّلة كما كانت تمامًا
CREATE OR REPLACE FUNCTION public.company_can_manage_invitation(p_inv company_invitations)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_inv.kind in ('manager', 'manager_transfer')
              then public.is_platform_admin()
                   or (p_inv.kind = 'manager_transfer' and exists (select 1 from public.company_memberships m
                         where m.company_id = p_inv.company_id and m.user_id = auth.uid() and m.is_primary and m.status = 'active'))
              else coalesce(public.current_company_role(p_inv.company_id), '') = 'company_manager' end
$function$;

CREATE OR REPLACE FUNCTION public.company_transfer_management(p_company uuid, p_new_email text, p_expires_hours integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() and not exists (
    select 1 from public.company_memberships m where m.company_id = p_company and m.user_id = auth.uid() and m.is_primary and m.status = 'active') then
    raise exception 'نقل الإدارة لمالك المنصة أو المدير الأساسي فقط' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_memberships where company_id = p_company and is_primary) then
    raise exception 'لا يوجد مدير أساسي لنقل الإدارة منه' using errcode = 'P0001';
  end if;
  return public.company_create_invitation(p_company, 'manager_transfer', p_new_email, 'company_manager', null, 'مدير الشركة', null, null, p_expires_hours);
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
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
$function$;

CREATE OR REPLACE FUNCTION public.platform_create_company(p_name text, p_manager_email text, p_commercial_registration text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_expires_hours integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_delete_company(p_company uuid, p_confirm_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_invite_manager(p_company uuid, p_email text, p_expires_hours integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_set_company_status(p_company uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.platform_update_company(p_company uuid, p_name text, p_commercial_registration text, p_phone text, p_city text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

drop function if exists public.platform_update_assistant(uuid, text[], text);
drop function if exists public.platform_review_assistant_request(uuid, boolean, text[], text);
drop function if exists public.platform_cancel_assistant_request(uuid);
drop function if exists public.platform_request_assistant(text, text);
drop function if exists app_private.block_assistant_membership();
drop function if exists app_private.valid_platform_permissions(text[]);
drop function if exists app_private.is_platform_staff_email(text);
drop function if exists public.require_platform_perm(text);
drop function if exists public.platform_has_perm(text);
drop function if exists public.platform_assistant_permissions();
drop table if exists public.platform_assistants;
drop table if exists public.platform_assistant_requests;
drop table if exists public.platform_permission_definitions;

notify pgrst, 'reload schema';
