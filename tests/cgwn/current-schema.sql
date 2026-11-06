-- نسخة محلية مطابقة للبنية الحالية في مشروع Supabase cgwnusudjhhxkwnqjzfr (الشركات والعضويات والمالك)،
-- مأخوذة من فحص قراءة فقط. للاختبار المحلي على PGlite فقط — لا تُطبَّق على أي قاعدة.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;

create table public.companies (
  id uuid not null default gen_random_uuid() primary key,
  name text not null constraint companies_name_check check (length(trim(both from name)) > 0),
  status text not null default 'waiting_list' constraint companies_status_check check (status = any (array['active', 'waiting_list', 'closed'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_memberships (
  id uuid not null default gen_random_uuid() primary key,
  company_id uuid not null constraint company_memberships_company_id_fkey references public.companies(id) on delete cascade,
  user_id uuid not null constraint company_memberships_user_id_fkey references auth.users(id) on delete cascade,
  role text not null constraint company_memberships_role_check check (role = any (array['company_manager', 'supervisor', 'technician', 'accountant'])),
  status text not null default 'active' constraint company_memberships_status_check check (status = any (array['active', 'suspended'])),
  created_at timestamptz not null default now(),
  constraint company_memberships_company_id_user_id_key unique (company_id, user_id)
);

create table public.platform_admins (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()));
$$;

create or replace function public.is_active_company_member(target_company_id uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.company_memberships cm
    where cm.company_id = target_company_id and cm.user_id = (select auth.uid()) and cm.status = 'active'
  );
$$;

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.platform_admins enable row level security;

create policy companies_delete_platform_admin on public.companies for delete to authenticated using ((select public.is_platform_admin()));
create policy companies_insert_platform_admin on public.companies for insert to authenticated with check ((select public.is_platform_admin()));
create policy companies_select_authorized on public.companies for select to authenticated
  using (((select public.is_platform_admin()) or (select public.is_active_company_member(companies.id))));
create policy companies_update_platform_admin on public.companies for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy memberships_select_authorized on public.company_memberships for select to authenticated
  using (((select public.is_platform_admin()) or (select public.is_active_company_member(company_memberships.company_id))));

-- الصلاحيات كما هي في المشروع الحالي
grant all on public.companies, public.company_memberships to anon, authenticated;
revoke all on public.platform_admins from anon, authenticated;
revoke execute on function public.is_platform_admin(), public.is_active_company_member(uuid) from public, anon;
grant execute on function public.is_platform_admin(), public.is_active_company_member(uuid) to authenticated;
