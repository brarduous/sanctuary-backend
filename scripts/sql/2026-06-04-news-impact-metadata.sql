alter table public.scriptural_outlooks
  add column if not exists news_impact_model text,
  add column if not exists news_impact_evaluated_at timestamptz;
