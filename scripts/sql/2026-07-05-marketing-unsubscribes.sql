-- Lightweight marketing unsubscribe list.

create table if not exists public.marketing_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  unsubscribed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_unsubscribes enable row level security;

drop policy if exists "Service role manages marketing unsubscribes" on public.marketing_unsubscribes;
create policy "Service role manages marketing unsubscribes"
  on public.marketing_unsubscribes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
