alter table public.scriptural_outlooks
  add column if not exists publication_status text not null default 'published',
  add column if not exists publication_review_reasons jsonb not null default '[]'::jsonb,
  add column if not exists publication_checked_at timestamptz;

alter table public.scriptural_outlooks drop constraint if exists scriptural_outlooks_publication_status_check;
alter table public.scriptural_outlooks add constraint scriptural_outlooks_publication_status_check
  check (publication_status in ('pending_review', 'published', 'rejected', 'archived'));

update public.scriptural_outlooks
set publication_status = 'pending_review',
    publication_review_reasons = coalesce(publication_review_reasons, '[]'::jsonb) || '["legacy article failed launch validation"]'::jsonb,
    publication_checked_at = now()
where publication_status = 'published'
  and (
    nullif(btrim(coalesce(slug, '')), '') is null
    or nullif(btrim(coalesce(article_title, '')), '') is null
    or nullif(btrim(coalesce(article_url, '')), '') is null
    or article_url !~* '^https?://'
    or nullif(btrim(coalesce(article_thumbnail_url, '')), '') is null
    or publish_date is null
    or ai_outlook is null
  );

alter table public.scriptural_outlooks alter column publication_status set default 'pending_review';
alter table public.scriptural_outlooks drop constraint if exists scriptural_outlooks_published_complete_check;
alter table public.scriptural_outlooks add constraint scriptural_outlooks_published_complete_check
  check (
    publication_status <> 'published'
    or (
      nullif(btrim(coalesce(slug, '')), '') is not null
      and nullif(btrim(coalesce(article_title, '')), '') is not null
      and article_url ~* '^https?://'
      and nullif(btrim(coalesce(article_thumbnail_url, '')), '') is not null
      and publish_date is not null
      and ai_outlook is not null
    )
  );

update public.scriptural_outlooks as outlook
set publication_status = 'pending_review',
    publication_review_reasons = coalesce(outlook.publication_review_reasons, '[]'::jsonb) || '["fewer than two supporting sources"]'::jsonb,
    publication_checked_at = now()
where outlook.publication_status = 'published'
  and (select count(*) from public.news_article_sources source where source.outlook_id = outlook.id) < 2;

create or replace function public.enforce_news_publication_sources()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.publication_status = 'published'
     and (select count(*) from public.news_article_sources source where source.outlook_id = new.id) < 2 then
    raise exception 'A published article requires at least two supporting sources';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_news_publication_sources on public.scriptural_outlooks;
create trigger enforce_news_publication_sources
before insert or update of publication_status on public.scriptural_outlooks
for each row execute function public.enforce_news_publication_sources();

create index if not exists idx_scriptural_outlooks_publication_status
  on public.scriptural_outlooks(publication_status, publish_date desc);

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'pending' check (status in ('pending','active','unsubscribed','bounced','complained','suppressed')),
  consented_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  acquisition_source text not null default 'unknown',
  topic_preferences jsonb not null default '[]'::jsonb,
  confirmation_token_hash text,
  confirmation_expires_at timestamptz,
  unsubscribe_token_hash text not null,
  resend_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
  briefing_date date not null,
  resend_email_id text,
  status text not null default 'queued',
  error_message text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (subscriber_id, briefing_date)
);

create table if not exists public.editorial_alerts (
  id uuid primary key default gen_random_uuid(),
  outlook_id bigint references public.scriptural_outlooks(id) on delete cascade,
  alert_type text not null,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  notified_at timestamptz,
  unique(outlook_id, alert_type)
);

alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_deliveries enable row level security;
alter table public.editorial_alerts enable row level security;
revoke all on public.newsletter_subscribers, public.newsletter_deliveries, public.editorial_alerts from anon, authenticated;
grant all on public.newsletter_subscribers, public.newsletter_deliveries, public.editorial_alerts to service_role;
