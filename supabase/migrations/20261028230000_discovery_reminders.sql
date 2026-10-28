-- Trivia reminders are a separate, explicit opt-in and remain disabled until rollout.
alter table public.user_profiles add column if not exists notification_capabilities jsonb not null default '{}'::jsonb;
alter table public.notification_runtime_settings drop constraint if exists notification_runtime_settings_category_check;
alter table public.notification_runtime_settings add constraint notification_runtime_settings_category_check check(category in ('devotional','advice','news','church','discovery'));
alter table public.notification_campaigns drop constraint if exists notification_campaigns_category_check;
alter table public.notification_campaigns add constraint notification_campaigns_category_check check(category in ('devotional','advice','news','church','discovery'));
insert into public.notification_runtime_settings(category,enabled,rollout_stage,send_local_time)
values('discovery',false,'dry_run','18:00') on conflict(category) do nothing;
-- A correction/revision cannot cause a second reminder on the same local day.
create unique index if not exists notification_deliveries_discovery_daily_idx
on public.notification_deliveries(user_id,local_date) where category='discovery';

create or replace function public.capture_notification_preference_changes()
returns trigger language plpgsql security definer set search_path=public as $$
declare category_name text; old_value boolean; new_value boolean;
begin
  foreach category_name in array array['devotionals','advice','news','announcements','trivia'] loop
    old_value:=coalesce(old.user_preferences->'notifications'->category_name='true'::jsonb,false);
    new_value:=coalesce(new.user_preferences->'notifications'->category_name='true'::jsonb,false);
    if new_value is distinct from old_value then
      insert into public.notification_preference_events(user_id,category,enabled)
      values(new.user_id,case category_name when 'devotionals' then 'devotional' when 'announcements' then 'church' when 'trivia' then 'discovery' else category_name end,new_value);
    end if;
  end loop;
  return new;
end $$;
