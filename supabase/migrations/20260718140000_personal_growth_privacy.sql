create table if not exists public.personal_growth_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  focus_areas jsonb not null default '[]'::jsonb,
  improvement_areas jsonb not null default '[]'::jsonb,
  purpose text not null default 'Private self-directed ministry growth and wellbeing reflection',
  visibility text not null default 'self' check (visibility = 'self'),
  retention_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_growth_profiles enable row level security;
alter table public.personal_growth_profiles force row level security;
revoke all on public.personal_growth_profiles from anon, authenticated;
comment on table public.personal_growth_profiles is
  'Sensitive self-reflection data. Service-role access only; owner API supports purpose disclosure, export, and deletion.';
