create table if not exists public.trial_guidance_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'marketing_try_guidance',
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  marketing_consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trial_guidance_leads enable row level security;

comment on table public.trial_guidance_leads is
  'Email-only opt-ins from the public guidance trial. Sensitive submitted situations and generated guidance are intentionally not retained.';
