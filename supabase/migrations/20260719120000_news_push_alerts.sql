alter table public.scriptural_outlooks
  add column if not exists push_alerted_at timestamptz;

create index if not exists idx_scriptural_outlooks_pending_push_alert
  on public.scriptural_outlooks (news_impact_score desc, created_at desc)
  where push_alerted_at is null;
