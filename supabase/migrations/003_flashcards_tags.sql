alter table public.vocabulary_items
  add column if not exists tags text[] not null default '{}';

create table if not exists public.flashcards (
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_item_id uuid not null,
  status text check (status in ('not_yet','roughly','learned','mastered')),
  source_daily_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vocabulary_item_id),
  foreign key (vocabulary_item_id, user_id)
    references public.vocabulary_items(id, user_id) on delete cascade
);

create index if not exists flashcards_user_status_idx
  on public.flashcards(user_id, status, created_at desc);

alter table public.flashcards enable row level security;
revoke all on public.flashcards from anon;
grant select, insert, update, delete on public.flashcards to authenticated;

create policy "owner flashcards select" on public.flashcards
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner flashcards insert" on public.flashcards
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner flashcards update" on public.flashcards
  for update to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()))
  with check (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner flashcards delete" on public.flashcards
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
