-- =====================================================================
-- التراجع عن 20261031000100_invite_branding_platform_logo_assistant_invites.sql (مولَّد من تعريف cgwn قبل الترحيل)
-- يرفض التنفيذ إذا وُجدت دعوات مساعدين أو سجل تدقيق منصة أو شعار منصة محفوظ أو ملفات في حاوية شعار المنصة.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.platform_assistant_invitations) or exists (select 1 from public.platform_audit_log)
     or exists (select 1 from public.platform_settings where logo_path is not null)
     or exists (select 1 from storage.objects where bucket_id = 'platform-branding')
     or exists (select 1 from public.platform_assistants where 'platform.branding' = any (permissions)) then
    raise exception 'التراجع مرفوض لمنع فقد البيانات: توجد بيانات أُنشئت بعد الترحيل';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.get_my_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

grant execute on function public.platform_request_assistant(text, text) to authenticated;
drop function if exists public.accept_platform_assistant_invitation(text);
drop function if exists public.assistant_invitation_landing(text);
drop function if exists public.platform_mark_assistant_invitation_emailed(uuid);
drop function if exists public.platform_revoke_assistant_invitation(uuid);
drop function if exists public.platform_resend_assistant_invitation(uuid, integer);
drop function if exists public.platform_invite_assistant(text, text, text[], integer);
drop table if exists public.platform_assistant_invitations;

drop policy if exists ays_platform_branding_write on storage.objects;
drop policy if exists ays_platform_branding_delete on storage.objects;
-- حاوية platform-branding تبقى فارغة: Supabase يمنع حذف الحاويات بـ SQL
drop function if exists public.platform_set_logo(text);
drop function if exists public.platform_public_settings();
drop table if exists public.platform_settings;
delete from public.platform_permission_definitions where key = 'platform.branding';

drop policy if exists ays_branding_invite_read on storage.objects;
drop function if exists public.storage_invite_logo_allowed(text);
drop function if exists public.invitation_landing(text);

drop trigger if exists trg_platform_assistants_audit on public.platform_assistants;
drop function if exists app_private.audit_platform_assistant();
drop function if exists app_private.platform_audit(text, jsonb);
drop table if exists public.platform_audit_log;

notify pgrst, 'reload schema';
