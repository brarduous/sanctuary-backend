-- A daily claim prevents duplicate spending across overlapping or repeated cron invocations.
create table if not exists public.news_daily_generation_runs (
  edition_date date primary key,
  status text not null check (status in ('started','completed','failed')),
  tokens integer,
  error text,
  created_at timestamptz not null default now()
);
alter table public.news_daily_generation_runs enable row level security;
revoke all on public.news_daily_generation_runs from anon, authenticated;
grant all on public.news_daily_generation_runs to service_role;
alter table public.daily_news_synopses add column if not exists sources jsonb not null default '[]'::jsonb;
