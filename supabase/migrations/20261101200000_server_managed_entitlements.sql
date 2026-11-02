begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Entitlements are written by verified server-side billing/admin flows only.
alter table public.subscriptions enable row level security;
alter table public.whitelist enable row level security;
alter table public.admin_emails enable row level security;
revoke all on public.subscriptions,public.whitelist,public.admin_emails from public,anon,authenticated;
grant select on public.subscriptions,public.whitelist to authenticated;
grant all on public.subscriptions,public.whitelist,public.admin_emails to service_role;
drop policy if exists subscription_account_read on public.subscriptions;
create policy subscription_account_read on public.subscriptions for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists subscription_account_boundary on public.subscriptions;
create policy subscription_account_boundary on public.subscriptions as restrictive for all to anon,authenticated using(user_id=(select auth.uid())) with check(false);
drop policy if exists whitelist_account_read on public.whitelist;
create policy whitelist_account_read on public.whitelist for select to authenticated using(lower(email)=lower((select auth.jwt())->>'email'));
drop policy if exists whitelist_account_boundary on public.whitelist;
create policy whitelist_account_boundary on public.whitelist as restrictive for all to anon,authenticated using(lower(email)=lower((select auth.jwt())->>'email')) with check(false);
commit;
