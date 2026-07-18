create table if not exists public.safeguarding_incidents (
  id uuid primary key default gen_random_uuid(),
  congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  check_in_id uuid references public.check_ins(id) on delete set null,
  subject_profile_id uuid references public.church_crm_profiles(id) on delete set null,
  incident_type text not null check (incident_type in ('injury','medical','guardian_dispute','missing_child','behavior','facility','other')),
  severity text not null check (severity in ('low','moderate','high','critical')),
  summary text not null,
  actions_taken text not null,
  status text not null default 'open' check (status in ('open','closed')),
  occurred_at timestamptz not null,
  reported_by uuid not null references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  outcome text,
  retention_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists safeguarding_incidents_tenant_status_idx on public.safeguarding_incidents(congregation_id,status,occurred_at desc);
alter table public.safeguarding_incidents enable row level security;
alter table public.safeguarding_incidents force row level security;
revoke all on public.safeguarding_incidents from anon, authenticated;
comment on table public.safeguarding_incidents is 'Restricted safeguarding operations record. Service-role API requires check_in.override and emits immutable audit events.';
