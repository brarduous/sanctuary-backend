begin;
create or replace function public.finish_devotional_quality_week(p_week date, p_revision integer, p_report jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from devotional_quality_runtime where id=1 and revision=p_revision for update;
  if not found then raise exception 'Devotional runtime changed concurrently'; end if;
  perform 1 from devotional_quality_runs where week_start=p_week and status='running' for update;
  if not found then raise exception 'Devotional review is not running'; end if;
  if jsonb_array_length(p_report->'changes') > 0 then
    update devotional_quality_runtime set
      general_model=p_report->'after'->>'general_model',
      personalized_model=p_report->'after'->>'personalized_model',
      general_rules=p_report->'after'->'general_rules',
      personalized_rules=p_report->'after'->'personalized_rules',
      revision=p_revision+1, updated_at=now() where id=1;
  end if;
  update devotional_quality_runs set status='completed', completed_at=now(), report=p_report where week_start=p_week;
end; $$;
revoke all on function public.finish_devotional_quality_week(date,integer,jsonb) from public, anon, authenticated;
grant execute on function public.finish_devotional_quality_week(date,integer,jsonb) to service_role;
alter table public.devotional_quality_runtime drop column if exists general_focus;
alter table public.devotional_quality_runtime drop column if exists personalized_focus;
commit;
