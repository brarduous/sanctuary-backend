begin;

alter table public.congregations
  add column if not exists onboarding_reset_at timestamptz;

create table if not exists public.pastor_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  congregation_id integer references public.congregations(congregation_id) on delete set null,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived', 'deleted')),
  profile jsonb not null,
  source_hashes text[] not null default '{}',
  rights_attested boolean not null default false,
  temporary_evaluation boolean not null default false,
  retention_until timestamptz,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  deleted_at timestamptz,
  unique(user_id, version)
);

create unique index if not exists pastor_voice_profiles_one_active_per_user
  on public.pastor_voice_profiles(user_id)
  where status = 'active';

create table if not exists public.pastor_voice_sources (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.pastor_voice_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sermon_id integer references public.sermons(sermon_id) on delete set null,
  title text not null,
  checksum_sha256 text not null,
  mime_type text not null,
  rights_basis text not null,
  temporary_evaluation boolean not null default false,
  retention_until timestamptz,
  word_count integer not null,
  created_at timestamptz not null default now(),
  unique(profile_id, checksum_sha256)
);

alter table public.ai_generation_runs
  add column if not exists voice_profile_id uuid references public.pastor_voice_profiles(id) on delete set null,
  add column if not exists voice_treatment text,
  add column if not exists prompt_version text,
  add column if not exists input_token_count integer,
  add column if not exists output_token_count integer,
  add column if not exists duration_ms integer,
  add column if not exists estimated_cost_usd numeric(12,6);

alter table public.pastor_voice_profiles enable row level security;
alter table public.pastor_voice_profiles force row level security;
alter table public.pastor_voice_sources enable row level security;
alter table public.pastor_voice_sources force row level security;

drop policy if exists pastor_voice_profiles_read_own on public.pastor_voice_profiles;
create policy pastor_voice_profiles_read_own on public.pastor_voice_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists pastor_voice_sources_read_own on public.pastor_voice_sources;
create policy pastor_voice_sources_read_own on public.pastor_voice_sources
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.pastor_voice_profiles, public.pastor_voice_sources from anon, authenticated;
grant select on public.pastor_voice_profiles, public.pastor_voice_sources to authenticated;
grant all on public.pastor_voice_profiles, public.pastor_voice_sources to service_role;

comment on table public.pastor_voice_profiles is
  'Versioned, server-owned rhetorical and pastoral preferences derived from authorized samples.';
comment on table public.pastor_voice_sources is
  'Source provenance and retention metadata. Manuscript text remains in the linked private sermon record.';

commit;
