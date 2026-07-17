begin;
alter table public.households add column if not exists primary_phone_normalized text;
update public.households set primary_phone_normalized = right(regexp_replace(primary_phone, '[^0-9]', '', 'g'), 10) where primary_phone is not null;
alter table public.households add constraint households_phone_normalized_format check (primary_phone_normalized is null or primary_phone_normalized ~ '^[0-9]{10}$') not valid;
create index if not exists idx_households_tenant_phone_normalized on public.households(congregation_id, primary_phone_normalized) where primary_phone_normalized is not null;
commit;
