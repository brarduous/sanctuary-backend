-- Sermon-to-Sanctuary Phase 1. Additive, auditable, and congregation scoped.

alter table public.sermons
  add column if not exists congregation_id integer references public.congregations(congregation_id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_url text,
  add column if not exists source_file_name text,
  add column if not exists source_storage_path text,
  add column if not exists transcript text,
  add column if not exists transcript_status text not null default 'ready',
  add column if not exists transcript_error text,
  add column if not exists transcript_timestamps jsonb not null default '[]'::jsonb,
  add column if not exists extracted_scripture_references jsonb not null default '[]'::jsonb,
  add column if not exists source_processed_at timestamptz;

alter table public.congregations
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

create table if not exists public.sermon_content_packs (
  id uuid primary key default gen_random_uuid(),
  sermon_id integer not null references public.sermons(sermon_id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft','generating','in_review','approved','partially_published','published','failed','archived')),
  generation_version integer not null default 1,
  generation_status jsonb not null default '{}'::jsonb,
  generation_error text,
  source_snapshot jsonb not null default '{}'::jsonb,
  feature_version text not null default 'sermon_to_sanctuary_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sermon_id, congregation_id)
);

create table if not exists public.content_pack_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.sermon_content_packs(id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  item_type text not null check (item_type in ('sermon_summary','key_ideas','daily_devotional','guided_prayer','small_group_guide','family_prompts','member_reflection','congregational_response','email_draft','social_caption','shareable_quote')),
  sequence integer not null default 1,
  title text not null,
  content jsonb not null,
  status text not null default 'draft' check (status in ('draft','in_review','approved','rejected','published')),
  generation_version integer not null default 1,
  revision integer not null default 1,
  source_excerpts jsonb not null default '[]'::jsonb,
  scripture_references jsonb not null default '[]'::jsonb,
  review_warnings jsonb not null default '[]'::jsonb,
  generated_by text,
  generated_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, item_type, sequence, revision)
);

create table if not exists public.content_pack_item_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_pack_items(id) on delete cascade,
  pack_id uuid not null references public.sermon_content_packs(id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  revision integer not null,
  title text not null,
  content jsonb not null,
  status text not null,
  source_excerpts jsonb not null default '[]'::jsonb,
  scripture_references jsonb not null default '[]'::jsonb,
  changed_by uuid references auth.users(id),
  change_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.church_content_publications (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.sermon_content_packs(id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','scheduled','published','cancelled','unpublished')),
  starts_at timestamptz not null,
  daily_release_time time not null default '08:00',
  time_zone text not null default 'America/New_York',
  recipient_scope jsonb not null default '{"type":"all"}'::jsonb,
  push_mode text not null default 'none' check (push_mode in ('none','now','scheduled')),
  push_title text,
  push_body text,
  first_notification_at timestamptz,
  notification_sent_at timestamptz,
  published_at timestamptz,
  cancelled_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (congregation_id, slug),
  unique (pack_id)
);

create table if not exists public.church_content_publication_items (
  publication_id uuid not null references public.church_content_publications(id) on delete cascade,
  item_id uuid not null references public.content_pack_items(id) on delete restrict,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  release_day integer not null default 0 check (release_day between 0 and 30),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (publication_id, item_id)
);

create table if not exists public.church_content_progress (
  publication_id uuid not null references public.church_content_publications(id) on delete cascade,
  item_id uuid not null references public.content_pack_items(id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz,
  completed_at timestamptz,
  saved_at timestamptz,
  response jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (publication_id, item_id, user_id)
);

create table if not exists public.church_content_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.church_content_publications(id) on delete cascade,
  congregation_id integer not null references public.congregations(congregation_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.content_pack_items(id) on delete set null,
  delivery_key text not null,
  status text not null default 'planned' check (status in ('planned','attempted','accepted','failed','opened','suppressed','cancelled')),
  scheduled_for timestamptz not null,
  attempted_at timestamptz,
  accepted_at timestamptz,
  opened_at timestamptz,
  provider_message_id text,
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_key, user_id)
);

create index if not exists content_pack_items_pack_status_idx on public.content_pack_items(pack_id, status, item_type, sequence);
create index if not exists church_content_publications_feed_idx on public.church_content_publications(congregation_id, starts_at desc) where status = 'published';
create index if not exists church_content_notifications_due_idx on public.church_content_notification_deliveries(scheduled_for) where status = 'planned';
create index if not exists church_content_progress_user_idx on public.church_content_progress(user_id, updated_at desc);

alter table public.sermon_content_packs enable row level security;
alter table public.content_pack_items enable row level security;
alter table public.content_pack_item_revisions enable row level security;
alter table public.church_content_publications enable row level security;
alter table public.church_content_publication_items enable row level security;
alter table public.church_content_progress enable row level security;
alter table public.church_content_notification_deliveries enable row level security;

create policy content_packs_staff_read on public.sermon_content_packs for select to authenticated using (public.has_congregation_capability(congregation_id, 'content.read', auth.uid(), null::bigint));
create policy content_packs_staff_write on public.sermon_content_packs for all to authenticated using (public.has_congregation_capability(congregation_id, 'content.write', auth.uid(), null::bigint)) with check (public.has_congregation_capability(congregation_id, 'content.write', auth.uid(), null::bigint));
create policy content_pack_items_staff_read on public.content_pack_items for select to authenticated using (public.has_congregation_capability(congregation_id, 'content.read', auth.uid(), null::bigint));
create policy content_pack_items_staff_write on public.content_pack_items for all to authenticated using (public.has_congregation_capability(congregation_id, 'content.write', auth.uid(), null::bigint)) with check (public.has_congregation_capability(congregation_id, 'content.write', auth.uid(), null::bigint));
create policy content_pack_revisions_staff_read on public.content_pack_item_revisions for select to authenticated using (public.has_congregation_capability(congregation_id, 'content.read', auth.uid(), null::bigint));
create policy church_publications_staff_read on public.church_content_publications for select to authenticated using (public.has_congregation_capability(congregation_id, 'content.read', auth.uid(), null::bigint));
create policy church_publications_member_read on public.church_content_publications for select to authenticated using (status = 'published' and exists (select 1 from public.congregation_members m where m.congregation_id = church_content_publications.congregation_id and m.user_id = auth.uid()));
create policy church_publication_items_member_read on public.church_content_publication_items for select to authenticated using (exists (select 1 from public.congregation_members m where m.congregation_id = church_content_publication_items.congregation_id and m.user_id = auth.uid()));
create policy church_progress_owner on public.church_content_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.congregation_members m where m.congregation_id = church_content_progress.congregation_id and m.user_id = auth.uid()));

revoke all on public.content_pack_item_revisions, public.church_content_notification_deliveries from anon, authenticated;
grant all on public.sermon_content_packs, public.content_pack_items, public.content_pack_item_revisions, public.church_content_publications, public.church_content_publication_items, public.church_content_progress, public.church_content_notification_deliveries to service_role;

-- Preserve existing member intent: journey notifications follow church announcements
-- until the member makes a more specific choice.
update public.user_profiles
set user_preferences = jsonb_set(
  jsonb_set(jsonb_set(coalesce(user_preferences, '{}'::jsonb), '{notifications}', coalesce(user_preferences->'notifications', '{}'::jsonb), true), '{notifications,churchJourneys}', to_jsonb(coalesce((user_preferences->'notifications'->>'announcements')::boolean, true)), true),
  '{notifications,journeyReminders}', to_jsonb(coalesce((user_preferences->'notifications'->>'announcements')::boolean, true)), true
)
where not (coalesce(user_preferences, '{}'::jsonb)->'notifications' ? 'churchJourneys')
   or not (coalesce(user_preferences, '{}'::jsonb)->'notifications' ? 'journeyReminders');
