alter table public.vocabulary_items
  add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  add column if not exists field_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(field_provenance) = 'object'),
  add column if not exists revision integer not null default 1 check (revision > 0);

create table if not exists public.vocabulary_identity_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_item_id uuid not null,
  provider text not null check (char_length(provider) between 1 and 80),
  source_reference text not null check (char_length(source_reference) between 1 and 500),
  dataset_version text not null default '',
  created_at timestamptz not null default now(),
  foreign key (vocabulary_item_id, user_id)
    references public.vocabulary_items(id, user_id) on delete cascade,
  unique (user_id, provider, source_reference, dataset_version)
);

create table if not exists public.vocabulary_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_item_id uuid not null,
  operation_id uuid not null,
  selected_text text not null check (char_length(selected_text) between 1 and 120),
  context_text text not null default '' check (char_length(context_text) <= 2000),
  source_url text not null check (char_length(source_url) between 1 and 2048),
  source_title text not null default '' check (char_length(source_title) <= 300),
  source_kind text not null check (source_kind in ('youtube', 'web')),
  direction text not null check (direction in ('en-en', 'en-vi', 'vi-en')),
  video_time double precision check (video_time is null or video_time >= 0),
  created_at timestamptz not null default now(),
  foreign key (vocabulary_item_id, user_id)
    references public.vocabulary_items(id, user_id) on delete cascade,
  unique (user_id, operation_id)
);
create index if not exists vocabulary_occurrences_item_created_idx
  on public.vocabulary_occurrences(user_id, vocabulary_item_id, created_at desc);

create table if not exists public.capture_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
create index if not exists capture_operations_created_idx
  on public.capture_operations(created_at);

create table if not exists public.enrichment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check (char_length(request_key) between 1 and 200),
  vocabulary_item_id uuid,
  mode text not null check (mode in ('en-en', 'en-vi', 'vi-en')),
  context_hash text not null default '',
  requested_fields text[] not null default '{}',
  result jsonb,
  state text not null check (state in ('reserved', 'complete', 'uncertain', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vocabulary_item_id, user_id)
    references public.vocabulary_items(id, user_id) on delete cascade,
  unique (user_id, request_key)
);

alter table public.vocabulary_identity_refs enable row level security;
alter table public.vocabulary_occurrences enable row level security;
alter table public.capture_operations enable row level security;
alter table public.enrichment_requests enable row level security;
revoke all on public.vocabulary_identity_refs, public.vocabulary_occurrences,
  public.capture_operations, public.enrichment_requests from anon, authenticated;

create policy "owner dictionary references select" on public.vocabulary_identity_refs
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner occurrences select" on public.vocabulary_occurrences
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner enrichment requests select" on public.enrichment_requests
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create or replace function public.capture_extension_word(
  p_operation_id uuid,
  p_payload_hash text,
  p_item jsonb,
  p_occurrence jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.capture_operations%rowtype;
  v_item_id uuid;
  v_result jsonb;
  v_term text := btrim(coalesce(p_item->>'term', ''));
  v_source_language text := coalesce(p_item->>'source_language', '');
  v_normalized_term text;
  v_normalized_meaning text;
  v_meaning_en text := btrim(coalesce(p_item->>'meaning_en', ''));
  v_meaning_vi text := btrim(coalesce(p_item->>'meaning_vi', ''));
  v_kind text := coalesce(p_item->>'kind', '');
  v_identity_provider text := btrim(coalesce(p_item->>'identity_provider', ''));
  v_identity_reference text := btrim(coalesce(p_item->>'identity_reference', ''));
  v_identity_version text := btrim(coalesce(p_item->>'identity_version', ''));
  v_inserted_id uuid;
  v_already_existed boolean := false;
  v_field_provenance jsonb := '{}'::jsonb;
begin
  if v_user is null or not public.is_allowed_google_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_operation_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_item) <> 'object' or jsonb_typeof(p_occurrence) <> 'object'
    or jsonb_typeof(coalesce(p_item->'details', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_item->'collocations', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_item->'ai_fields', '[]'::jsonb)) <> 'array'
    or pg_catalog.pg_column_size(p_item) > 32768
    or char_length(v_term) not between 1 and 120
    or v_source_language <> 'en' or v_kind not in ('word', 'phrase')
    or char_length(v_meaning_en) > 500 or char_length(v_meaning_vi) > 500
    or char_length(coalesce(p_occurrence->>'selected_text', '')) not between 1 and 120
    or char_length(coalesce(p_occurrence->>'context_text', '')) > 2000
    or char_length(coalesce(p_occurrence->>'source_url', '')) not between 1 and 2048
    or coalesce(p_occurrence->>'source_url', '') !~ '^https?://'
    or char_length(coalesce(p_occurrence->>'source_title', '')) > 300
    or coalesce(p_occurrence->>'source_kind', '') not in ('youtube', 'web')
    or coalesce(p_occurrence->>'direction', '') not in ('en-en', 'en-vi', 'vi-en')
    or (p_occurrence ? 'video_time' and p_occurrence->'video_time' <> 'null'::jsonb
      and (p_occurrence->>'video_time')::double precision < 0) then
    raise exception 'Invalid capture' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
    'source', case when coalesce(p_item->'ai_fields', '[]'::jsonb) ? e.key then 'ai' else 'dictionary' end,
    'updated_at', now()
  )), '{}'::jsonb) into v_field_provenance
  from jsonb_each(coalesce(p_item->'details', '{}'::jsonb)) e;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text || ':' || p_operation_id::text));
  select * into v_existing from public.capture_operations
    where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'Operation ID reused with a different payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  if v_identity_provider <> '' and v_identity_reference <> '' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      v_user::text || ':' || v_identity_provider || ':' || v_identity_reference || ':' || v_identity_version
    ));
    select vocabulary_item_id into v_item_id from public.vocabulary_identity_refs
      where user_id = v_user and provider = v_identity_provider
        and source_reference = v_identity_reference and dataset_version = v_identity_version;
    v_already_existed := v_item_id is not null;
  end if;

  v_normalized_term := pg_catalog.lower(pg_catalog.regexp_replace(v_term, '\s+', ' ', 'g'));
  v_normalized_meaning := pg_catalog.left(pg_catalog.lower(pg_catalog.regexp_replace(
    case when v_meaning_en <> '' then v_meaning_en else v_meaning_vi end, '\s+', ' ', 'g')), 180);
  if v_normalized_meaning = '' and v_identity_provider <> '' and v_identity_reference <> '' then
    v_normalized_meaning := pg_catalog.left('unresolved:' || v_identity_provider || ':' || v_identity_reference, 180);
  elsif v_normalized_meaning = '' then
    v_normalized_meaning := 'unresolved:' || pg_catalog.md5(coalesce(nullif(p_occurrence->>'context_text', ''), p_operation_id::text));
  end if;

  if v_item_id is null then
    insert into public.vocabulary_items (
      user_id, term, normalized_term, kind, source_language, meaning_vi, meaning_en,
      normalized_meaning, example, collocations, source_text, note, details, field_provenance
    ) values (
      v_user, v_term, v_normalized_term, v_kind, v_source_language, v_meaning_vi, v_meaning_en,
      v_normalized_meaning, coalesce(p_item->>'example', ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_item->'collocations', '[]'::jsonb))), '{}'),
      '', 'Saved from Phrasebook extension', coalesce(p_item->'details', '{}'::jsonb), v_field_provenance
    ) on conflict (user_id, normalized_term, source_language, normalized_meaning) do nothing
    returning id into v_inserted_id;
    if v_inserted_id is not null then
      v_item_id := v_inserted_id;
      v_already_existed := false;
    else
      select id into v_item_id from public.vocabulary_items
        where user_id = v_user and normalized_term = v_normalized_term
          and source_language = v_source_language and normalized_meaning = v_normalized_meaning
        order by created_at, id limit 1 for update;
      v_already_existed := true;
    end if;
  end if;
  if v_identity_provider <> '' and v_identity_reference <> '' then
    insert into public.vocabulary_identity_refs(user_id, vocabulary_item_id, provider, source_reference, dataset_version)
      values (v_user, v_item_id, v_identity_provider, v_identity_reference, v_identity_version)
      on conflict (user_id, provider, source_reference, dataset_version) do nothing;
  end if;
  if v_item_id is null then raise exception 'Could not resolve captured vocabulary item'; end if;

  update public.vocabulary_items as item set
    meaning_en = case when item.meaning_en = '' then v_meaning_en else item.meaning_en end,
    meaning_vi = case when item.meaning_vi = '' then v_meaning_vi else item.meaning_vi end,
    example = case when item.example = '' then coalesce(p_item->>'example', '') else item.example end,
    collocations = case when cardinality(item.collocations) = 0 then
      coalesce(array(select jsonb_array_elements_text(coalesce(p_item->'collocations', '[]'::jsonb))), '{}') else item.collocations end,
    details = item.details || coalesce((
      select jsonb_object_agg(incoming.key, incoming.value)
      from jsonb_each(coalesce(p_item->'details', '{}'::jsonb)) incoming
      where item.details->incoming.key is null
        or item.details->incoming.key in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
    ), '{}'::jsonb),
    field_provenance = item.field_provenance || coalesce((
      select jsonb_object_agg(incoming.key, incoming.value)
      from jsonb_each(v_field_provenance) incoming
      where item.field_provenance->incoming.key is null
    ), '{}'::jsonb),
    revision = item.revision + 1, updated_at = now()
  where item.user_id = v_user and item.id = v_item_id and (
    (item.meaning_en = '' and v_meaning_en <> '')
    or (item.meaning_vi = '' and v_meaning_vi <> '')
    or (item.example = '' and coalesce(p_item->>'example', '') <> '')
    or (cardinality(item.collocations) = 0 and jsonb_array_length(coalesce(p_item->'collocations', '[]'::jsonb)) > 0)
    or exists (
      select 1 from jsonb_each(coalesce(p_item->'details', '{}'::jsonb)) incoming
      where item.details->incoming.key is null
        or item.details->incoming.key in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
    )
    or exists (
      select 1 from jsonb_each(v_field_provenance) incoming
      where item.field_provenance->incoming.key is null
    )
  );

  insert into public.vocabulary_occurrences (
    user_id, vocabulary_item_id, operation_id, selected_text, context_text,
    source_url, source_title, source_kind, direction, video_time
  ) values (
    v_user, v_item_id, p_operation_id,
    btrim(coalesce(p_occurrence->>'selected_text', '')),
    coalesce(p_occurrence->>'context_text', ''),
    coalesce(p_occurrence->>'source_url', ''),
    coalesce(p_occurrence->>'source_title', ''),
    coalesce(p_occurrence->>'source_kind', ''),
    coalesce(p_occurrence->>'direction', ''),
    nullif(p_occurrence->>'video_time', '')::double precision
  );
  insert into public.flashcards (user_id, vocabulary_item_id, status, source_daily_date)
    values (v_user, v_item_id, null, null)
    on conflict (user_id, vocabulary_item_id) do nothing;

  v_result := jsonb_build_object('item_id', v_item_id, 'already_existed', v_already_existed);
  insert into public.capture_operations(user_id, operation_id, payload_hash, result)
    values (v_user, p_operation_id, p_payload_hash, v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.capture_extension_word(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.capture_extension_word(uuid, text, jsonb, jsonb) to authenticated;

grant select on public.vocabulary_identity_refs, public.vocabulary_occurrences to authenticated;
