begin;

create table if not exists public.sermon_revisions (
  revision_id bigint generated always as identity primary key,
  sermon_id integer not null references public.sermons(sermon_id) on delete cascade,
  user_id uuid not null references auth.users(id),
  title text,
  date_preached date,
  sermon_outline jsonb,
  sermon_body text,
  illustration text,
  key_takeaways jsonb,
  scripture text,
  status text,
  tags text[],
  content_format text,
  target_duration_min integer,
  actual_duration_min integer,
  distribution_channel text,
  revised_at timestamptz not null default now()
);

comment on table public.sermon_revisions is
  'Append-only snapshots of the prior sermon state, captured before meaningful updates.';

create index if not exists sermon_revisions_sermon_revised_at_idx
  on public.sermon_revisions (sermon_id, revised_at desc);

create index if not exists sermon_revisions_user_revised_at_idx
  on public.sermon_revisions (user_id, revised_at desc);

alter table public.sermon_revisions enable row level security;

drop policy if exists "Users can read their own sermon revisions" on public.sermon_revisions;
create policy "Users can read their own sermon revisions"
  on public.sermon_revisions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.sermon_revisions from anon, authenticated;
grant select on table public.sermon_revisions to authenticated;
grant all on table public.sermon_revisions to service_role;
grant usage, select on sequence public.sermon_revisions_revision_id_seq to service_role;

create or replace function public.capture_sermon_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if row(
    old.title,
    old.date_preached,
    old.sermon_outline,
    old.sermon_body,
    old.illustration,
    old.key_takeaways,
    old.scripture,
    old.status,
    old.tags,
    old.content_format,
    old.target_duration_min,
    old.actual_duration_min,
    old.distribution_channel
  ) is distinct from row(
    new.title,
    new.date_preached,
    new.sermon_outline,
    new.sermon_body,
    new.illustration,
    new.key_takeaways,
    new.scripture,
    new.status,
    new.tags,
    new.content_format,
    new.target_duration_min,
    new.actual_duration_min,
    new.distribution_channel
  ) then
    insert into public.sermon_revisions (
      sermon_id,
      user_id,
      title,
      date_preached,
      sermon_outline,
      sermon_body,
      illustration,
      key_takeaways,
      scripture,
      status,
      tags,
      content_format,
      target_duration_min,
      actual_duration_min,
      distribution_channel,
      revised_at
    ) values (
      old.sermon_id,
      old.user_id,
      old.title,
      old.date_preached,
      old.sermon_outline,
      old.sermon_body,
      old.illustration,
      old.key_takeaways,
      old.scripture,
      old.status,
      old.tags,
      old.content_format,
      old.target_duration_min,
      old.actual_duration_min,
      old.distribution_channel,
      coalesce(old.updated_at, old.created_at, now())
    );
  end if;

  return new;
end;
$$;

revoke all on function public.capture_sermon_revision() from public;

drop trigger if exists capture_sermon_revision_before_update on public.sermons;
create trigger capture_sermon_revision_before_update
before update on public.sermons
for each row
execute function public.capture_sermon_revision();

commit;
