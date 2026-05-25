-- Devotional short-form support.
-- Safe to run in Supabase SQL Editor.

-- 1) Storage for generated 3-slide devotional story content.
alter table if exists public.daily_devotionals
  add column if not exists short_form jsonb;

alter table if exists public.general_devotionals
  add column if not exists short_form jsonb;

-- 2) Optional shape validation for new/updated rows.
-- Existing NULL rows remain valid so old devotionals do not break.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_devotionals_short_form_shape_check'
  ) then
    alter table public.daily_devotionals
      add constraint daily_devotionals_short_form_shape_check
      check (
        short_form is null
        or case
          when jsonb_typeof(short_form) = 'object'
            and short_form->>'format' = 'instagram_story_3_slide'
            and jsonb_typeof(short_form->'slides') = 'array'
          then jsonb_array_length(short_form->'slides') = 3
          else false
        end
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'general_devotionals_short_form_shape_check'
  ) then
    alter table public.general_devotionals
      add constraint general_devotionals_short_form_shape_check
      check (
        short_form is null
        or case
          when jsonb_typeof(short_form) = 'object'
            and short_form->>'format' = 'instagram_story_3_slide'
            and jsonb_typeof(short_form->'slides') = 'array'
          then jsonb_array_length(short_form->'slides') = 3
          else false
        end
      );
  end if;
end $$;

-- 3) Quick verification query.
select
  table_name,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('daily_devotionals', 'general_devotionals')
  and column_name = 'short_form'
order by table_name;
