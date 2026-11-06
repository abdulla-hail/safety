-- محاكاة بيئة Supabase للاختبار المحلي فقط (PGlite). لا تُطبَّق على قاعدة الإنتاج.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

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
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;

-- الجداول القائمة في المشروع قبل الترحيلات (حسب الفحص)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commercial_registration text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz
);
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  status text not null default 'pending',
  role text not null default 'member',
  created_at timestamptz not null default now()
);
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  email text, phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  is_active boolean not null default true,
  commercial_registration text, city text, notes text
);
create table if not exists public.technicians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
