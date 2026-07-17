\echo 'Rollback 20260717170000 removes check-in idempotency infrastructure.'
begin;
drop index if exists public.check_ins_one_active_child_event;
drop table if exists public.api_idempotency_records;
commit;
