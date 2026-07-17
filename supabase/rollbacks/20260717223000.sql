begin;

drop trigger if exists capture_sermon_revision_before_update on public.sermons;
drop function if exists public.capture_sermon_revision();
drop table if exists public.sermon_revisions;

commit;
