-- Only in the approved rollback window; disable visibility and archive discovery
-- content, reviews, reports, completions, and metrics before removing these objects.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

drop function if exists public.discovery_complete(uuid,jsonb);
drop function if exists public.discovery_schedule_item(uuid,integer,date,uuid);
drop function if exists public.discovery_restore(uuid,integer,uuid,text);
drop function if exists public.discovery_approve(uuid,integer,uuid,text,jsonb);
drop function if exists public.discovery_import(uuid,text,jsonb,uuid);
drop function if exists public.discovery_require_admin(uuid);
drop table if exists public.discovery_metrics, public.discovery_issue_reports, public.discovery_completions, public.discovery_schedule, public.discovery_publication_history, public.discovery_reviews, public.discovery_revisions, public.discovery_runtime_settings, public.discoveries;
drop function if exists public.discovery_immutable();
drop function if exists public.discovery_archive_publication();
commit;
