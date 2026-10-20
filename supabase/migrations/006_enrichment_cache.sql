-- Cache and request ownership are scoped to auth.uid(); no service key is required.
alter table public.enrichment_requests add column if not exists term text not null default '';
create or replace function public.claim_enrichment(p_key text, p_mode text, p_fields text[],p_term text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_row public.enrichment_requests%rowtype;
begin
  if v_user is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_key !~ '^[0-9a-f]{64}$' or p_mode not in ('en-en','en-vi','vi-en') or cardinality(p_fields) not between 1 and 6
    or char_length(p_term)>120 or not p_fields <@ array['definitions','ipa','examples','synonyms','antonyms','collocations']::text[] then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text || ':enrich:' || p_key));
  select * into v_row from public.enrichment_requests where user_id=v_user and request_key=p_key for update;
  if found and v_row.state <> 'failed' then
    if v_row.state='reserved' and v_row.updated_at < now()-interval '2 minutes' then
      update public.enrichment_requests set state='uncertain',updated_at=now() where id=v_row.id;
      v_row.state := 'uncertain';
    end if;
    return jsonb_build_object('id',v_row.id,'claimed',false,'state',v_row.state,'result',v_row.result);
  end if;
  insert into public.enrichment_requests(user_id,request_key,mode,requested_fields,state,term)
    values(v_user,p_key,p_mode,p_fields,'reserved',p_term)
    on conflict(user_id,request_key) do update set id=gen_random_uuid(),state='reserved',result=null,updated_at=now()
    returning * into v_row;
  return jsonb_build_object('id',v_row.id,'claimed',true,'state','reserved');
end $$;

create or replace function public.finish_enrichment(p_id uuid,p_state text,p_result jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_state not in ('complete','failed','uncertain') or pg_catalog.pg_column_size(p_result)>32768
    or (p_state='complete' and jsonb_typeof(p_result)<>'object') then raise exception 'Invalid result' using errcode='22023'; end if;
  update public.enrichment_requests set state=p_state,result=p_result,updated_at=now()
    where id=p_id and user_id=auth.uid() and state in ('reserved','uncertain');
  return found;
end $$;
revoke all on function public.claim_enrichment(text,text,text[],text), public.finish_enrichment(uuid,text,jsonb) from public,anon;
grant execute on function public.claim_enrichment(text,text,text[],text), public.finish_enrichment(uuid,text,jsonb) to authenticated;
grant select on public.enrichment_requests,public.vocabulary_identity_refs,public.vocabulary_occurrences to authenticated;

-- Backup restore already validates/remaps these records through owner-only routes.
grant insert on public.vocabulary_identity_refs,public.vocabulary_occurrences to authenticated;
create policy "owner reference restore" on public.vocabulary_identity_refs for insert to authenticated
  with check(user_id=(select auth.uid()) and (select public.is_allowed_google_user()));
create policy "owner occurrence restore" on public.vocabulary_occurrences for insert to authenticated
  with check(user_id=(select auth.uid()) and (select public.is_allowed_google_user()));

-- User-initiated reset only; uncertain outcomes are never retried automatically.
create or replace function public.reset_uncertain_enrichment(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_allowed_google_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  update public.enrichment_requests set state='failed',updated_at=now()
    where id=p_id and user_id=auth.uid() and (state='uncertain' or (state='reserved' and updated_at<now()-interval '2 minutes'));
  return found;
end $$;
revoke all on function public.reset_uncertain_enrichment(uuid) from public,anon;
grant execute on function public.reset_uncertain_enrichment(uuid) to authenticated;
