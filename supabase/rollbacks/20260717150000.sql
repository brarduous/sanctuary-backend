\echo 'Rollback 20260717150000 removes the normalized lookup field after application rollback.'
begin;
alter table public.households drop constraint if exists households_phone_normalized_format;
drop index if exists public.idx_households_tenant_phone_normalized;
alter table public.households drop column if exists primary_phone_normalized;
commit;
