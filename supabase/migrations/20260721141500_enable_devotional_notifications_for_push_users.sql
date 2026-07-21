-- Activate daily devotionals for users who previously granted device/browser
-- push permission but never made a category-level choice. Explicit opt-outs are
-- preserved.
update public.user_profiles as profile
set user_preferences = jsonb_set(
  case
    when jsonb_typeof(coalesce(profile.user_preferences, '{}'::jsonb)->'notifications') = 'object'
      then coalesce(profile.user_preferences, '{}'::jsonb)
    else jsonb_set(coalesce(profile.user_preferences, '{}'::jsonb), '{notifications}', '{}'::jsonb, true)
  end,
  '{notifications,devotionals}',
  'true'::jsonb,
  true
)
where not coalesce(profile.user_preferences->'notifications', '{}'::jsonb) ? 'devotionals'
  and (
    nullif(btrim(profile.expo_push_token), '') is not null
    or exists (
      select 1
      from public.push_subscriptions as subscription
      where subscription.user_id = profile.user_id
    )
  );
