-- Stores the email allowlist for Sanctuary Admin access.
-- The backend and admin dashboard use the Supabase service role to read this table.

create table if not exists admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table admin_emails enable row level security;

insert into admin_emails (email)
values
  ('brandon.arduous@gmail.com'),
  ('support@sanctuaryapp.us')
on conflict (email) do nothing;

update user_profiles
set role = 'admin'
where user_id in (
  select id
  from auth.users
  where lower(email) in (select email from admin_emails)
);
