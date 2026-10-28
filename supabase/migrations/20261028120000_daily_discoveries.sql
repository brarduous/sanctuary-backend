-- Additive only. New objects remain private; all public projections pass through the API.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create table public.discoveries (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{2,79}$'),
  withdrawn boolean not null default false,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  correction_notice text,
  created_at timestamptz not null default now()
);
create table public.discovery_revisions (
  discovery_id uuid not null references public.discoveries(id) on delete cascade,
  revision integer not null check (revision > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (discovery_id, revision)
);
create table public.discovery_reviews (
  discovery_id uuid not null,
  revision integer not null,
  reviewer_id uuid references auth.users(id) on delete set null,
  note text not null check (length(btrim(note)) >= 40),
  attestations jsonb not null,
  reviewed_at timestamptz not null default now(),
  primary key (discovery_id, revision),
  foreign key (discovery_id, revision) references public.discovery_revisions(discovery_id, revision),
  check (attestations @> '{"sourcesReadInContext":true,"everyClaimSupported":true,"oneUnambiguousAnswer":true,"scopeAndUncertaintyAccurate":true,"rightsChecked":true}')
);
create table public.discovery_schedule (
  publication_date date not null,
  locale text not null default 'en' check (locale = 'en'),
  discovery_id uuid not null,
  revision integer not null,
  primary key (publication_date, locale),
  foreign key (discovery_id, revision) references public.discovery_reviews(discovery_id, revision)
);
create index discovery_schedule_item on public.discovery_schedule(discovery_id, publication_date);
-- Preserve revisions that were already released before a correction/reschedule.
-- A canceled future schedule does not become publication history.
create table public.discovery_publication_history (
  publication_date date not null,
  locale text not null,
  discovery_id uuid not null,
  revision integer not null,
  primary key (discovery_id, revision, publication_date, locale),
  foreign key (discovery_id, revision) references public.discovery_reviews(discovery_id, revision)
);
create function public.discovery_archive_publication() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.publication_date <= (now() at time zone 'Pacific/Kiritimati')::date then
    insert into public.discovery_publication_history values (old.publication_date, old.locale, old.discovery_id, old.revision) on conflict do nothing;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger discovery_preserve_publication before update or delete on public.discovery_schedule for each row execute function public.discovery_archive_publication();
create table public.discovery_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_id uuid not null,
  revision integer not null,
  event_id uuid not null,
  mode text not null check (mode in ('answered','revealed')),
  option_id text,
  occurred_at timestamptz not null,
  local_date date not null,
  time_zone text not null,
  received_at timestamptz not null default now(),
  primary key (user_id, discovery_id),
  unique (user_id, event_id),
  foreign key (discovery_id, revision) references public.discovery_reviews(discovery_id, revision),
  check ((mode = 'answered' and option_id is not null) or (mode = 'revealed' and option_id is null))
);
create table public.discovery_runtime_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
  internal_user_ids uuid[] not null default '{}'
);
insert into public.discovery_runtime_settings(singleton) values (true);
create table public.discovery_issue_reports (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid not null,
  revision integer not null,
  user_id uuid references auth.users(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 10 and 2000),
  created_at timestamptz not null default now(),
  foreign key (discovery_id, revision) references public.discovery_revisions(discovery_id, revision)
);
create table public.discovery_metrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  discovery_id uuid not null references public.discoveries(id),
  event text not null check (event in ('card_viewed','question_opened','answer_committed','direct_reveal','explanation_viewed','source_opened','share_initiated','app_cta_clicked')),
  platform text not null check (platform in ('mobile','web')),
  created_at timestamptz not null default now()
);
-- No user/device identifier or answer text is stored with these aggregate events.

create function public.discovery_immutable() returns trigger language plpgsql as $$
begin
  -- Allow FK SET NULL when a reviewer/author deletes their account, nothing else.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'reviewer_id' - 'created_by') = (to_jsonb(old) - 'reviewer_id' - 'created_by') then
    if (to_jsonb(new)->'reviewer_id' is null or to_jsonb(new)->'reviewer_id' = 'null'::jsonb or to_jsonb(new)->'reviewer_id' = to_jsonb(old)->'reviewer_id')
      and (to_jsonb(new)->'created_by' is null or to_jsonb(new)->'created_by' = 'null'::jsonb or to_jsonb(new)->'created_by' = to_jsonb(old)->'created_by') then return new; end if;
  end if;
  raise exception 'Discovery content and review history are immutable; create a new revision';
end $$;
create trigger discovery_revisions_immutable before update or delete on public.discovery_revisions for each row execute function public.discovery_immutable();
create trigger discovery_reviews_immutable before update or delete on public.discovery_reviews for each row execute function public.discovery_immutable();

create function public.discovery_require_admin(actor uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.user_profiles where user_id = actor and role = 'admin') then raise exception 'Global admin required' using errcode = '42501'; end if;
end $$;
create function public.discovery_import(p_id uuid, p_slug text, p_content jsonb, p_actor uuid) returns integer language plpgsql security definer set search_path = public as $$
declare next_revision integer;
begin
  perform public.discovery_require_admin(p_actor);
  insert into public.discoveries(id, slug) values (p_id, p_slug) on conflict (id) do nothing;
  perform 1 from public.discoveries where id = p_id for update;
  if not exists(select 1 from public.discoveries where id = p_id and slug = p_slug) then raise exception 'Stable slug cannot change'; end if;
  select coalesce(max(revision),0)+1 into next_revision from public.discovery_revisions where discovery_id = p_id;
  insert into public.discovery_revisions(discovery_id, revision, content, created_by) values (p_id, next_revision, p_content, p_actor);
  return next_revision;
end $$;
create function public.discovery_approve(p_id uuid, p_revision integer, p_actor uuid, p_note text, p_attestations jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.discovery_require_admin(p_actor);
  if not exists(select 1 from public.discovery_revisions where discovery_id = p_id and revision = p_revision) then raise exception 'Revision not found'; end if;
  insert into public.discovery_reviews(discovery_id, revision, reviewer_id, note, attestations) values (p_id, p_revision, p_actor, p_note, p_attestations);
end $$;
create function public.discovery_schedule_item(p_id uuid, p_revision integer, p_date date, p_actor uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.discovery_require_admin(p_actor);
  if p_date < (now() at time zone 'UTC')::date then raise exception 'Past publication dates cannot be reassigned'; end if;
  if exists(select 1 from public.discoveries where id = p_id and withdrawn) then raise exception 'Withdrawn discovery cannot be scheduled'; end if;
  -- The FK requires a human approval for this exact, immutable revision.
  insert into public.discovery_schedule(publication_date, discovery_id, revision) values (p_date, p_id, p_revision)
    on conflict (publication_date, locale) do update set discovery_id = excluded.discovery_id, revision = excluded.revision;
end $$;
create function public.discovery_restore(p_id uuid, p_revision integer, p_actor uuid, p_notice text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.discovery_require_admin(p_actor);
  if length(btrim(p_notice)) < 10 then raise exception 'A public correction notice is required'; end if;
  perform 1 from public.discoveries where id = p_id and withdrawn for update;
  if not found then raise exception 'Discovery is not withdrawn'; end if;
  if not exists(select 1 from public.discovery_reviews where discovery_id = p_id and revision = p_revision)
    or exists(select 1 from public.discovery_schedule where discovery_id = p_id and revision >= p_revision)
    or exists(select 1 from public.discovery_publication_history where discovery_id = p_id and revision >= p_revision) then
    raise exception 'Restoration requires a newly reviewed revision';
  end if;
  update public.discovery_schedule set revision = p_revision where discovery_id = p_id;
  update public.discoveries set withdrawn = false, correction_notice = p_notice, withdrawn_at = null, withdrawn_by = null where id = p_id;
end $$;
create function public.discovery_complete(p_user uuid, p_events jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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

-- Forced RLS and no direct-client grants. Only the authenticated Express service
-- may read projections, act as the verified owner, or invoke editorial functions.
alter table public.discoveries enable row level security;
alter table public.discoveries force row level security;
alter table public.discovery_revisions enable row level security;
alter table public.discovery_revisions force row level security;
alter table public.discovery_reviews enable row level security;
alter table public.discovery_reviews force row level security;
alter table public.discovery_schedule enable row level security;
alter table public.discovery_schedule force row level security;
alter table public.discovery_publication_history enable row level security;
alter table public.discovery_publication_history force row level security;
alter table public.discovery_completions enable row level security;
alter table public.discovery_completions force row level security;
alter table public.discovery_runtime_settings enable row level security;
alter table public.discovery_runtime_settings force row level security;
alter table public.discovery_issue_reports enable row level security;
alter table public.discovery_issue_reports force row level security;
alter table public.discovery_metrics enable row level security;
alter table public.discovery_metrics force row level security;
revoke all on public.discoveries, public.discovery_revisions, public.discovery_reviews, public.discovery_schedule, public.discovery_publication_history, public.discovery_completions, public.discovery_runtime_settings, public.discovery_issue_reports, public.discovery_metrics from anon, authenticated;
grant all on public.discoveries, public.discovery_revisions, public.discovery_reviews, public.discovery_schedule, public.discovery_publication_history, public.discovery_completions, public.discovery_runtime_settings, public.discovery_issue_reports, public.discovery_metrics to service_role;
revoke all on function public.discovery_require_admin(uuid), public.discovery_import(uuid,text,jsonb,uuid), public.discovery_approve(uuid,integer,uuid,text,jsonb), public.discovery_schedule_item(uuid,integer,date,uuid), public.discovery_restore(uuid,integer,uuid,text), public.discovery_complete(uuid,jsonb), public.discovery_immutable(), public.discovery_archive_publication() from public, anon, authenticated;
grant execute on function public.discovery_import(uuid,text,jsonb,uuid), public.discovery_approve(uuid,integer,uuid,text,jsonb), public.discovery_schedule_item(uuid,integer,date,uuid), public.discovery_restore(uuid,integer,uuid,text), public.discovery_complete(uuid,jsonb) to service_role;
commit;
