-- Production operations foundation. Additive only; sensitive tables are backend-only by default.

alter table public.church_crm_profiles
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists tags text[] not null default '{}',
  add column if not exists custom_fields jsonb not null default '{}',
  add column if not exists consent_status text not null default 'unknown',
  add column if not exists consent_updated_at timestamptz,
  add column if not exists merged_into_id uuid references public.church_crm_profiles(id),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

alter table public.households
  add column if not exists address jsonb not null default '{}',
  add column if not exists tags text[] not null default '{}',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

alter table public.pastoral_messages
  add column if not exists author_id uuid references auth.users(id),
  add column if not exists status text not null default 'draft',
  add column if not exists scheduled_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists recipient_scope jsonb not null default '{"type":"all"}',
  add column if not exists channels text[] not null default '{in_app}',
  add column if not exists delivery_summary jsonb not null default '{}';
update public.pastoral_messages set status = 'sent', sent_at = coalesce(sent_at, created_at) where is_published = true and status = 'draft';

alter table public.events
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_parent_id uuid references public.events(id),
  add column if not exists capacity integer,
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists registration_form jsonb not null default '[]',
  add column if not exists cancellation_reason text,
  add column if not exists follow_up_status text not null default 'not_started';
alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (status = any (array['draft','published','completed','cancelled']));

alter table public.volunteer_roles
  add column if not exists qualifications text[] not null default '{}',
  add column if not exists background_check_required boolean not null default false,
  add column if not exists minimum_volunteers integer not null default 0;

alter table public.event_volunteers
  add column if not exists responded_at timestamptz,
  add column if not exists reminded_at timestamptz,
  add column if not exists substituted_for_id uuid references public.event_volunteers(id),
  add column if not exists conflict_reason text;
alter table public.event_volunteers drop constraint if exists event_volunteers_status_check;
alter table public.event_volunteers add constraint event_volunteers_status_check check (status = any (array['pending','accepted','declined','substituted']));

alter table public.check_ins
  add column if not exists room_id uuid,
  add column if not exists kiosk_session_id uuid,
  add column if not exists label_printed_at timestamptz,
  add column if not exists idempotency_key text;

create table if not exists public.communication_groups (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, description text, filter_definition jsonb not null default '{}', created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(congregation_id, name)
);
create table if not exists public.communication_group_members (
  group_id uuid not null references public.communication_groups(id) on delete cascade,
  profile_id uuid not null references public.church_crm_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(group_id, profile_id)
);
create table if not exists public.communication_preferences (
  congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  profile_id uuid not null references public.church_crm_profiles(id) on delete cascade,
  email_enabled boolean not null default true, sms_enabled boolean not null default false, push_enabled boolean not null default true,
  unsubscribed_at timestamptz, quiet_hours_start time, quiet_hours_end time, time_zone text not null default 'America/New_York', updated_at timestamptz not null default now(),
  primary key(congregation_id, profile_id)
);
create table if not exists public.message_deliveries (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  message_id integer not null references public.pastoral_messages(message_id) on delete cascade, profile_id uuid references public.church_crm_profiles(id),
  channel text not null, status text not null default 'queued', provider_message_id text, failure_code text, failure_message text,
  attempts integer not null default 0, last_attempt_at timestamptz, delivered_at timestamptz, bounced_at timestamptz, created_at timestamptz not null default now(),
  unique(message_id, profile_id, channel)
);

create table if not exists public.person_segments (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, definition jsonb not null default '{}', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(congregation_id, name)
);
create table if not exists public.person_timeline_events (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  profile_id uuid not null references public.church_crm_profiles(id) on delete cascade, event_type text not null, occurred_at timestamptz not null default now(),
  summary text not null, visibility_capability public.capability not null default 'people.read', source_type text, source_id text, metadata jsonb not null default '{}', created_by uuid references auth.users(id)
);
create table if not exists public.care_cases (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  profile_id uuid references public.church_crm_profiles(id), prayer_request_id uuid references public.prayer_requests(id), assignee_user_id uuid references auth.users(id),
  title text not null, description text, priority text not null default 'normal', status text not null default 'open', confidentiality text not null default 'care_team',
  follow_up_at timestamptz, reminder_at timestamptz, escalated_at timestamptz, outcome text, retention_until date,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  closed_at timestamptz, deleted_at timestamptz, deleted_by uuid references auth.users(id), deletion_reason text
);

create table if not exists public.event_resources (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, resource_type text not null, capacity integer, active boolean not null default true, metadata jsonb not null default '{}', unique(congregation_id, name)
);
create table if not exists public.event_resource_bookings (
  event_id uuid not null references public.events(id) on delete cascade, resource_id uuid not null references public.event_resources(id),
  congregation_id bigint not null references public.congregations(congregation_id) on delete cascade, starts_at timestamptz not null, ends_at timestamptz not null,
  primary key(event_id, resource_id)
);
create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade, profile_id uuid references public.church_crm_profiles(id), guest_email text,
  status text not null default 'registered', response_data jsonb not null default '{}', registered_at timestamptz not null default now(), attended_at timestamptz,
  cancelled_at timestamptz, waitlist_position integer, unique(event_id, profile_id)
);

create table if not exists public.volunteer_profiles (
  congregation_id bigint not null references public.congregations(congregation_id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  qualifications text[] not null default '{}', background_check_status text not null default 'not_required', background_check_expires_at date,
  notes text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(congregation_id, user_id)
);
create table if not exists public.volunteer_availability (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, starts_at timestamptz not null, ends_at timestamptz not null,
  availability text not null default 'unavailable', reason text, recurrence_rule text, created_at timestamptz not null default now()
);
create table if not exists public.volunteer_rotations (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  role_id uuid not null references public.volunteer_roles(id) on delete cascade, name text not null, recurrence_rule text not null,
  reminder_hours integer not null default 48, active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create table if not exists public.checkin_rooms (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, capacity integer not null, age_min_months integer, age_max_months integer, active boolean not null default true,
  unique(congregation_id, name)
);
alter table public.check_ins add constraint check_ins_room_fk foreign key (room_id) references public.checkin_rooms(id);
alter table public.check_ins add constraint check_ins_kiosk_session_fk foreign key (kiosk_session_id) references public.kiosk_sessions(id);
create table if not exists public.checkin_labels (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  check_in_id uuid not null references public.check_ins(id) on delete cascade, label_type text not null, payload jsonb not null,
  print_status text not null default 'queued', attempts integer not null default 0, printed_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists public.giving_funds (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, description text, restricted boolean not null default false, active boolean not null default true, unique(congregation_id, name)
);
create table if not exists public.giving_batches (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  name text not null, status text not null default 'open', expected_total_cents bigint, actual_total_cents bigint not null default 0,
  opened_by uuid not null references auth.users(id), closed_by uuid references auth.users(id), opened_at timestamptz not null default now(), closed_at timestamptz
);
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  donor_profile_id uuid references public.church_crm_profiles(id), fund_id uuid not null references public.giving_funds(id), batch_id uuid references public.giving_batches(id),
  amount_cents bigint not null check(amount_cents > 0), currency text not null default 'usd', source text not null, provider_reference text,
  recurring_schedule_id uuid, received_at timestamptz not null default now(), status text not null default 'succeeded',
  recorded_by uuid references auth.users(id), refunded_amount_cents bigint not null default 0, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.recurring_gifts (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  donor_profile_id uuid references public.church_crm_profiles(id), fund_id uuid not null references public.giving_funds(id), amount_cents bigint not null,
  cadence text not null, status text not null default 'active', provider_reference text, next_charge_at timestamptz, created_at timestamptz not null default now()
);
alter table public.gifts add constraint gifts_recurring_fk foreign key (recurring_schedule_id) references public.recurring_gifts(id);
create table if not exists public.gift_refunds (
  id uuid primary key default gen_random_uuid(), congregation_id bigint not null references public.congregations(congregation_id) on delete cascade,
  gift_id uuid not null references public.gifts(id), amount_cents bigint not null check(amount_cents > 0), reason text not null,
  provider_reference text, refunded_by uuid not null references auth.users(id), refunded_at timestamptz not null default now()
);

create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id), content_type text not null,
  content_id text not null, version integer not null, snapshot jsonb not null, change_summary text, created_at timestamptz not null default now(),
  unique(content_type, content_id, version)
);
create table if not exists public.ai_generation_runs (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id), content_type text not null, content_id text,
  status text not null default 'running', model text, source_citations jsonb not null default '[]', input_provenance jsonb not null default '{}',
  failure_code text, retry_of_id uuid references public.ai_generation_runs(id), retention_until date, created_at timestamptz not null default now(), completed_at timestamptz
);

create index if not exists pastoral_messages_delivery_idx on public.pastoral_messages(congregation_id, status, scheduled_at);
create index if not exists message_deliveries_status_idx on public.message_deliveries(congregation_id, status, created_at);
create index if not exists person_timeline_profile_idx on public.person_timeline_events(congregation_id, profile_id, occurred_at desc);
create index if not exists care_cases_queue_idx on public.care_cases(congregation_id, status, follow_up_at);
create index if not exists event_registrations_event_idx on public.event_registrations(event_id, status);
create index if not exists gifts_ledger_idx on public.gifts(congregation_id, received_at desc);
create index if not exists care_cases_deleted_idx on public.care_cases(congregation_id, deleted_at);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'communication_groups','communication_group_members','communication_preferences','message_deliveries','person_segments','person_timeline_events','care_cases',
    'event_resources','event_resource_bookings','event_registrations','volunteer_profiles','volunteer_availability','volunteer_rotations','checkin_rooms','checkin_labels',
    'giving_funds','giving_batches','gifts','recurring_gifts','gift_refunds','content_versions','ai_generation_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;
