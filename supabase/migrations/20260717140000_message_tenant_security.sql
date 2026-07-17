begin;

alter table public.pastoral_messages
  add column if not exists author_id uuid references auth.users(id),
  alter column congregation_id set not null;

create index if not exists idx_pastoral_messages_congregation_created
  on public.pastoral_messages(congregation_id, created_at desc);

alter table public.pastoral_messages enable row level security;
alter table public.pastoral_messages force row level security;

drop policy if exists pastoral_messages_staff_read on public.pastoral_messages;
create policy pastoral_messages_staff_read
  on public.pastoral_messages for select to authenticated
  using (public.has_congregation_capability(congregation_id, 'communications.read', auth.uid(), null::bigint));

drop policy if exists pastoral_messages_staff_insert on public.pastoral_messages;
create policy pastoral_messages_staff_insert
  on public.pastoral_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.has_congregation_capability(congregation_id, 'communications.write', auth.uid(), null::bigint)
  );

drop policy if exists pastoral_messages_staff_update on public.pastoral_messages;
create policy pastoral_messages_staff_update
  on public.pastoral_messages for update to authenticated
  using (public.has_congregation_capability(congregation_id, 'communications.write', auth.uid(), null::bigint))
  with check (public.has_congregation_capability(congregation_id, 'communications.write', auth.uid(), null::bigint));

drop policy if exists pastoral_messages_staff_delete on public.pastoral_messages;
create policy pastoral_messages_staff_delete
  on public.pastoral_messages for delete to authenticated
  using (public.has_congregation_capability(congregation_id, 'communications.write', auth.uid(), null::bigint));

revoke all on table public.pastoral_messages from anon;
grant select, insert, update, delete on table public.pastoral_messages to authenticated;
grant usage, select on sequence public.pastoral_messages_message_id_seq to authenticated;

commit;
