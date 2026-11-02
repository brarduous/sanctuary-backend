-- Fail closed. Do not restore client writes to billing or privileged allowlists.
-- Revoke new client reads if a compatibility issue requires disabling this surface.
begin;
revoke select on public.subscriptions,public.whitelist from authenticated;
commit;
