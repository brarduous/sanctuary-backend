begin;

alter table if exists public.ai_generation_runs
  drop column if exists estimated_cost_usd,
  drop column if exists duration_ms,
  drop column if exists output_token_count,
  drop column if exists input_token_count,
  drop column if exists prompt_version,
  drop column if exists voice_treatment,
  drop column if exists voice_profile_id;

drop table if exists public.pastor_voice_sources;
drop table if exists public.pastor_voice_profiles;
alter table if exists public.congregations drop column if exists onboarding_reset_at;

commit;
