-- Keep complimentary ambassador access distinct from Stripe subscriptions and
-- from older, unclassified whitelist entries.
alter table public.whitelist
  add column if not exists grant_type text not null default 'legacy',
  add column if not exists granted_by uuid references auth.users(id);

alter table public.whitelist
  add constraint whitelist_grant_type_check
  check (grant_type in ('legacy', 'ambassador'));

create index if not exists whitelist_grant_type_idx
  on public.whitelist (grant_type);

-- Older schema grants let client roles write this table directly. Complimentary
-- access must only be granted by the service-role-backed admin endpoint.
revoke all on public.whitelist from anon, authenticated;
alter table public.whitelist enable row level security;
