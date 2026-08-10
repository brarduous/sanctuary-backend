begin;

create table if not exists public.news_story_clusters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  canonical_outlook_id bigint unique references public.scriptural_outlooks(id) on delete set null,
  status text not null default 'provisional' check (status in ('provisional','corroborated','developing','archived')),
  first_reported_at timestamptz,
  latest_reported_at timestamptz,
  representative_image_url text,
  clustering_metadata jsonb not null default '{}'::jsonb,
  source_comparison jsonb not null default '[]'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  content_version integer not null default 1 check (content_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scriptural_outlooks
  add column if not exists story_cluster_id uuid references public.news_story_clusters(id) on delete set null,
  add column if not exists superseded_by_outlook_id bigint references public.scriptural_outlooks(id) on delete set null;

alter table public.news_article_sources
  add column if not exists story_cluster_id uuid references public.news_story_clusters(id) on delete cascade;

create index if not exists idx_news_clusters_latest on public.news_story_clusters(latest_reported_at desc);
create index if not exists idx_outlooks_story_cluster on public.scriptural_outlooks(story_cluster_id);
create index if not exists idx_outlooks_canonical_feed on public.scriptural_outlooks(publish_date desc) where superseded_by_outlook_id is null;
create index if not exists idx_news_sources_cluster on public.news_article_sources(story_cluster_id);

alter table public.news_story_clusters enable row level security;
alter table public.news_story_clusters force row level security;
revoke all on public.news_story_clusters from anon, authenticated;
grant all on public.news_story_clusters to service_role;

commit;
