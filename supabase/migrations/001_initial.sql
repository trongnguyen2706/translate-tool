create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from anon, authenticated;
create table if not exists private.allowed_users (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
revoke all on private.allowed_users from anon, authenticated;

create or replace function public.is_allowed_google_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.allowed_users a
    where a.email = lower(auth.jwt()->>'email')
      and auth.jwt()->'app_metadata'->>'provider' = 'google'
  );
$$;
revoke all on function public.is_allowed_google_user() from public, anon;
grant execute on function public.is_allowed_google_user() to authenticated;

create table if not exists public.translations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_text text not null check (char_length(source_text) between 1 and 12000),
  direction text not null check (direction in ('en-vi', 'vi-en', 'en-en')),
  translated_text text not null,
  created_at timestamptz not null default now()
);
create index if not exists translations_user_created_idx on public.translations(user_id, created_at desc);

create table if not exists public.vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null,
  normalized_term text not null,
  kind text not null check (kind in ('word', 'phrase')),
  source_language text not null check (source_language in ('en', 'vi')),
  meaning_vi text not null default '',
  meaning_en text not null default '',
  normalized_meaning text not null,
  example text not null default '',
  collocations text[] not null default '{}',
  source_text text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_term, source_language, normalized_meaning)
);
create index if not exists vocabulary_user_created_idx on public.vocabulary_items(user_id, created_at desc);
create index if not exists vocabulary_user_term_idx on public.vocabulary_items(user_id, normalized_term);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_direction text not null default 'en-vi' check (default_direction in ('en-vi', 'vi-en', 'en-en')),
  approve_before_save boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('translation', 'suggestion')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_user_day_idx on public.usage_events(user_id, kind, created_at desc);

alter table public.translations enable row level security;
alter table public.vocabulary_items enable row level security;
alter table public.user_settings enable row level security;
alter table public.usage_events enable row level security;

revoke all on public.translations, public.vocabulary_items, public.user_settings, public.usage_events from anon;
grant select, insert, update, delete on public.translations, public.vocabulary_items, public.user_settings to authenticated;
grant select, insert on public.usage_events to authenticated;

create policy "owner translations select" on public.translations for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner translations insert" on public.translations for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner translations update" on public.translations for update to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user())) with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner translations delete" on public.translations for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create policy "owner vocabulary select" on public.vocabulary_items for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner vocabulary insert" on public.vocabulary_items for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner vocabulary update" on public.vocabulary_items for update to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user())) with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner vocabulary delete" on public.vocabulary_items for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create policy "owner settings select" on public.user_settings for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner settings insert" on public.user_settings for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner settings update" on public.user_settings for update to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user())) with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner settings delete" on public.user_settings for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create policy "owner usage select" on public.usage_events for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner usage insert" on public.usage_events for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
