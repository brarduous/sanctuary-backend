\echo 'Rollback 20260717163000 restores authenticated table-level congregation grants.'
begin;
grant select,update on public.congregations to authenticated;
commit;
