-- Local-only stand-ins for the Supabase-managed objects our migrations depend
-- on (auth schema, storage schema, the JWT helper, and the platform roles).
-- This file is NEVER applied to a real project - it exists so `npm run db:check`
-- can validate the migrations against a throwaway Postgres cluster.

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role noinherit bypassrls;
  end if;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
