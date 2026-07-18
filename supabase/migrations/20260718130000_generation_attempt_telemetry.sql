alter table public.ai_generation_runs
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_telemetry jsonb not null default '[]'::jsonb;

alter table public.ai_generation_runs
  drop constraint if exists ai_generation_runs_attempt_telemetry_array,
  add constraint ai_generation_runs_attempt_telemetry_array check (jsonb_typeof(attempt_telemetry) = 'array');

comment on column public.ai_generation_runs.attempt_telemetry is
  'Non-sensitive attempt number, timestamps, outcome, and whitelisted error class only; never prompt or generated content.';
