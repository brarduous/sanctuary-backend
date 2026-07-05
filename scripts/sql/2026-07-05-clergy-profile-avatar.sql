-- Adds editable clergy profile avatar support.

insert into storage.buckets (id, name, public)
values ('clergy-profile-avatars', 'clergy-profile-avatars', true)
on conflict (id) do update set public = excluded.public;

alter table public.user_profiles
  add column if not exists avatar_url text;
