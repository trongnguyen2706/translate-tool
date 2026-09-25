alter table public.vocabulary_items
  add column if not exists cefr_level text check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  add column if not exists ielts_relevance text check (ielts_relevance in ('high','medium','low')),
  add column if not exists ielts_skills text[] not null default '{}',
  add column if not exists topics text[] not null default '{}',
  add column if not exists learning_reason text not null default '';

create index if not exists vocabulary_learning_idx
  on public.vocabulary_items(user_id, cefr_level, ielts_relevance);
create unique index if not exists vocabulary_id_user_idx on public.vocabulary_items(id, user_id);

create table if not exists public.daily_word_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  filters jsonb not null default '{}',
  requested_count integer not null check (requested_count between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, study_date),
  unique (id, user_id)
);

create table if not exists public.daily_word_set_items (
  set_id uuid not null,
  vocabulary_item_id uuid not null,
  user_id uuid not null,
  position integer not null check (position > 0),
  studied_at timestamptz,
  primary key (set_id, vocabulary_item_id),
  unique (set_id, position),
  foreign key (set_id, user_id) references public.daily_word_sets(id, user_id) on delete cascade,
  foreign key (vocabulary_item_id, user_id) references public.vocabulary_items(id, user_id) on delete cascade
);

create index if not exists daily_word_sets_user_date_idx on public.daily_word_sets(user_id, study_date desc);
create index if not exists daily_word_items_user_idx on public.daily_word_set_items(user_id, set_id, position);

alter table public.daily_word_sets enable row level security;
alter table public.daily_word_set_items enable row level security;
revoke all on public.daily_word_sets, public.daily_word_set_items from anon, authenticated;
grant select on public.daily_word_sets, public.daily_word_set_items to authenticated;

create policy "owner daily sets select" on public.daily_word_sets
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner daily items select" on public.daily_word_set_items
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create or replace function public.replace_daily_word_set(
  p_study_date date, p_filters jsonb, p_requested_count integer, p_item_ids uuid[]
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_set_id uuid;
begin
  if v_user is null or not public.is_allowed_google_user() then
    raise exception 'Not allowed';
  end if;
  if p_study_date is null or p_requested_count not between 1 and 30
    or p_filters is null or p_item_ids is null or cardinality(p_item_ids) > p_requested_count then
    raise exception 'Invalid daily set';
  end if;
  if coalesce(p_filters->>'createdMode','') not in ('all','date','weekday')
    or coalesce(p_filters->>'levelMode','') not in ('all','range','unclassified')
    or coalesce(p_filters->>'ieltsMode','') not in ('all','high','high-medium','low','unclassified')
    or coalesce(p_filters->>'kind','') not in ('all','word','phrase')
    or coalesce(p_filters->>'skill','') not in ('all','speaking','writing','reading','listening')
    or coalesce(p_filters->>'topic','') not in ('all','health','work','education','environment','technology','society','travel','business','science','culture','daily-life','other') then
    raise exception 'Invalid daily filters';
  end if;
  if (select count(*) from public.vocabulary_items item
      where item.user_id = v_user and item.id = any(p_item_ids)
        and item.source_language = 'en'
        and (p_filters->>'kind' = 'all' or item.kind = p_filters->>'kind')
        and (p_filters->>'createdMode' = 'all'
          or (p_filters->>'createdMode' = 'date' and (item.created_at at time zone 'Asia/Ho_Chi_Minh')::date = (p_filters->>'createdDate')::date)
          or (p_filters->>'createdMode' = 'weekday' and extract(dow from item.created_at at time zone 'Asia/Ho_Chi_Minh')::integer = (p_filters->>'createdWeekday')::integer))
        and (p_filters->>'levelMode' = 'all'
          or (p_filters->>'levelMode' = 'unclassified' and item.cefr_level is null)
          or (p_filters->>'levelMode' = 'range' and item.cefr_level is not null
            and array_position(array['A1','A2','B1','B2','C1','C2'], item.cefr_level)
              between array_position(array['A1','A2','B1','B2','C1','C2'], p_filters->>'levelMin')
                  and array_position(array['A1','A2','B1','B2','C1','C2'], p_filters->>'levelMax')))
        and (p_filters->>'ieltsMode' = 'all'
          or (p_filters->>'ieltsMode' = 'unclassified' and item.ielts_relevance is null)
          or (p_filters->>'ieltsMode' = 'high' and item.ielts_relevance = 'high')
          or (p_filters->>'ieltsMode' = 'high-medium' and item.ielts_relevance in ('high','medium'))
          or (p_filters->>'ieltsMode' = 'low' and item.ielts_relevance = 'low'))
        and (p_filters->>'skill' = 'all' or p_filters->>'skill' = any(item.ielts_skills))
        and (p_filters->>'topic' = 'all' or p_filters->>'topic' = any(item.topics))) <> cardinality(p_item_ids) then
    raise exception 'Invalid vocabulary items';
  end if;

  insert into public.daily_word_sets(user_id, study_date, filters, requested_count)
  values (v_user, p_study_date, p_filters, p_requested_count)
  on conflict (user_id, study_date) do update
    set filters = excluded.filters, requested_count = excluded.requested_count, updated_at = now()
  returning id into v_set_id;

  delete from public.daily_word_set_items where set_id = v_set_id;
  insert into public.daily_word_set_items(set_id, vocabulary_item_id, user_id, position)
  select v_set_id, item_id, v_user, ordinal::integer
  from unnest(p_item_ids) with ordinality as selected(item_id, ordinal);
  return v_set_id;
end;
$$;

create or replace function public.set_daily_word_studied(
  p_study_date date, p_item_id uuid, p_studied boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_updated integer;
begin
  if v_user is null or not public.is_allowed_google_user() then
    raise exception 'Not allowed';
  end if;
  update public.daily_word_set_items item
  set studied_at = case when p_studied then now() else null end
  from public.daily_word_sets study_set
  where item.set_id = study_set.id and study_set.user_id = v_user
    and item.user_id = v_user and study_set.study_date = p_study_date
    and item.vocabulary_item_id = p_item_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.replace_daily_word_set(date,jsonb,integer,uuid[]) from public, anon;
revoke all on function public.set_daily_word_studied(date,uuid,boolean) from public, anon;
grant execute on function public.replace_daily_word_set(date,jsonb,integer,uuid[]) to authenticated;
grant execute on function public.set_daily_word_studied(date,uuid,boolean) to authenticated;
