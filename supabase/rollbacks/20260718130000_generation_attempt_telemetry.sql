alter table if exists public.ai_generation_runs
  drop constraint if exists ai_generation_runs_attempt_telemetry_array,
  drop column if exists attempt_telemetry,
  drop column if exists last_attempt_at,
  drop column if exists attempt_count;
