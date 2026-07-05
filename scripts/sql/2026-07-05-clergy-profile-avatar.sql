-- Adds editable clergy profile avatar support.

insert into storage.buckets (id, name, public)
values ('clergy-profile-avatars', 'clergy-profile-avatars', true)
on conflict (id) do update set public = excluded.public;

alter table public.user_profiles
  add column if not exists avatar_url text;

update public.user_profiles
set avatar_url = user_preferences->>'avatar_url'
where avatar_url is null
  and user_preferences ? 'avatar_url';
