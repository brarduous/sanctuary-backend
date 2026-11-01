begin;
create table if not exists public.devotional_quality_runtime (
  id integer primary key check (id = 1),
  revision integer not null default 0,
  general_model text not null default 'gpt-6.1-sol',
  personalized_model text not null default 'gpt-6.1-sol',
  general_rules jsonb not null default '[]',
  personalized_rules jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
-- Preserve the deployed models until the first matched evaluation earns an upgrade.
insert into public.devotional_quality_runtime(id,general_model,personalized_model)
values (1,'gpt-5-mini','gpt-4o') on conflict do nothing;
create table if not exists public.devotional_quality_runs (
  week_start date primary key,
  status text not null check (status in ('running','completed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  report jsonb not null default '{}'
);
alter table public.devotional_quality_runtime enable row level security;
alter table public.devotional_quality_runs enable row level security;
revoke all on public.devotional_quality_runtime, public.devotional_quality_runs from public, anon, authenticated;
grant all on public.devotional_quality_runtime, public.devotional_quality_runs to service_role;
create or replace function public.claim_devotional_quality_week(p_week date)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed integer;
begin
  insert into devotional_quality_runs(week_start,status) values(p_week,'running')
  on conflict(week_start) do update set status='running', started_at=now(), completed_at=null
  where devotional_quality_runs.status='failed'
     or (devotional_quality_runs.status='running' and devotional_quality_runs.started_at < now()-interval '2 hours');
  get diagnostics claimed = row_count;
  return claimed = 1;
end; $$;
revoke all on function public.claim_devotional_quality_week(date) from public, anon, authenticated;
grant execute on function public.claim_devotional_quality_week(date) to service_role;
create or replace function public.finish_devotional_quality_week(p_week date, p_revision integer, p_report jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from devotional_quality_runtime where id=1 and revision=p_revision for update;
  if not found then raise exception 'Devotional runtime changed concurrently'; end if;
  perform 1 from devotional_quality_runs where week_start=p_week and status='running' for update;
  if not found then raise exception 'Devotional review is not running'; end if;
  if jsonb_array_length(p_report->'changes') > 0 then
    update devotional_quality_runtime set
      general_model=p_report->'after'->>'general_model',
      personalized_model=p_report->'after'->>'personalized_model',
      general_rules=p_report->'after'->'general_rules',
      personalized_rules=p_report->'after'->'personalized_rules',
      revision=p_revision+1, updated_at=now() where id=1;
  end if;
  update devotional_quality_runs set status='completed', completed_at=now(), report=p_report where week_start=p_week;
end; $$;
revoke all on function public.finish_devotional_quality_week(date,integer,jsonb) from public, anon, authenticated;
grant execute on function public.finish_devotional_quality_week(date,integer,jsonb) to service_role;
commit;
