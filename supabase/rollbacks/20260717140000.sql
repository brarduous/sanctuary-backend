\echo 'Rollback 20260717140000 restores pre-enforcement pastoral message access.'
begin;
drop policy if exists pastoral_messages_staff_read on public.pastoral_messages;
drop policy if exists pastoral_messages_staff_insert on public.pastoral_messages;
drop policy if exists pastoral_messages_staff_update on public.pastoral_messages;
drop policy if exists pastoral_messages_staff_delete on public.pastoral_messages;
alter table public.pastoral_messages no force row level security;
alter table public.pastoral_messages disable row level security;
grant select,insert,update,delete on public.pastoral_messages to authenticated;
commit;
