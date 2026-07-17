\echo 'Rollback 20260717153000 removes soft-delete enforcement after application rollback.'
begin;
do $$ declare t text; begin foreach t in array array['church_crm_profiles','households','events','pastoral_messages','prayer_requests','check_ins'] loop execute format('drop policy if exists %I on public.%I',t||'_hide_deleted',t); execute format('alter table public.%I drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists deletion_reason',t); end loop; end $$;
commit;
