begin;
drop function if exists public.finish_devotional_quality_week(date,integer,jsonb);
drop function if exists public.claim_devotional_quality_week(date);
drop table if exists public.devotional_quality_runs;
drop table if exists public.devotional_quality_runtime;
commit;
