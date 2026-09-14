-- Studio owns editable studies. Clergy owns congregation delivery of immutable versions.
create table if not exists public.bible_study_versions (
  id uuid primary key default gen_random_uuid(),
  study_id bigint not null references public.bible_studies(study_id) on delete cascade,
  version_number integer not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  content_hash text not null,
  status text not null default 'ready' check (status in ('ready','superseded')),
  created_at timestamptz not null default now(),
  unique (study_id, version_number),
  unique (study_id, content_hash)
);

create table if not exists public.bible_study_deliveries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.bible_study_versions(id),
  congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  created_by uuid not null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','scheduled','published','cancelled','unpublished')),
  recipient_scope jsonb not null default '{"type":"all"}'::jsonb,
  placement text not null default 'church_home' check (placement in ('church_home','study_library','featured')),
  notifications jsonb not null default '{"in_app":true,"push":false,"email":false}'::jsonb,
  available_from timestamptz,
  available_until timestamptz,
  published_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until > available_from)
);
create index if not exists bible_study_deliveries_congregation_status_idx on public.bible_study_deliveries(congregation_id, status, available_from);

alter table public.bible_study_versions enable row level security;
alter table public.bible_study_deliveries enable row level security;
revoke all on public.bible_study_versions from anon, authenticated;
revoke all on public.bible_study_deliveries from anon, authenticated;
grant select, insert, update on public.bible_study_versions to service_role;
grant select, insert, update on public.bible_study_deliveries to service_role;

comment on table public.bible_study_versions is 'Immutable Studio-authored snapshots available for an explicit Clergy handoff.';
comment on table public.bible_study_deliveries is 'Congregation-scoped audience, placement, notification, and availability decisions owned by Clergy.';
