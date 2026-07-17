begin;
create table public.api_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  unique(actor_user_id,operation,idempotency_key)
);
alter table public.api_idempotency_records enable row level security;
alter table public.api_idempotency_records force row level security;
revoke all on public.api_idempotency_records from anon,authenticated;
create unique index check_ins_one_active_child_event on public.check_ins(event_id,profile_id) where status='active' and deleted_at is null;
commit;
