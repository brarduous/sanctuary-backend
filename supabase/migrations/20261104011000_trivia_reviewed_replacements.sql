-- A bounded operator path for replacing unplayed future sets after independent review.
-- Original manuscripts, attempts, set membership and completed results are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create table public.discovery_daily_replacement_audit(
 id uuid primary key default gen_random_uuid(),
 publication_date date not null references public.discovery_daily_sets(publication_date),
 run_id uuid not null references public.discovery_generation_runs(id),
 operator text not null,
 reason text not null,
 old_items jsonb not null,
 new_items jsonb not null,
 set_reviews jsonb not null,
 created_at timestamptz not null default now(),
 unique(publication_date,run_id)
);
alter table public.discovery_daily_replacement_audit enable row level security;
revoke all on public.discovery_daily_replacement_audit from public,anon,authenticated;
grant all on public.discovery_daily_replacement_audit to service_role;
create trigger discovery_daily_replacement_audit_immutable before update or delete on public.discovery_daily_replacement_audit for each row execute function public.discovery_immutable();

create function public.discovery_daily_item_replacement_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare audit public.discovery_daily_replacement_audit;
begin
 if tg_op='UPDATE' and new.publication_date=old.publication_date and new.position=old.position then
  select * into audit from public.discovery_daily_replacement_audit where id=nullif(current_setting('sanctuary.daily_replacement',true),'')::uuid;
  if found and audit.publication_date=old.publication_date and old.publication_date>(now() at time zone 'America/New_York')::date
    and audit.old_items @> jsonb_build_array(jsonb_build_object('position',old.position,'discovery_id',old.discovery_id,'revision',old.revision))
    and audit.new_items @> jsonb_build_array(jsonb_build_object('position',new.position,'discovery_id',new.discovery_id,'revision',new.revision)) then return new; end if;
 end if;
 raise exception 'Published daily sets are immutable outside a reviewed future replacement';
end $$;
drop trigger discovery_daily_items_immutable on public.discovery_daily_set_items;
create trigger discovery_daily_items_immutable before update or delete on public.discovery_daily_set_items for each row execute function public.discovery_daily_item_replacement_guard();

create function public.discovery_replace_prepared_audience_set(p_run uuid,p_date date,p_operator text,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare run public.discovery_generation_runs; candidate jsonb; item jsonb; verification jsonb; r jsonb; manuscripts jsonb; reviews jsonb; context jsonb; hashes jsonb; old_rows jsonb; new_rows jsonb:='[]'; new_id uuid; audit_id uuid; pos integer;
begin
 perform pg_advisory_xact_lock(67240103);
 if p_date<'2026-11-04' or p_date<=(now() at time zone 'America/New_York')::date or p_date>(now() at time zone 'America/New_York')::date+7 then raise exception 'Only the next seven future dates may be replaced'; end if;
 if length(btrim(coalesce(p_operator,''))) not between 3 and 200 or length(btrim(coalesce(p_reason,''))) not between 20 and 1000 then raise exception 'Named operator and concrete editorial reason required'; end if;
 select * into run from public.discovery_generation_runs where id=p_run;
 if not found or run.status<>'completed' or run.summary->>'kind' is distinct from 'general-audience-replacement-v1' or (run.summary->>'prepared')::boolean is distinct from true then raise exception 'Completed reviewed preparation required'; end if;
 select value into candidate from jsonb_array_elements(run.summary->'sets') where value->>'date'=p_date::text;
 if candidate is null or (candidate->>'approved')::boolean is distinct from true or jsonb_array_length(candidate->'items')<>3 or jsonb_array_length(candidate->'verifications')<>3 then raise exception 'Three approved questions required'; end if;
 perform 1 from public.discovery_daily_sets where publication_date=p_date for update;
 if not found then raise exception 'Use normal publication for an unscheduled date'; end if;
 if exists(select 1 from public.discovery_daily_replacement_audit where publication_date=p_date and run_id=p_run) then return jsonb_build_object('status','already_replaced','date',p_date); end if;
 if exists(select 1 from public.discovery_completions c join public.discovery_daily_set_items i on i.discovery_id=c.discovery_id and i.revision=c.revision where i.publication_date=p_date) then raise exception 'A played set cannot be replaced'; end if;
 if (select count(*) from public.discovery_daily_replacement_audit where publication_date=p_date)>=2 then raise exception 'Future replacement budget exhausted'; end if;
 manuscripts:=candidate->'items'; reviews:=candidate->'reviews'; context:=public.discovery_daily_week_context(p_date);
 select jsonb_agg(encode(sha256(convert_to(value->>'prompt','UTF8')),'hex') order by ordinality) into hashes from jsonb_array_elements(manuscripts) with ordinality;
 if jsonb_typeof(reviews) is distinct from 'array' or jsonb_array_length(reviews)<>2 or (select count(distinct value->>'model') from jsonb_array_elements(reviews))<>2 then raise exception 'Two independent final editors required'; end if;
 for r in select value from jsonb_array_elements(reviews) loop
  if r->'questionContents' is distinct from manuscripts or r->'questionPromptHashes' is distinct from hashes or r->'weekContext' is distinct from context
    or r->>'setEditorialVersion' is distinct from 'sanctuary-trivia-set-editor-v6' or r->>'weekReviewVersion' is distinct from 'sanctuary-trivia-rolling-week-v1'
    or coalesce(length(r->>'responseId'),0)<5 or (r->>'approved')::boolean is distinct from true or jsonb_typeof(r->'issues') is distinct from 'array' or jsonb_array_length(r->'issues')<>0 then raise exception 'Final review is stale, incomplete or not bound to this set'; end if;
 end loop;
 if (select count(distinct lower(btrim(choice->>'text'))) from jsonb_array_elements(manuscripts) manuscript cross join lateral jsonb_array_elements(manuscript->'choices') choice where choice->>'id'=manuscript->>'correctOptionId')<>3 then raise exception 'Daily answers must be distinct'; end if;
 select jsonb_agg(jsonb_build_object('position',position,'discovery_id',discovery_id,'revision',revision) order by position) into old_rows from public.discovery_daily_set_items where publication_date=p_date;
 if jsonb_array_length(old_rows)<>3 then raise exception 'Existing set must be complete'; end if;
 for pos in 1..3 loop
  item:=manuscripts->(pos-1); verification:=candidate->'verifications'->(pos-1);
  if item->'difficulty'->>'rubricVersion' is distinct from 'discovery-difficulty-v3' then raise exception 'General audience rubric required'; end if;
  perform public.discovery_validate_set_candidate(item,verification,encode(sha256(convert_to(item->'sources'->0->>'excerpt','UTF8')),'hex'),item->>'scriptureReference',run.corpus_sha256,case pos when 1 then 'easy' when 2 then 'moderate' else 'challenging' end);
  if exists(select 1 from public.discovery_revisions where lower(btrim(content->>'prompt'))=lower(btrim(item->>'prompt'))) then raise exception 'Duplicate daily discovery'; end if;
  new_id:=gen_random_uuid();
  insert into public.discoveries(id,slug) values(new_id,'audience-'||p_date||'-'||pos||'-'||left(new_id::text,8));
  insert into public.discovery_revisions(discovery_id,revision,content) values(new_id,1,item);
  insert into public.discovery_reviews(discovery_id,revision,review_method,note,attestations) values(new_id,1,'automated_evidence','Future replacement passed independent source, craft, general-audience difficulty and complete-set reviews; not measured audience validation.',jsonb_build_object('runId',p_run,'policyVersion',verification->>'policyVersion','dailySetPosition',pos,'evidenceScore',verification->>'evidenceScore','twoVerifierAgreement',true,'sourceTextExact',true,'allClaimsSupported',true,'oneUnambiguousAnswer',true,'difficultyAssessed',true,'questionCraftAssessed',true,'questionCraftPolicy',verification->'questionCraft'->>'policyVersion'));
  new_rows:=new_rows||jsonb_build_array(jsonb_build_object('position',pos,'discovery_id',new_id,'revision',1));
 end loop;
 insert into public.discovery_daily_replacement_audit(publication_date,run_id,operator,reason,old_items,new_items,set_reviews) values(p_date,p_run,p_operator,p_reason,old_rows,new_rows,reviews) returning id into audit_id;
 -- Previously released copies remain valid for cached play and completion history.
 insert into public.discovery_publication_history(publication_date,locale,discovery_id,revision)
  select p_date,'en',i.discovery_id,i.revision from public.discovery_daily_set_items i where i.publication_date=p_date and p_date<=(now() at time zone 'Pacific/Kiritimati')::date on conflict do nothing;
 perform set_config('sanctuary.daily_replacement',audit_id::text,true);
 update public.discovery_daily_set_items i set discovery_id=(n->>'discovery_id')::uuid,revision=(n->>'revision')::int from jsonb_array_elements(new_rows) n where i.publication_date=p_date and i.position=(n->>'position')::int;
 perform set_config('sanctuary.daily_replacement','',true);
 insert into public.discovery_schedule(publication_date,locale,discovery_id,revision) values(p_date,'en',(new_rows->0->>'discovery_id')::uuid,1) on conflict(publication_date,locale) do update set discovery_id=excluded.discovery_id,revision=excluded.revision;
 return jsonb_build_object('status','replaced','date',p_date,'auditId',audit_id,'items',new_rows);
end $$;
revoke all on function public.discovery_replace_prepared_audience_set(uuid,date,text,text),public.discovery_daily_item_replacement_guard() from public,anon,authenticated;
grant execute on function public.discovery_replace_prepared_audience_set(uuid,date,text,text) to service_role;
commit;
