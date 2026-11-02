-- Read-only aggregate report. Never export account identifiers or player keys.
-- Run after 20261102130000; use UTC event days for retention, set_date for daily-set attribution.
with activity as (
 select distinct player_key,(created_at at time zone 'UTC')::date as activity_day
 from discovery_metrics where player_key is not null
 and event in ('set_opened','round_started','set_completed')
), first_use as (
 select player_key,min(activity_day) cohort from activity group by player_key
), retention as (
 select cohort,count(*) users,
 count(*) filter(where exists(select 1 from activity a where a.player_key=f.player_key and a.activity_day=f.cohort+1)) day_one,
 count(*) filter(where exists(select 1 from activity a where a.player_key=f.player_key and a.activity_day=f.cohort+7)) day_seven
 from first_use f group by cohort
), funnel as (
 select set_date,platform,entry_source,event,count(*) events,
 count(distinct player_key) players,count(distinct session_id) sessions
 from discovery_metrics where set_date is not null group by set_date,platform,entry_source,event
), push as (
 select category,status,count(*) deliveries from notification_deliveries
 where created_at>=now()-interval '14 days' group by category,status
), optouts as (
 select category,count(*) optouts from notification_preference_events
 where enabled=false and created_at>=now()-interval '14 days' group by category
)
select jsonb_build_object(
 'generated_at',now(),'retention_day_basis','UTC activity date; first observed supported client',
 'funnel',coalesce((select jsonb_agg(funnel) from funnel),'[]'::jsonb),
 'retention',coalesce((select jsonb_agg(jsonb_build_object('cohort',cohort,'users',users,
   'day_one_eligible',cohort+1<(now() at time zone 'UTC')::date,'day_one_returns',day_one,
   'day_seven_eligible',cohort+7<(now() at time zone 'UTC')::date,'day_seven_returns',day_seven)) from retention),'[]'::jsonb),
 'push_14_days',coalesce((select jsonb_agg(push) from push),'[]'::jsonb),
 'optouts_14_days',coalesce((select jsonb_agg(optouts) from optouts),'[]'::jsonb)
) as report;
