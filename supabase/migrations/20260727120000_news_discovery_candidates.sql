begin;

create table if not exists public.news_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  title text not null,
  publisher text not null,
  published_at timestamptz,
  thumbnail_url text,
  discovery_provider text,
  discovery_rank integer check (discovery_rank is null or discovery_rank > 0),
  discovery_match_score numeric(5,4),
  evidence_status text not null default 'awaiting_evidence'
    check (evidence_status in ('awaiting_evidence','eligible','generated','dismissed')),
  evidence_reason text,
  evidence_summary jsonb not null default '{}'::jsonb,
  source_package jsonb not null default '[]'::jsonb,
  first_discovered_at timestamptz not null default now(),
  last_discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_discovery_candidates_status_rank
  on public.news_discovery_candidates(evidence_status, discovery_rank nulls last, last_discovered_at desc);

alter table public.news_discovery_candidates enable row level security;
alter table public.news_discovery_candidates force row level security;
revoke all on public.news_discovery_candidates from anon, authenticated;
grant all on public.news_discovery_candidates to service_role;

commit;
