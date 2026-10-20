-- Stable item IDs, language-specific aliases, and one writer for web/import/capture.
create table public.vocabulary_meaning_aliases (
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_item_id uuid not null,
  normalized_term text not null,
  source_language text not null check(source_language in ('en','vi')),
  meaning_language text not null check(meaning_language in ('en','vi')),
  normalized_meaning text not null,
  primary key(user_id,vocabulary_item_id,normalized_term,source_language,meaning_language,normalized_meaning),
  foreign key(vocabulary_item_id,user_id) references public.vocabulary_items(id,user_id) on delete cascade
);
create index vocabulary_alias_lookup on public.vocabulary_meaning_aliases(user_id,normalized_term,source_language,meaning_language,normalized_meaning);
alter table public.vocabulary_meaning_aliases enable row level security;
revoke all on public.vocabulary_meaning_aliases from anon,authenticated;
grant select on public.vocabulary_meaning_aliases to authenticated;
create policy "owner meaning aliases" on public.vocabulary_meaning_aliases for select to authenticated
  using(user_id=(select auth.uid()) and (select public.is_allowed_google_user()));
create or replace function public.record_vocabulary_aliases() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.vocabulary_meaning_aliases(user_id,vocabulary_item_id,normalized_term,source_language,meaning_language,normalized_meaning)
  select new.user_id,new.id,lower(regexp_replace(btrim(new.term),'\s+',' ','g')),new.source_language,m.lang,
    lower(regexp_replace(btrim(m.meaning),'\s+',' ','g'))
  from (values('en',new.meaning_en),('vi',new.meaning_vi)) m(lang,meaning) where btrim(m.meaning)<>''
  on conflict do nothing;
  return new;
end $$;
create trigger vocabulary_meaning_aliases_write after insert or update of term,source_language,meaning_en,meaning_vi on public.vocabulary_items
  for each row execute function public.record_vocabulary_aliases();
insert into public.vocabulary_meaning_aliases
select v.user_id,v.id,lower(regexp_replace(btrim(v.term),'\s+',' ','g')),v.source_language,m.lang,
  lower(regexp_replace(btrim(m.meaning),'\s+',' ','g'))
from public.vocabulary_items v cross join lateral(values('en',v.meaning_en),('vi',v.meaning_vi)) m(lang,meaning)
where btrim(m.meaning)<>'' on conflict do nothing;

create or replace function public.save_vocabulary_item(p_item jsonb,p_target_id uuid default null,p_overwrite boolean default false,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_old public.vocabulary_items%rowtype; v_new public.vocabulary_items%rowtype;
  v_id uuid; v_ids uuid[]; v_existing boolean:=false; v_data jsonb:='{}'; v_entry record;
  v_term text:=lower(regexp_replace(btrim(coalesce(p_item->>'term','')),'\s+',' ','g'));
  v_lang text:=coalesce(p_item->>'source_language','en');
  v_provider text:=coalesce(p_item->>'identity_provider',''); v_reference text:=coalesce(p_item->>'identity_reference','');
  v_version text:=coalesce(p_item->>'identity_version','');
begin
  if v_user is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_overwrite and p_target_id is null then raise exception 'An explicit item is required for edits' using errcode='22023'; end if;
  if jsonb_typeof(p_item)<>'object' or pg_column_size(p_item)>65536 then raise exception 'Invalid vocabulary' using errcode='22023'; end if;
  if p_target_id is not null then
    select * into v_old from public.vocabulary_items where id=p_target_id and user_id=v_user;
    if not found then raise exception 'Item not found' using errcode='P0002'; end if;
    if p_expected_revision is null or p_expected_revision<>v_old.revision then raise exception 'Item changed' using errcode='40001'; end if;
    v_id:=v_old.id; v_existing:=true;
    v_term:=lower(regexp_replace(btrim(coalesce(p_item->>'term',v_old.term)),'\s+',' ','g'));
    v_lang:=coalesce(p_item->>'source_language',v_old.source_language);
  end if;
  if char_length(v_term) not between 1 and 120 or v_lang not in ('en','vi') then raise exception 'Invalid term' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text||':vocabulary:'||v_term||':'||v_lang));
  if p_item->>'confirmed_item_id' is not null then
    select id into v_id from public.vocabulary_items where id=(p_item->>'confirmed_item_id')::uuid and user_id=v_user and normalized_term=v_term and source_language=v_lang;
    if v_id is null then raise exception 'Confirmed item not found' using errcode='P0002'; end if;
  end if;
  if v_id is null and v_provider<>'' and v_reference<>'' then
    select vocabulary_item_id into v_id from public.vocabulary_identity_refs
      where user_id=v_user and provider=v_provider and source_reference=v_reference and dataset_version=v_version;
  end if;
  if v_id is null and v_provider='phrasebook-backup' and v_reference ~ '^[0-9a-f-]{36}$' then
    select id into v_id from public.vocabulary_items where id=v_reference::uuid and user_id=v_user;
  end if;
  if v_id is null then
    select array_agg(distinct a.vocabulary_item_id) into v_ids from public.vocabulary_meaning_aliases a
    where a.user_id=v_user and a.normalized_term=v_term and a.source_language=v_lang and (
      (a.meaning_language='en' and a.normalized_meaning=lower(regexp_replace(btrim(coalesce(p_item->>'meaning_en','')),'\s+',' ','g')))
      or (a.meaning_language='vi' and a.normalized_meaning=lower(regexp_replace(btrim(coalesce(p_item->>'meaning_vi','')),'\s+',' ','g'))));
    if cardinality(v_ids)>1 then raise exception 'Ambiguous meaning: choose an existing item in your library before retrying' using errcode='21000'; end if;
    v_id:=v_ids[1];
  end if;
  if v_id is not null then
    select * into v_old from public.vocabulary_items where id=v_id and user_id=v_user for update;
    if p_target_id is not null and p_expected_revision<>v_old.revision then raise exception 'Item changed' using errcode='40001'; end if;
    v_existing:=true;
  else
    v_old:=jsonb_populate_record(null::public.vocabulary_items,'{"kind":"word","source_language":"en","meaning_en":"","meaning_vi":"","example":"","collocations":[],"source_text":"","note":"","details":{},"field_provenance":{},"revision":1,"ielts_skills":[],"topics":[],"tags":[],"learning_reason":""}'::jsonb);
    v_old.id:=gen_random_uuid(); v_old.user_id:=v_user; v_old.created_at:=now(); v_old.updated_at:=now();
    v_old.normalized_meaning:='identity:'||v_old.id::text;
    if p_item ? 'created_at' then v_old.created_at:=(p_item->>'created_at')::timestamptz; end if;
  end if;
  for v_entry in select key,value from jsonb_each(p_item) where key=any(array[
    'term','kind','source_language','meaning_en','meaning_vi','example','collocations','source_text','note','cefr_level','ielts_relevance','ielts_skills','topics','tags','learning_reason','details','field_provenance']) loop
    if not v_existing or p_overwrite or to_jsonb(v_old)->v_entry.key is null or to_jsonb(v_old)->v_entry.key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) then
      v_data:=v_data||jsonb_build_object(v_entry.key,v_entry.value);
    end if;
  end loop;
  if v_existing and not p_overwrite then
    v_data:=v_data||jsonb_build_object('details',v_old.details||coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(coalesce(p_item->'details','{}')) e
      where v_old.details->e.key is null or v_old.details->e.key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)),'{}'::jsonb));
    v_data:=v_data||jsonb_build_object('field_provenance',coalesce(p_item->'field_provenance','{}')||v_old.field_provenance);
  end if;
  v_new:=jsonb_populate_record(v_old,v_data); v_new.normalized_term:=v_term;
  if v_existing and not p_overwrite and p_item->'details' ? 'definitionsByLanguage' then
    v_new.details:=v_new.details||jsonb_build_object('definitionsByLanguage',
      coalesce(v_old.details->'definitionsByLanguage','{}')||coalesce((select jsonb_object_agg(e.key,e.value)
        from jsonb_each(p_item->'details'->'definitionsByLanguage') e
        where v_old.details->'definitionsByLanguage'->e.key is null or v_old.details->'definitionsByLanguage'->e.key='[]'::jsonb),'{}'));
  end if;
  for v_entry in select key,value from jsonb_each(v_data) where key not in ('field_provenance','details')
    and value not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) loop
    if p_overwrite or v_new.field_provenance->v_entry.key is null then
      v_new.field_provenance:=v_new.field_provenance||jsonb_build_object(v_entry.key,jsonb_build_object(
        'source',case when p_item ? 'ai_fields' and ((p_item->'ai_fields') ? v_entry.key or (v_entry.key in ('meaning_en','meaning_vi') and (p_item->'ai_fields') ? 'definitions')) then 'ai'
          when coalesce(p_item->>'identity_provider','') not in ('','phrasebook-backup') then 'dictionary' else 'manual' end,'updated_at',now()));
    end if;
  end loop;
  if char_length(v_new.term)>120 or char_length(v_new.meaning_en)>500 or char_length(v_new.meaning_vi)>500 then raise exception 'Invalid field length' using errcode='22023'; end if;
  if not v_existing then
    insert into public.vocabulary_items select (v_new).*;
  else
    update public.vocabulary_items set term=v_new.term,normalized_term=v_term,kind=v_new.kind,source_language=v_new.source_language,
      meaning_en=v_new.meaning_en,meaning_vi=v_new.meaning_vi,example=v_new.example,collocations=v_new.collocations,source_text=v_new.source_text,note=v_new.note,
      cefr_level=v_new.cefr_level,ielts_relevance=v_new.ielts_relevance,ielts_skills=v_new.ielts_skills,topics=v_new.topics,tags=v_new.tags,learning_reason=v_new.learning_reason,
      details=v_new.details,field_provenance=v_new.field_provenance,revision=v_old.revision+1,updated_at=now()
      where id=v_old.id and user_id=v_user returning * into v_new;
  end if;
  if v_provider<>'' and v_reference<>'' then
    insert into public.vocabulary_identity_refs(user_id,vocabulary_item_id,provider,source_reference,dataset_version)
    values(v_user,v_new.id,v_provider,v_reference,v_version) on conflict(user_id,provider,source_reference,dataset_version) do nothing;
  end if;
  return jsonb_build_object('item',to_jsonb(v_new)-'user_id'-'normalized_term'-'normalized_meaning','already_existed',v_existing);
end $$;
revoke all on function public.save_vocabulary_item(jsonb,uuid,boolean,integer) from public,anon;
grant execute on function public.save_vocabulary_item(jsonb,uuid,boolean,integer) to authenticated;

-- Keep the deprecated column for old exports; it no longer decides identity.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.vocabulary_items'::regclass
    and contype='u' and pg_get_constraintdef(oid) like 'UNIQUE (user_id, normalized_term, source_language, normalized_meaning)%'
  loop execute format('alter table public.vocabulary_items drop constraint %I',c.conname); end loop;
end $$;

-- Keep deletion evidence so an older offline queue cannot silently restore a deleted word.
create table public.vocabulary_deletions (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  normalized_term text not null,source_language text not null,aliases jsonb not null,identity_refs jsonb not null,
  deleted_at timestamptz not null default now()
);
create index vocabulary_deletions_lookup on public.vocabulary_deletions(user_id,normalized_term,deleted_at);
alter table public.vocabulary_deletions enable row level security;
revoke all on public.vocabulary_deletions from anon,authenticated;
create or replace function public.record_vocabulary_deletion() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Account deletion must not recreate children beneath an auth.users row being removed.
  if exists(select 1 from auth.users where id=old.user_id) then
    perform pg_advisory_xact_lock(hashtext(old.user_id::text||':vocabulary:'||old.normalized_term||':'||old.source_language));
    insert into public.vocabulary_deletions(user_id,normalized_term,source_language,aliases,identity_refs)
    values(old.user_id,old.normalized_term,old.source_language,
      coalesce((select jsonb_agg(jsonb_build_object('language',meaning_language,'meaning',normalized_meaning)) from public.vocabulary_meaning_aliases where user_id=old.user_id and vocabulary_item_id=old.id),'[]'),
      coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'reference',source_reference,'version',dataset_version)) from public.vocabulary_identity_refs where user_id=old.user_id and vocabulary_item_id=old.id),'[]'));
  end if;
  return old;
end $$;
create trigger vocabulary_deletion_record before delete on public.vocabulary_items for each row execute function public.record_vocabulary_deletion();

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

  perform pg_advisory_xact_lock(hashtext(v_user::text||':vocabulary:'||lower(regexp_replace(btrim(v_term),'\s+',' ','g'))||':'||v_source_language));
  if exists(select 1 from public.vocabulary_deletions d where d.user_id=v_user
    and d.normalized_term=lower(regexp_replace(btrim(v_term),'\s+',' ','g')) and d.source_language=v_source_language
    and d.deleted_at>coalesce((p_item->>'capture_created_at')::timestamptz,now()) and (
      d.aliases='[]'::jsonb or exists(select 1 from jsonb_array_elements(d.aliases) a where
        (a->>'language'='en' and a->>'meaning'=lower(regexp_replace(v_meaning_en,'\s+',' ','g')))
        or (a->>'language'='vi' and a->>'meaning'=lower(regexp_replace(v_meaning_vi,'\s+',' ','g'))))
      or exists(select 1 from jsonb_array_elements(d.identity_refs) r where r->>'provider'=v_identity_provider and r->>'reference'=v_identity_reference and r->>'version'=v_identity_version)
    )) then raise exception 'Word was deleted after capture' using errcode='23514'; end if;
  v_result := public.save_vocabulary_item(p_item || jsonb_build_object('field_provenance',v_field_provenance));
  v_item_id := (v_result->'item'->>'id')::uuid;
  v_already_existed := (v_result->>'already_existed')::boolean;

  if not exists(select 1 from public.vocabulary_occurrences where user_id=v_user and vocabulary_item_id=v_item_id
    and source_url=coalesce(p_occurrence->>'source_url','') and selected_text=btrim(coalesce(p_occurrence->>'selected_text',''))
    and context_text=coalesce(p_occurrence->>'context_text','') and direction=coalesce(p_occurrence->>'direction','')
    and video_time is not distinct from nullif(p_occurrence->>'video_time','')::double precision) then
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
  end if;
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

create or replace function public.delete_vocabulary_items(p_ids uuid[])
returns uuid[] language plpgsql security definer set search_path='' as $$
declare v_row record; v_ids uuid[];
begin
  if auth.uid() is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  if cardinality(p_ids) not between 1 and 100 then raise exception 'Invalid IDs' using errcode='22023'; end if;
  for v_row in select distinct normalized_term,source_language from public.vocabulary_items where user_id=auth.uid() and id=any(p_ids) order by normalized_term,source_language loop
    perform pg_advisory_xact_lock(hashtext(auth.uid()::text||':vocabulary:'||v_row.normalized_term||':'||v_row.source_language));
  end loop;
  with removed as(delete from public.vocabulary_items where user_id=auth.uid() and id=any(p_ids) returning id) select array_agg(id) into v_ids from removed;
  return coalesce(v_ids,'{}');
end $$;
revoke all on function public.delete_vocabulary_items(uuid[]) from public,anon;
grant execute on function public.delete_vocabulary_items(uuid[]) to authenticated;
