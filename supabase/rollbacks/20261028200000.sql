begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function public.discovery_complete(p_user uuid, p_events jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; c jsonb; existing public.discovery_completions; results jsonb := '[]'::jsonb;
begin
  if p_user is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then raise exception 'Invalid completion batch'; end if;
  for e in select value from jsonb_array_elements(p_events) loop
    -- Even approved but unscheduled drafts and future-only revisions cannot earn completion.
    select r.content into c from public.discovery_revisions r
      join public.discoveries d on d.id = r.discovery_id
      where r.discovery_id = (e->>'discoveryId')::uuid and r.revision = (e->>'revision')::int and not d.withdrawn
      and (exists(select 1 from public.discovery_schedule s where s.discovery_id = r.discovery_id and s.revision = r.revision and s.publication_date <= (now() at time zone 'Pacific/Kiritimati')::date)
        or exists(select 1 from public.discovery_publication_history h where h.discovery_id = r.discovery_id and h.revision = r.revision));
    if c is null then
      results := results || jsonb_build_array(jsonb_build_object('eventId', e->>'eventId', 'status','unavailable'));
      continue;
    end if;
    if e->>'mode' not in ('answered','revealed') or (e->>'mode' = 'answered' and not exists(select 1 from jsonb_array_elements(c->'choices') o where o->>'id' = e->>'optionId'))
      or (e->>'mode' = 'revealed' and e->>'optionId' is not null) then raise exception 'Invalid answer'; end if;
    insert into public.discovery_completions(user_id, discovery_id, revision, event_id, mode, option_id, occurred_at, local_date, time_zone)
      values (p_user, (e->>'discoveryId')::uuid, (e->>'revision')::int, (e->>'eventId')::uuid, e->>'mode', e->>'optionId', (e->>'occurredAt')::timestamptz, (e->>'localDate')::date, e->>'timeZone')
      on conflict (user_id, discovery_id) do nothing;
    select * into existing from public.discovery_completions where user_id = p_user and discovery_id = (e->>'discoveryId')::uuid;
    results := results || jsonb_build_array(jsonb_build_object('eventId',e->>'eventId','status','accepted','completion',to_jsonb(existing)));
  end loop;
  return results;
end $$;

alter table public.discovery_completions drop column puzzle_date, drop column outcome, drop column elapsed_ms;
commit;
