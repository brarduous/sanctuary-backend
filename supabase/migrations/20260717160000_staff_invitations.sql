begin;
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  email text not null,
  role public.staff_role not null,
  campus_id bigint references public.campuses(id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index staff_invitations_pending_email_scope on public.staff_invitations(congregation_id,lower(email),coalesce(campus_id,0)) where accepted_at is null;
alter table public.staff_invitations enable row level security;
alter table public.staff_invitations force row level security;
create policy staff_invitations_managers_read on public.staff_invitations for select to authenticated using (public.has_congregation_capability(congregation_id,'staff.manage'));
revoke all on public.staff_invitations from anon;
grant select on public.staff_invitations to authenticated;
commit;
