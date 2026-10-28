-- Disable reminders and retain delivery/audit history for recovery.
update public.notification_runtime_settings set enabled=false,rollout_stage='dry_run' where category='discovery';
create or replace function public.capture_notification_preference_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category_name text;
  old_value boolean;
  new_value boolean;
begin
  foreach category_name in array array['devotionals', 'advice', 'news', 'announcements'] loop
    old_value := case when old.user_preferences->'notifications' ? category_name
      then (old.user_preferences->'notifications'->>category_name)::boolean else null end;
    new_value := case when new.user_preferences->'notifications' ? category_name
      then (new.user_preferences->'notifications'->>category_name)::boolean else null end;
    if new_value is distinct from old_value and new_value is not null then
      insert into public.notification_preference_events (user_id, category, enabled)
      values (new.user_id, case category_name when 'devotionals' then 'devotional' when 'announcements' then 'church' else category_name end, new_value);
    end if;
  end loop;
  return new;
end;
$$;

-- The additive capability column, category values and reminder dedup index are retained.
-- They do not affect older application versions; deleting them would discard rollback evidence.
