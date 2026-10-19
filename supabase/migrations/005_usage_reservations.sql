create table if not exists public.ai_usage_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('translation', 'suggestion')),
  usage_day date not null,
  state text not null check (state in ('reserved', 'completed')),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, request_id),
  check (input_tokens is null or input_tokens >= 0),
  check (output_tokens is null or output_tokens >= 0),
  check ((state = 'reserved' and completed_at is null) or (state = 'completed' and completed_at is not null))
);
create index if not exists ai_usage_reservations_day_idx
  on public.ai_usage_reservations(user_id, kind, usage_day, state);

alter table public.ai_usage_reservations enable row level security;
revoke all on public.ai_usage_reservations from anon, authenticated;
grant select on public.ai_usage_reservations to authenticated;
revoke insert on public.usage_events from authenticated;
create policy "owner usage reservations select" on public.ai_usage_reservations
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed_google_user()));

create or replace function public.reserve_usage_request(
  p_request_id uuid,
  p_kind text,
  p_limit integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  v_existing public.ai_usage_reservations%rowtype;
  v_used bigint;
  v_reserved bigint;
begin
  if v_user is null or not public.is_allowed_google_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_request_id is null or p_kind is null or p_kind not in ('translation', 'suggestion')
    or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Invalid usage reservation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text || ':' || p_kind || ':' || v_day::text));
  select * into v_existing from public.ai_usage_reservations
    where user_id = v_user and request_id = p_request_id;
  if found then
    if v_existing.kind <> p_kind or v_existing.usage_day <> v_day then
      raise exception 'Request ID reused' using errcode = '23505';
    end if;
    return true;
  end if;

  select count(*) into v_used from public.usage_events
    where user_id = v_user and kind = p_kind and created_at >= v_day_start;
  select count(*) into v_reserved from public.ai_usage_reservations
    where user_id = v_user and kind = p_kind and usage_day = v_day and state = 'reserved';
  if v_used + v_reserved >= p_limit then return false; end if;

  insert into public.ai_usage_reservations(user_id, request_id, kind, usage_day, state, created_at)
    values (v_user, p_request_id, p_kind, v_day, 'reserved', v_now);
  delete from public.ai_usage_reservations where user_id = v_user and usage_day < v_day - 90;
  return true;
end;
$$;

create or replace function public.complete_usage_request(
  p_request_id uuid,
  p_input_tokens integer,
  p_output_tokens integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reservation public.ai_usage_reservations%rowtype;
begin
  if v_user is null or not public.is_allowed_google_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_request_id is null or p_input_tokens is null or p_input_tokens not between 0 and 10000000
    or p_output_tokens is null or p_output_tokens not between 0 and 10000000 then
    raise exception 'Invalid usage result' using errcode = '22023';
  end if;
  select * into v_reservation from public.ai_usage_reservations
    where user_id = v_user and request_id = p_request_id for update;
  if not found then raise exception 'Usage request was not reserved' using errcode = 'P0002'; end if;
  if v_reservation.state = 'completed' then return true; end if;

  insert into public.usage_events(user_id, kind, input_tokens, output_tokens, created_at)
    values (v_user, v_reservation.kind, p_input_tokens, p_output_tokens, v_reservation.created_at);
  update public.ai_usage_reservations set state = 'completed', input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, completed_at = now()
    where user_id = v_user and request_id = p_request_id;
  return true;
end;
$$;

revoke all on function public.reserve_usage_request(uuid, text, integer) from public, anon;
revoke all on function public.complete_usage_request(uuid, integer, integer) from public, anon;
grant execute on function public.reserve_usage_request(uuid, text, integer) to authenticated;
grant execute on function public.complete_usage_request(uuid, integer, integer) to authenticated;
