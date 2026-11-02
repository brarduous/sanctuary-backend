begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.content_quality_replacements(
 id bigint generated always as identity primary key,
 owner_id uuid references auth.users(id) on delete cascade,
 kind text not null,source_key text not null,source_hash text not null,
 snapshot jsonb not null,context jsonb not null default '{}',initial_grade jsonb,
 status text not null default 'queued' check(status in ('queued','running','retry_wait','replaced','accepted_existing','obsolete','protected')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,history jsonb not null default '[]',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(kind,source_key,source_hash)
);
create unique index if not exists content_quality_one_active on public.content_quality_replacements(kind,source_key) where status in ('queued','running','retry_wait');
alter table public.content_quality_replacements enable row level security;
revoke all on public.content_quality_replacements from public,anon,authenticated;
grant all on public.content_quality_replacements to service_role;
grant usage,select on sequence public.content_quality_replacements_id_seq to service_role;
alter table public.daily_news_synopses add column if not exists quality_withheld boolean not null default false;
alter table public.daily_news_synopses enable row level security;
drop policy if exists quality_brief_read on public.daily_news_synopses;
create policy quality_brief_read on public.daily_news_synopses for select to anon,authenticated using(not quality_withheld);
drop policy if exists quality_brief_boundary on public.daily_news_synopses;
create policy quality_brief_boundary on public.daily_news_synopses as restrictive for select to anon,authenticated using(not quality_withheld);
create or replace function public.content_quality_target(p_kind text) returns jsonb language sql immutable as $$
 select jsonb_build_object('table',t,'id',i,'fields',f) from(values
 ('general_devotionals','general_devotionals','id',array['title','content','prayer','short_form']),
 ('devotionals','daily_devotionals','devotional_id',array['title','content','short_form']),
 ('prayers','daily_prayers','prayer_id',array['generated_prayer']),
 ('guidance','advice_guidance','advice_id',array['advice_points']),
 ('sermons','sermons','sermon_id',array['title','sermon_body','sermon_outline','key_takeaways','illustration','actual_duration_min']),
 ('bible_studies','bible_study_lessons','lesson_id',array['title','commentary','reflection_questions','introduction','application_sidebar','key_verse','conclusion']),
 ('news','scriptural_outlooks','id',array['ai_outlook']),
 ('daily_brief','daily_news_synopses','id',array['synopsis','details','stories','scripture','prayer']),
 ('trivia','discoveries','id',array[]::text[])) v(k,t,i,f) where k=p_kind;
$$;
create or replace function public.content_quality_pass(p_grade jsonb) returns boolean language sql immutable as $$
 select coalesce((p_grade->>'seriousConcern')::boolean=false
 and (p_grade->>'accuracy')::numeric>=85
 and (p_grade->>'helpfulness')::numeric>=75 and (p_grade->>'audience')::numeric>=75 and (p_grade->>'freshness')::numeric>=60
 and ((p_grade->>'helpfulness')::numeric+(p_grade->>'accuracy')::numeric+(p_grade->>'audience')::numeric+(p_grade->>'freshness')::numeric)/4>=85
 and (select bool_and((p_grade->>k)::numeric between 0 and 100) from unnest(array['helpfulness','accuracy','audience','freshness'])k),false);
$$;
create or replace function public.content_quality_enqueue(p_kind text,p_key text,p_snapshot jsonb,p_grade jsonb,p_context jsonb) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare target jsonb:=public.content_quality_target(p_kind); current_row jsonb; job_id bigint; fingerprint text:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
begin
 if target is null then raise exception 'Unknown content kind'; end if;
 if public.content_quality_pass(p_grade) then return null; end if;
 execute format('select to_jsonb(t) from public.%I t where %I::text=$1 for update',target->>'table',target->>'id') into current_row using p_key;
 if current_row is null or current_row<>p_snapshot then return null; end if;
 select id into job_id from public.content_quality_replacements where kind=p_kind and source_key=p_key and (source_hash=fingerprint or status in ('queued','running','retry_wait')) order by id desc limit 1;
 if found then return job_id; end if;
 if p_kind='news' and (current_row->'ai_outlook'->'editorialReview'->>'status' in ('rejected','archived') or current_row->>'superseded_by_outlook_id' is not null) then return null; end if;
 if p_kind='news' and coalesce((p_grade->>'seriousConcern')::boolean,false) then
  update public.scriptural_outlooks set publication_status='pending_review',publication_review_reasons=array['automatic_quality_replacement'] where id::text=p_key;
  select to_jsonb(t) into current_row from public.scriptural_outlooks t where id::text=p_key;
 elsif p_kind='daily_brief' and coalesce((p_grade->>'seriousConcern')::boolean,false) then
  update public.daily_news_synopses set quality_withheld=true where id::text=p_key;
  select to_jsonb(t) into current_row from public.daily_news_synopses t where id::text=p_key;
 end if;
 insert into public.content_quality_replacements(owner_id,kind,source_key,source_hash,snapshot,initial_grade,context)
 values(case when p_kind='bible_studies' then (select user_id from public.bible_studies where study_id=(current_row->>'study_id')::integer) else (current_row->>'user_id')::uuid end,p_kind,p_key,fingerprint,current_row,p_grade,p_context) on conflict(kind,source_key,source_hash) do nothing returning id into job_id;
 return job_id;
end $$;
create or replace function public.content_quality_claim(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.content_quality_replacements;
begin
 select * into job from public.content_quality_replacements where
 (status in ('queued','retry_wait') and next_attempt_at<=now()) or (status='running' and lease_until<now())
 order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.content_quality_replacements set status='running',attempts=attempts+1,lease_token=p_token,lease_until=now()+interval '15 minutes',updated_at=now() where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
create or replace function public.content_quality_finish(p_id bigint,p_token uuid,p_action text,p_patch jsonb,p_grade jsonb,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.content_quality_replacements; target jsonb; current_row jsonb; sets text; field text; allowed text[]; merged jsonb;
begin
 select * into job from public.content_quality_replacements where id=p_id for update;
 if job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<now() then raise exception 'Replacement lease is not active'; end if;
 target:=public.content_quality_target(job.kind);
 execute format('select to_jsonb(t) from public.%I t where %I::text=$1 for update',target->>'table',target->>'id') into current_row using job.source_key;
 if current_row is null or current_row<>job.snapshot then p_action:='obsolete'; end if;
 if p_action in ('replaced','accepted_existing') and not public.content_quality_pass(p_grade) then raise exception 'Replacement must meet the 85-point quality and factual gates'; end if;
 if p_action='replaced' then
  if job.kind='trivia' then raise exception 'Trivia uses its independently verified immutable-set publication path'; end if;
  select array_agg(value) into allowed from jsonb_array_elements_text(target->'fields');
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_patch)k where not k=any(allowed)) then raise exception 'Replacement contains unsupported fields'; end if;
  merged:=current_row||p_patch;
  if job.kind='news' then merged:=merged||jsonb_build_object('publication_status','published','publication_review_reasons','[]'::jsonb,'publication_checked_at',now());allowed:=allowed||array['publication_status','publication_review_reasons','publication_checked_at'];
  elsif job.kind='daily_brief' then merged:=merged||jsonb_build_object('quality_withheld',false);allowed:=allowed||array['quality_withheld'];end if;
  foreach field in array allowed loop
   if merged ? field then sets:=concat_ws(',',sets,format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',field,target->>'table',field)); end if;
  end loop;
  execute format('update public.%I set %s where %I::text=$2',target->>'table',sets,target->>'id') using merged,job.source_key;
 elsif p_action='replace_trivia' then
  if job.kind<>'trivia' then raise exception 'Not a trivia item'; end if;
  update public.discoveries set withdrawn=true,correction_notice='This question was automatically retired and a verified replacement set will be selected.' where id::text=job.source_key;
  p_action:='replaced';
 elsif p_action not in ('accepted_existing','obsolete','protected','retry_wait') then raise exception 'Unknown replacement outcome';
 end if;
 update public.content_quality_replacements set status=p_action,lease_token=null,lease_until=null,
 next_attempt_at=now()+(case when attempts%3=0 then interval '24 hours' when attempts%3=1 then interval '10 minutes' else interval '1 hour' end),
 history=history||jsonb_build_array(jsonb_build_object('attempt',attempts,'at',now(),'action',p_action,'grade',p_grade,'candidate',p_patch,'evidence',p_evidence)),updated_at=now() where id=job.id;
 return jsonb_build_object('id',job.id,'status',p_action);
end $$;
revoke all on function public.content_quality_target(text),public.content_quality_pass(jsonb),public.content_quality_enqueue(text,text,jsonb,jsonb,jsonb),public.content_quality_claim(uuid),public.content_quality_finish(bigint,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.content_quality_target(text),public.content_quality_pass(jsonb),public.content_quality_enqueue(text,text,jsonb,jsonb,jsonb),public.content_quality_claim(uuid),public.content_quality_finish(bigint,uuid,text,jsonb,jsonb,jsonb) to service_role;
create or replace view public.content_quality_replacement_status with(security_invoker=true) as
 select id,kind,status,attempts,updated_at,jsonb_build_object(
 'helpfulness',history->-1->'grade'->'helpfulness','accuracy',history->-1->'grade'->'accuracy',
 'audience',history->-1->'grade'->'audience','freshness',history->-1->'grade'->'freshness') as final_grade
 from public.content_quality_replacements;
revoke all on public.content_quality_replacement_status from public,anon,authenticated;
grant select on public.content_quality_replacement_status to service_role;
commit;
