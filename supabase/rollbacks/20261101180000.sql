begin;
drop function if exists public.claim_app_quality_run(text,text,text);
drop table if exists public.app_quality_reports;
drop table if exists public.reader_content_feedback;
commit;
