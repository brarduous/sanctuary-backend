begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Never turn an automated decision into a fictional human approval on rollback.
do $$ begin
 if exists(select 1 from public.discovery_reviews where review_method='automated_evidence') then
  raise exception 'Automated approvals exist. Disable the cron and use a reviewed roll-forward/restore plan; audit history must be preserved.';
 end if;
end $$;
drop function public.discovery_curriculum_retry(date,uuid);
drop function public.discovery_curriculum_finish_attempt(date,uuid,integer,jsonb,jsonb,jsonb,boolean);
drop function public.discovery_curriculum_begin_attempt(date,uuid,text);
drop function public.discovery_curriculum_claim(date,date,uuid);
drop table public.discovery_generation_attempts,public.discovery_curriculum_slots,public.discovery_generation_runs,public.discovery_week_plans;
alter table public.discovery_reviews drop constraint discovery_reviews_attestations_check;
alter table public.discovery_reviews add constraint discovery_reviews_attestations_check check (attestations @> '{"sourcesReadInContext":true,"everyClaimSupported":true,"oneUnambiguousAnswer":true,"scopeAndUncertaintyAccurate":true,"rightsChecked":true}');
alter table public.discovery_reviews drop column review_method;
commit;
