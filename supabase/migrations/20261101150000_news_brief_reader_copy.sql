-- Existing app versions keep reading synopsis/scripture/prayer.
alter table public.daily_news_synopses
  add column if not exists details text,
  add column if not exists stories jsonb not null default '[]'::jsonb;
