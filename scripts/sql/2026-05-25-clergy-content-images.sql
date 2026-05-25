-- Store AI-generated illustration images for clergy sermons and Bible studies.
-- Run this against Supabase SQL editor or your migration runner before deploying
-- the backend changes that write these columns.

insert into storage.buckets (id, name, public)
values ('clergy-content-images', 'clergy-content-images', true)
on conflict (id) do update set public = excluded.public;

alter table public.sermons
  add column if not exists illustration_prompt text,
  add column if not exists illustration_image_url text,
  add column if not exists thumbnail_url text;

alter table public.bible_studies
  add column if not exists illustration_prompt text,
  add column if not exists illustration_image_url text,
  add column if not exists thumbnail_url text;
