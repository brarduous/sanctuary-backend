begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ declare t text; begin
 foreach t in array array['daily_devotionals','daily_prayers','advice_guidance','content_feedback','user_activities','sermons','sermon_series','user_profiles'] loop
  execute format('alter table public.%I enable row level security',t);
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='account_owner_access') then
   execute format('create policy account_owner_access on public.%I as permissive for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='account_owner_boundary') then
   execute format('create policy account_owner_boundary on public.%I as restrictive for all to anon,authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  end if;
 end loop;
end $$;
create or replace function public.guard_profile_client_privileges()
returns trigger language plpgsql set search_path=public as $$
declare allowed text[]:=array['first_name','last_name','avatar_url','date_of_birth','sermon_preferences','user_preferences','email','expo_push_token','notification_time_zone','notification_capabilities','updated_at']; j jsonb; prior public.user_profiles%rowtype;
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   select * into prior from public.user_profiles where user_id=new.user_id;
   if found then
    new:=jsonb_populate_record(new,to_jsonb(prior)-allowed);
    return new;
   end if;
  end if;
  j:=to_jsonb(new);
  if tg_op='UPDATE' and (j-allowed) is distinct from (to_jsonb(old)-allowed) then
   raise exception 'Profile privilege and ownership fields are server-managed' using errcode='42501';
  end if;
  if tg_op='INSERT' and (coalesce(j->>'role','authenticated') not in ('user','authenticated') or coalesce(j->>'tier','') not in ('','free') or coalesce(j->>'subscription_tier','free')<>'free' or j->>'stripe_customer_id' is not null or j->>'stripe_subscription_id' is not null or coalesce(j->>'ai_tuning_notes','')<>'' or coalesce((j->>'advice_usage_count')::integer,0)<>0 or coalesce((j->>'community_requests_count')::integer,0)<>0) then
   raise exception 'Profile privileges are server-managed' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists guard_profile_client_privileges on public.user_profiles;
create trigger guard_profile_client_privileges before insert or update on public.user_profiles for each row execute function public.guard_profile_client_privileges();

-- Diagnostics contain private content and run only behind service-role APIs.
revoke all on public.system_logs,public.prompt_evaluations from public,anon,authenticated;

-- Lesson access follows the already-enforced parent-study sharing contract.
alter table public.bible_study_lessons enable row level security;
drop policy if exists lesson_visible_parent on public.bible_study_lessons;
create policy lesson_visible_parent on public.bible_study_lessons for select to authenticated using (exists(select 1 from public.bible_studies s where s.study_id=bible_study_lessons.study_id));
drop policy if exists lesson_author_changes on public.bible_study_lessons;
create policy lesson_author_changes on public.bible_study_lessons for all to authenticated using (exists(select 1 from public.bible_studies s where s.study_id=bible_study_lessons.study_id and s.user_id=(select auth.uid()))) with check ((user_id is null or user_id=(select auth.uid())) and exists(select 1 from public.bible_studies s where s.study_id=bible_study_lessons.study_id and s.user_id=(select auth.uid())));
commit;
