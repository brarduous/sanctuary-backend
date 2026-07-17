\echo 'Rollback 20260717160000 removes pending invitation infrastructure after application rollback.'
begin;
drop table if exists public.staff_invitations;
commit;
