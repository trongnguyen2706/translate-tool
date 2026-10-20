create table public.backup_import_parts (
  user_id uuid not null references auth.users(id) on delete cascade,
  part_id uuid not null, payload_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(user_id,part_id)
);
alter table public.backup_import_parts enable row level security;
revoke all on public.backup_import_parts from anon,authenticated;
grant select on public.backup_import_parts to authenticated;
create policy "owner backup parts" on public.backup_import_parts for select to authenticated
  using(user_id=(select auth.uid()) and (select public.is_allowed_google_user()));

create or replace function public.restore_backup_part(p_part_id uuid,p_hash text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_previous public.backup_import_parts%rowtype; v_entry jsonb; v_position jsonb;
  v_map jsonb:='{}'; v_result jsonb; v_saved jsonb; v_id uuid; v_ids uuid[]; v_ref uuid;
  v_word_count integer:=0; v_translation_count integer:=0; v_set_count integer:=0;
begin
  if v_user is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_part_id is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_data)<>'object'
    or jsonb_array_length(p_data->'vocabulary')>2000 or pg_column_size(p_data)>20000000 then
    raise exception 'Invalid backup part' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text||':backup:'||p_part_id::text));
  select * into v_previous from public.backup_import_parts where user_id=v_user and part_id=p_part_id;
  if found then
    if v_previous.payload_hash<>p_hash then raise exception 'Backup part ID conflict' using errcode='23505'; end if;
    return v_previous.result||jsonb_build_object('replayed',true);
  end if;
  for v_entry in select value from jsonb_array_elements(p_data->'vocabulary') loop
    v_saved:=public.save_vocabulary_item(v_entry || case when v_entry ? 'id' then jsonb_build_object(
      'identity_provider','phrasebook-backup','identity_reference',v_entry->>'id','identity_version','') else '{}'::jsonb end);
    v_id:=(v_saved->'item'->>'id')::uuid;
    if v_entry ? 'id' then v_map:=v_map||jsonb_build_object(v_entry->>'id',v_id); end if;
    v_word_count:=v_word_count+1;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_data->'identity_refs','[]')) loop
    v_id:=(v_map->>(v_entry->>'vocabulary_item_id'))::uuid;
    if v_id is null then raise exception 'Unknown identity item' using errcode='22023'; end if;
    select vocabulary_item_id into v_ref from public.vocabulary_identity_refs where user_id=v_user
      and provider=v_entry->>'provider' and source_reference=v_entry->>'source_reference' and dataset_version=coalesce(v_entry->>'dataset_version','');
    if v_ref is not null and v_ref<>v_id then raise exception 'Conflicting dictionary reference' using errcode='21000'; end if;
    insert into public.vocabulary_identity_refs(user_id,vocabulary_item_id,provider,source_reference,dataset_version)
      values(v_user,v_id,v_entry->>'provider',v_entry->>'source_reference',coalesce(v_entry->>'dataset_version','')) on conflict do nothing;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_data->'occurrences','[]')) loop
    v_id:=(v_map->>(v_entry->>'vocabulary_item_id'))::uuid;
    if v_id is null then raise exception 'Unknown occurrence item' using errcode='22023'; end if;
    insert into public.vocabulary_occurrences(user_id,vocabulary_item_id,operation_id,selected_text,context_text,source_url,source_title,source_kind,direction,video_time,created_at)
      values(v_user,v_id,(v_entry->>'operation_id')::uuid,v_entry->>'selected_text',coalesce(v_entry->>'context_text',''),v_entry->>'source_url',coalesce(v_entry->>'source_title',''),
        v_entry->>'source_kind',v_entry->>'direction',(v_entry->>'video_time')::double precision,coalesce((v_entry->>'created_at')::timestamptz,now())) on conflict(user_id,operation_id) do nothing;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_data->'flashcards','[]')) loop
    v_id:=(v_map->>(v_entry->>'vocabulary_item_id'))::uuid;
    if v_id is null then raise exception 'Unknown flashcard item' using errcode='22023'; end if;
    insert into public.flashcards(user_id,vocabulary_item_id,status,source_daily_date)
      values(v_user,v_id,v_entry->>'status',(v_entry->>'source_daily_date')::date) on conflict(user_id,vocabulary_item_id) do nothing;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_data->'daily_sets','[]')) loop
    if exists(select 1 from public.daily_word_sets where user_id=v_user and study_date=(v_entry->>'study_date')::date) then continue; end if;
    select array_agg((v_map->>(e.value->>'vocabulary_item_id'))::uuid order by e.ordinality) into v_ids
      from jsonb_array_elements(v_entry->'items') with ordinality e(value,ordinality);
    if array_position(v_ids,null) is not null then raise exception 'Unknown daily item' using errcode='22023'; end if;
    perform public.replace_daily_word_set((v_entry->>'study_date')::date,v_entry->'filters',(v_entry->>'requested_count')::integer,coalesce(v_ids,'{}'));
    for v_position in select value from jsonb_array_elements(v_entry->'items') loop
      if (v_position->>'studied')::boolean then
        perform public.set_daily_word_studied((v_entry->>'study_date')::date,(v_map->>(v_position->>'vocabulary_item_id'))::uuid,true);
      end if;
    end loop;
    v_set_count:=v_set_count+1;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_data->'translations','[]')) loop
    -- Preserve an existing owner's translation; copied backups never update a different owner.
    if v_entry ? 'id' and exists(select 1 from public.translations where id=(v_entry->>'id')::uuid and user_id=v_user) then continue; end if;
    v_id:=coalesce((v_entry->>'id')::uuid,gen_random_uuid());
    if exists(select 1 from public.translations where id=v_id) then v_id:=gen_random_uuid(); end if;
    insert into public.translations(id,user_id,source_text,direction,translated_text,created_at)
      values(v_id,v_user,v_entry->>'source_text',v_entry->>'direction',v_entry->>'translated_text',coalesce((v_entry->>'created_at')::timestamptz,now()));
    v_translation_count:=v_translation_count+1;
  end loop;
  v_result:=jsonb_build_object('vocabulary',v_word_count,'translations',v_translation_count,'daily_sets',v_set_count,
    'flashcards',jsonb_array_length(coalesce(p_data->'flashcards','[]')),'occurrences',jsonb_array_length(coalesce(p_data->'occurrences','[]')));
  insert into public.backup_import_parts values(v_user,p_part_id,p_hash,v_result,now());
  return v_result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.restore_backup_part(uuid,text,jsonb) from public,anon;
grant execute on function public.restore_backup_part(uuid,text,jsonb) to authenticated;

create or replace function public.undo_vocabulary_save(p_id uuid,p_revision integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_item public.vocabulary_items%rowtype;
begin
  if auth.uid() is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  select * into v_item from public.vocabulary_items where id=p_id and user_id=auth.uid();
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text||':vocabulary:'||v_item.normalized_term||':'||v_item.source_language));
  perform 1 from public.vocabulary_items where id=p_id and user_id=auth.uid() for update;
  if not found then return false; end if;
  if exists(select 1 from public.vocabulary_occurrences where vocabulary_item_id=p_id and user_id=auth.uid())
    or exists(select 1 from public.flashcards where vocabulary_item_id=p_id and user_id=auth.uid())
    or exists(select 1 from public.daily_word_set_items where vocabulary_item_id=p_id and user_id=auth.uid()) then return false; end if;
  delete from public.vocabulary_items where id=p_id and user_id=auth.uid() and revision=p_revision;
  return found;
end $$;
revoke all on function public.undo_vocabulary_save(uuid,integer) from public,anon;
grant execute on function public.undo_vocabulary_save(uuid,integer) to authenticated;
