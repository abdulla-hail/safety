-- تراجع 20261109000100_company_purge: يعيد دوال المشغلات الثلاث كما هي في القاعدة الحية (pg_get_functiondef، قراءة 2026-10-28)
-- ويحذف دوال وسياسات الحذف الكامل. لا يعيد أي شركة حُذفت بعد التطبيق (لقطاتها باقية في platform_audit_log).

CREATE OR REPLACE FUNCTION app_private.block_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'هذا السجل تاريخي ولا يمكن تعديله أو حذفه' using errcode = '42501'; end $function$;

CREATE OR REPLACE FUNCTION app_private.audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text; v_changes jsonb := '{}'::jsonb; k text;
begin
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.audit_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  perform public.company_audit((v ->> 'company_id')::uuid, case when tg_op = 'INSERT' then 'assign' else 'unassign' end,
    tg_argv[0], null, v - array['created_at']);
  return null;
end $function$;

drop policy if exists ays_purged_company_files_read on storage.objects;
drop policy if exists ays_purged_company_files_delete on storage.objects;
drop function if exists public.platform_orphan_company_files(integer);
drop function if exists public.platform_purge_company(uuid, text, boolean);
drop function if exists public.platform_company_purge_preview(uuid);
drop function if exists app_private.storage_company_gone(text);
drop function if exists app_private.company_purge_users(uuid);
drop function if exists app_private.user_has_legacy_rows(uuid);
drop function if exists app_private.company_purge_tables();

notify pgrst, 'reload schema';
