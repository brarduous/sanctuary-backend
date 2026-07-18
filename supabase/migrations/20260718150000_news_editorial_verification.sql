begin;

create table if not exists public.news_article_sources (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  publisher text not null,
  title text not null,
  url text not null,
  published_at timestamptz,
  source_type text not null default 'reporting' check (source_type in ('primary_reporting','additional_reporting','official_document','commentary','reporting')),
  is_independent boolean not null default false,
  extracted_text_checksum text,
  created_at timestamptz not null default now(),
  unique (outlook_id, url)
);

create table if not exists public.news_claims (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  claim_text text not null,
  materiality smallint not null check (materiality between 1 and 5),
  status text not null check (status in ('supported','partially_supported','unverifiable','unsupported','contradicted')),
  rationale text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.news_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.news_claims(id) on delete cascade,
  source_id uuid not null references public.news_article_sources(id) on delete cascade,
  support_type text not null check (support_type in ('supports','partially_supports','context_only','contradicts')),
  evidence_summary text not null,
  created_at timestamptz not null default now(),
  unique (claim_id, source_id)
);

create table if not exists public.news_score_versions (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  version integer not null check (version > 0),
  truthfulness_score smallint not null check (truthfulness_score between 0 and 100),
  truthfulness_band text not null,
  assessment_summary text not null,
  confidence_score smallint not null check (confidence_score between 0 and 100),
  confidence_factors jsonb not null default '{}'::jsonb,
  unresolved_evidence_gaps jsonb not null default '[]'::jsonb,
  assessed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (outlook_id, version)
);

create table if not exists public.news_editorial_revisions (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null,
  change_summary text not null,
  editor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (outlook_id, version)
);

create table if not exists public.news_review_decisions (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  revision_id uuid references public.news_editorial_revisions(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reviewer_display_name text not null check (char_length(trim(reviewer_display_name)) between 2 and 120),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.news_correction_reports (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint references public.scriptural_outlooks(id) on delete set null,
  article_url text not null,
  disputed_statement text not null check (char_length(disputed_statement) between 10 and 2000),
  explanation text not null check (char_length(explanation) between 20 and 5000),
  evidence_url text,
  reply_email text,
  status text not null default 'open' check (status in ('open','investigating','resolved','rejected','spam')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.news_correction_notices (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint not null references public.scriptural_outlooks(id) on delete cascade,
  report_id uuid references public.news_correction_reports(id) on delete set null,
  notice text not null check (char_length(notice) between 20 and 2000),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now()
);

create index if not exists idx_news_sources_outlook on public.news_article_sources(outlook_id);
create index if not exists idx_news_claims_outlook on public.news_claims(outlook_id);
create index if not exists idx_news_scores_outlook_version on public.news_score_versions(outlook_id, version desc);
create index if not exists idx_news_corrections_status on public.news_correction_reports(status, created_at desc);
create index if not exists idx_news_notices_outlook on public.news_correction_notices(outlook_id, published_at desc);

alter table public.news_article_sources enable row level security;
alter table public.news_article_sources force row level security;
alter table public.news_claims enable row level security;
alter table public.news_claims force row level security;
alter table public.news_claim_evidence enable row level security;
alter table public.news_claim_evidence force row level security;
alter table public.news_score_versions enable row level security;
alter table public.news_score_versions force row level security;
alter table public.news_editorial_revisions enable row level security;
alter table public.news_editorial_revisions force row level security;
alter table public.news_review_decisions enable row level security;
alter table public.news_review_decisions force row level security;
alter table public.news_correction_reports enable row level security;
alter table public.news_correction_reports force row level security;
alter table public.news_correction_notices enable row level security;
alter table public.news_correction_notices force row level security;

revoke all on public.news_article_sources, public.news_claims, public.news_claim_evidence,
  public.news_score_versions, public.news_editorial_revisions, public.news_review_decisions,
  public.news_correction_reports, public.news_correction_notices from anon, authenticated;
grant all on public.news_article_sources, public.news_claims, public.news_claim_evidence,
  public.news_score_versions, public.news_editorial_revisions, public.news_review_decisions,
  public.news_correction_reports, public.news_correction_notices to service_role;

create or replace function public.reject_news_immutable_change() returns trigger
language plpgsql as $$ begin raise exception 'news editorial history is immutable'; end $$;
drop trigger if exists news_score_versions_immutable on public.news_score_versions;
create trigger news_score_versions_immutable before update or delete on public.news_score_versions for each row execute function public.reject_news_immutable_change();
drop trigger if exists news_editorial_revisions_immutable on public.news_editorial_revisions;
create trigger news_editorial_revisions_immutable before update or delete on public.news_editorial_revisions for each row execute function public.reject_news_immutable_change();
drop trigger if exists news_review_decisions_immutable on public.news_review_decisions;
create trigger news_review_decisions_immutable before update or delete on public.news_review_decisions for each row execute function public.reject_news_immutable_change();
drop trigger if exists news_correction_notices_immutable on public.news_correction_notices;
create trigger news_correction_notices_immutable before update or delete on public.news_correction_notices for each row execute function public.reject_news_immutable_change();

commit;
