-- Fail-closed rollback: remove added direct-client access, retain ownership
-- boundaries and RLS. Service-role API access continues. Never reopen private
-- content by disabling RLS or restoring the old unconditional WITH CHECK.
begin;
do $$ declare t text; begin
 foreach t in array array['daily_devotionals','daily_prayers','advice_guidance','content_feedback','user_activities','sermons','sermon_series','user_profiles'] loop
  execute format('drop policy if exists account_owner_access on public.%I',t);
 end loop;
end $$;
commit;
