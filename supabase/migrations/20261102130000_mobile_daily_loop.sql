begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Existing explicit consent and the category pause switch remain unchanged.
do $$begin if to_regclass('public.notification_runtime_settings') is not null then
 update public.notification_runtime_settings set send_local_time='19:00',updated_at=now() where category='discovery';
end if;end$$;
alter table public.discovery_metrics add column if not exists entry_source text check(entry_source in ('home','games','shared_link','push','direct'));
alter table public.discovery_metrics add column if not exists session_id uuid;
alter table public.discovery_metrics add column if not exists set_date date;
alter table public.discovery_metrics add column if not exists player_key text check(player_key is null or player_key ~ '^[a-f0-9]{64}$');
alter table public.discovery_metrics drop constraint if exists discovery_metrics_event_check;
alter table public.discovery_metrics add constraint discovery_metrics_event_check check(event in ('card_viewed','question_opened','answer_committed','direct_reveal','explanation_viewed','source_opened','share_initiated','app_cta_clicked','set_opened','round_started','set_completed'));
create index if not exists discovery_metrics_daily_entry on public.discovery_metrics(set_date,event,entry_source);
create index if not exists discovery_metrics_return_cohorts on public.discovery_metrics(player_key,created_at) where player_key is not null;
commit;
