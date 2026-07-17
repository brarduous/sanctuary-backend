begin;
revoke select, update on public.congregations from authenticated;
grant select (congregation_id,name,leader_user_id,description,created_at,updated_at,invite_token,youtube_channel_id) on public.congregations to authenticated;
grant update (name,description,youtube_channel_id) on public.congregations to authenticated;
-- Stripe provider identifiers and connection state remain service-role only and
-- are exposed to finance-authorized staff solely through capability-gated APIs.
commit;
