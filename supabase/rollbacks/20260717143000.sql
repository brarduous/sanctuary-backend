\echo 'Rollback 20260717143000 disables tenant RLS only; it does not delete tenant data.'
begin;
do $$ declare t text; begin foreach t in array array['bible_studies','check_ins','church_crm_profiles','congregation_members','congregations','events','households','prayer_requests','volunteer_roles'] loop execute format('alter table public.%I no force row level security',t); execute format('alter table public.%I disable row level security',t); end loop; end $$;
drop function if exists public.is_congregation_member(integer,uuid);
commit;
