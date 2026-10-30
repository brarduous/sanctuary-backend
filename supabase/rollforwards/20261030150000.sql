-- Restore daily-three compatibility after the non-destructive rollback.
begin;
set local lock_timeout='3s';
create or replace function public.discovery_complete(p_user uuid, p_events jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; c jsonb; existing public.discovery_completions; elapsed integer; result_outcome text; puzzle date; results jsonb := '[]'::jsonb;
begin
  if p_user is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then raise exception 'Invalid completion batch'; end if;
  for e in select value from jsonb_array_elements(p_events) loop
    -- Even approved but unscheduled drafts and future-only revisions cannot earn completion.
    select r.content into c from public.discovery_revisions r
      join public.discoveries d on d.id = r.discovery_id
      where r.discovery_id = (e->>'discoveryId')::uuid and r.revision = (e->>'revision')::int and not d.withdrawn
      and (exists(select 1 from public.discovery_schedule s where s.discovery_id = r.discovery_id and s.revision = r.revision and s.publication_date <= (now() at time zone 'Pacific/Kiritimati')::date)
        or exists(select 1 from public.discovery_publication_history h where h.discovery_id = r.discovery_id and h.revision = r.revision)
        or exists(select 1 from public.discovery_daily_set_items s where s.discovery_id=r.discovery_id and s.revision=r.revision and s.publication_date<=(now() at time zone 'Pacific/Kiritimati')::date));
    if c is null then
      results := results || jsonb_build_array(jsonb_build_object('eventId', e->>'eventId', 'status','unavailable'));
      continue;
    end if;
    if e->>'mode' not in ('answered','revealed') or (e->>'mode' = 'answered' and not exists(select 1 from jsonb_array_elements(c->'choices') o where o->>'id' = e->>'optionId'))
      or (e->>'mode' = 'revealed' and e->>'optionId' is not null) then raise exception 'Invalid answer'; end if;
    elapsed := null;
    if e ? 'elapsedMs' and e->'elapsedMs' <> 'null'::jsonb then
      if jsonb_typeof(e->'elapsedMs') <> 'number' or (e->>'elapsedMs') !~ '^[0-9]+$' then raise exception 'Invalid elapsed time'; end if;
      elapsed := (e->>'elapsedMs')::integer;
      if elapsed not between 0 and 20000 or (e->>'mode' = 'answered' and elapsed >= 20000) then raise exception 'Invalid elapsed time'; end if;
    end if;
    if e ? 'timedOut' and jsonb_typeof(e->'timedOut') <> 'boolean' then raise exception 'Invalid timeout'; end if;
    if coalesce((e->>'timedOut')::boolean,false) and (e->>'mode' <> 'revealed' or elapsed is distinct from 20000) then raise exception 'Invalid timeout'; end if;
    result_outcome := case when e->>'mode' = 'answered' then case when e->>'optionId' = c->>'correctOptionId' then 'correct' else 'incorrect' end
      when coalesce((e->>'timedOut')::boolean,false) then 'timeout' else 'revealed' end;
    select min(publication_date) into puzzle from (
      select publication_date from public.discovery_schedule where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
      union all select publication_date from public.discovery_publication_history where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
      union all select publication_date from public.discovery_daily_set_items where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
    ) dates;
    insert into public.discovery_completions(user_id, discovery_id, revision, event_id, mode, option_id, occurred_at, local_date, time_zone,elapsed_ms,outcome,puzzle_date,set_position)
      values (p_user, (e->>'discoveryId')::uuid, (e->>'revision')::int, (e->>'eventId')::uuid, e->>'mode', e->>'optionId', (e->>'occurredAt')::timestamptz, (e->>'localDate')::date, e->>'timeZone',elapsed,result_outcome,puzzle,(select position from public.discovery_daily_set_items where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int))
      on conflict (user_id, discovery_id) do nothing;
    select * into existing from public.discovery_completions where user_id = p_user and discovery_id = (e->>'discoveryId')::uuid;
    results := results || jsonb_build_array(jsonb_build_object('eventId',e->>'eventId','status','accepted','completion',to_jsonb(existing)));
  end loop;
  return results;
end $$;
grant execute on function public.discovery_daily_claim(date,jsonb,uuid),public.discovery_daily_begin(date,integer,uuid,text),public.discovery_daily_finish(date,integer,uuid,integer,jsonb,jsonb,jsonb),public.discovery_daily_publish(date,uuid,jsonb),public.discovery_daily_week_context(date),public.discovery_daily_retry(date,jsonb,text,text) to service_role;
comment on table public.discovery_daily_sets is 'Immutable daily three-question publications; generation enabled.';
commit;
