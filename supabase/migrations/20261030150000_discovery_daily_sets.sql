-- Additive three-question sets. Legacy schedules/workers remain compatible.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

create function public.discovery_validate_set_candidate(p_content jsonb,p_verification jsonb,source_hash text,expected_reference text,p_corpus_sha256 text,p_difficulty text) returns void
language plpgsql security definer set search_path=public as $$
declare review jsonb; c jsonb; minimum integer; citation jsonb; measured integer:=100; rating integer; first_rating integer; second_rating integer; dimension text; craft_score integer; craft_minimum integer:=8; passage_start integer; passage_end integer; rubric text;
begin
  rubric:=p_content->'difficulty'->>'rubricVersion';
  passage_start:=substring(p_content->>'scriptureReference' from ':([0-9]+)')::int;
  passage_end:=coalesce(substring(p_content->>'scriptureReference' from '-([0-9]+)$')::int,passage_start);
  -- Missing/NULL verdicts fail closed. No arithmetic average can hide one weak claim.
  if (p_verification->>'accepted')::boolean is distinct from true or p_verification->>'policyVersion' is distinct from 'discovery-evidence-v3'
    or coalesce((p_verification->>'evidenceScore')::integer,0)<95 or coalesce((p_verification->>'minimumScore')::integer,0)<95
    or jsonb_typeof(p_verification->'reviews') is distinct from 'array' or jsonb_array_length(p_verification->'reviews')<>2
    or coalesce(p_verification->'questionCraft'->>'policyVersion','') not in ('discovery-question-craft-v1','discovery-question-craft-v2')
    or coalesce((p_verification->'questionCraft'->>'score')::integer,0) not between 6 and 8
    or coalesce(jsonb_array_length(p_verification->'reasons'),1)<>0 then raise exception 'Automated evidence gate did not pass'; end if;
  if p_content->>'kind' is distinct from 'biblical_text' or p_content->>'translation' is distinct from 'WEB' or p_content ? 'traditionLabel'
    or p_content->>'scopeNote' is distinct from 'This discovery describes what the cited passage says in the World English Bible.'
    or jsonb_array_length(p_content->'sources')<>1 or p_content->'sources'->0->>'type' is distinct from 'scripture'
    or jsonb_array_length(p_content->'claims') not between 1 and 3 or jsonb_array_length(p_content->'choices')<>4 then raise exception 'Only simple sourced Bible-text trivia can auto-approve'; end if;
  if (select count(distinct item->>'id') from jsonb_array_elements(p_content->'choices') item)<>4
    or (select count(distinct lower(btrim(item->>'text'))) from jsonb_array_elements(p_content->'choices') item)<>4
    or not exists(select 1 from jsonb_array_elements(p_content->'choices') item where item->>'id'=p_content->>'correctOptionId' and length(btrim(item->>'text'))>0 and position(lower(item->>'text') in lower(p_content->'sources'->0->>'excerpt'))>0)
    or not exists(select 1 from jsonb_array_elements(p_content->'explanationClaimIds') item where item#>>'{}'=p_content->>'answerClaimId') then raise exception 'Answer and explanation structure is invalid'; end if;
  if p_verification->>'sourceSha256' is distinct from source_hash or encode(sha256(convert_to(p_content->'sources'->0->>'excerpt','UTF8')),'hex') is distinct from source_hash then raise exception 'Source hash mismatch'; end if;
  if not exists(select 1 from jsonb_array_elements(p_content->'claims') claim cross join lateral jsonb_array_elements(p_content->'choices') choice
    where claim->>'id'=p_content->>'answerClaimId' and choice->>'id'=p_content->>'correctOptionId'
    and position(' '||regexp_replace(regexp_replace(lower(choice->>'text'),'^(a|an|the|his|her|its|their) ','','i'),'[^[:alnum:]]+',' ','g')||' '
      in ' '||regexp_replace(lower(claim->>'text'),'[^[:alnum:]]+',' ','g')||' ')>0) then raise exception 'Answer claim must identify the keyed answer'; end if;
  if p_content->>'scriptureReference' is distinct from expected_reference or p_content->'sources'->0->>'locator' is distinct from expected_reference then raise exception 'Source reference differs from the curriculum'; end if;
  if p_verification->>'corpusSha256' is distinct from p_corpus_sha256 then raise exception 'Corpus version differs from the run'; end if;
  minimum:=greatest(95,(p_verification->>'minimumScore')::integer);
  if p_content->'difficulty' is distinct from p_verification->'difficulty' or coalesce(rubric,'') not in ('discovery-difficulty-v1','discovery-difficulty-v2') or (p_content->'difficulty'->>'score')::int not between 0 and (case when rubric='discovery-difficulty-v2' then 10 else 8 end) or p_content->'difficulty'->>'level' is distinct from (case when (p_content->'difficulty'->>'score')::int<=(case when rubric='discovery-difficulty-v2' then 3 else 2 end) then 'easy' when (p_content->'difficulty'->>'score')::int<=(case when rubric='discovery-difficulty-v2' then 6 else 5 end) then 'moderate' else 'challenging' end) then raise exception 'Difficulty must match the independently assessed rubric'; end if;
  if (select count(distinct r->>'model') from jsonb_array_elements(p_verification->'reviews') r)<>2
    or (select count(distinct r->>'requestedModel') from jsonb_array_elements(p_verification->'reviews') r)<>2 then raise exception 'Two distinct review models are required'; end if;
  for review in select value from jsonb_array_elements(p_verification->'reviews') loop
    if rubric='discovery-difficulty-v2' and (review->'difficultyAssessment'->>'rubricVersion' is distinct from rubric
      or review->'difficultyAssessment'->>'model' is distinct from review->>'model'
      or coalesce(length(review->'difficultyAssessment'->>'responseId'),0)<5
      or review->'difficultyAssessment'->>'questionPromptSha256' is distinct from encode(sha256(convert_to(p_content->>'prompt','UTF8')),'hex')) then raise exception 'Closed-book difficulty review is missing or not bound to this question'; end if;
    if coalesce((review->>'questionAccuracy')::int,0) not between minimum and 100 or coalesce((review->>'scopeAccuracy')::int,0) not between minimum and 100 or coalesce((review->>'explanationCoverage')::int,0) not between minimum and 100
      or (review->>'simpleTextualFact')::boolean is distinct from true or review->>'solvedOptionId' is distinct from p_content->>'correctOptionId'
      or coalesce(jsonb_array_length(review->'unresolvedIssues'),1)<>0 or coalesce(jsonb_array_length(review->'claims'),0)<>jsonb_array_length(p_content->'claims')
      or coalesce(jsonb_array_length(review->'options'),0)<>4 or (select count(*) from jsonb_array_elements(review->'options') item where item->>'status'='supported')<>1 then raise exception 'Incomplete or weak verifier assessment'; end if;
    measured:=least(measured,(review->>'questionAccuracy')::int,(review->>'scopeAccuracy')::int,(review->>'explanationCoverage')::int);
    craft_score:=0;
    foreach dimension in array array['context','interest','fairChallenge','choiceQuality'] loop
      if coalesce((review->'questionCraft'->>dimension)::int,-1) not between 1 and 2 then raise exception 'Question craft did not pass'; end if;
      craft_score:=craft_score+(review->'questionCraft'->>dimension)::int;
    end loop;
    if craft_score<6 or coalesce(length(btrim(review->'questionCraft'->>'rationale')),0)<15 then raise exception 'Question craft did not pass'; end if;
    craft_minimum:=least(craft_minimum,craft_score);
    if jsonb_typeof(review->'questionPremises') is distinct from 'array' or jsonb_array_length(review->'questionPremises')<1 then raise exception 'Question context is not verified'; end if;
    for c in select value from jsonb_array_elements(review->'questionPremises') loop
      if c->>'status' is distinct from 'supported' or coalesce(length(btrim(c->>'text')),0)=0 or coalesce((c->>'confidence')::int,0) not between minimum and 100 or coalesce(jsonb_array_length(c->'evidence'),0)=0 then raise exception 'Question context did not pass'; end if;
      measured:=least(measured,(c->>'confidence')::int);
      for citation in select value from jsonb_array_elements(c->'evidence') loop
        if citation->>'sourceId' is distinct from 'passage' or coalesce((citation->>'verseNumber')::int,0) not between passage_start and passage_end or coalesce(length(btrim(citation->>'quote')),0)<5
          or position(regexp_replace(btrim(citation->>'quote'),'\s+',' ','g') in regexp_replace(p_content->'sources'->0->>'excerpt','\s+',' ','g'))=0 then raise exception 'Question context quotation is absent from the source'; end if;
      end loop;
    end loop;
    rating:=0;
    foreach dimension in array array['familiarity','evidenceNavigation','reasoningSteps','distractorSimilarity'] loop
      if coalesce((review->'difficulty'->>dimension)::int,-1) not between 0 and 2 then raise exception 'Difficulty dimension outside the rubric'; end if;
      rating:=rating+(review->'difficulty'->>dimension)::int*(case when rubric='discovery-difficulty-v2' and dimension='familiarity' then 2 else 1 end);
    end loop;
    if first_rating is null then first_rating:=rating; else second_rating:=rating; end if;
    if (select count(distinct item->>'claimId') from jsonb_array_elements(review->'claims') item)<>jsonb_array_length(p_content->'claims')
      or exists(select 1 from jsonb_array_elements(p_content->'claims') claim where not exists(select 1 from jsonb_array_elements(review->'claims') item where item->>'claimId'=claim->>'id'))
      or (select count(distinct item->>'optionId') from jsonb_array_elements(review->'options') item)<>4
      or exists(select 1 from jsonb_array_elements(p_content->'choices') choice where not exists(select 1 from jsonb_array_elements(review->'options') item where item->>'optionId'=choice->>'id')) then raise exception 'Verification IDs do not cover the content'; end if;
    for c in select value from jsonb_array_elements(review->'claims') loop
      if c->>'status' is distinct from 'supported' or coalesce((c->>'confidence')::int,0) not between minimum and 100 or coalesce(jsonb_array_length(c->'evidence'),0)=0 then raise exception 'Every claim must meet the threshold'; end if;
      measured:=least(measured,(c->>'confidence')::int);
      for citation in select value from jsonb_array_elements(c->'evidence') loop
        if citation->>'sourceId' is distinct from 'passage' or coalesce((citation->>'verseNumber')::int,0) not between passage_start and passage_end or coalesce(length(btrim(citation->>'quote')),0)<5
          or position(regexp_replace(btrim(citation->>'quote'),'\s+',' ','g') in regexp_replace(p_content->'sources'->0->>'excerpt','\s+',' ','g'))=0 then raise exception 'Supporting quotation is absent from the source'; end if;
      end loop;
    end loop;
    for c in select value from jsonb_array_elements(review->'options') loop
      if coalesce((c->>'confidence')::int,0) not between minimum and 100 or c->>'status' is distinct from (case when c->>'optionId'=p_content->>'correctOptionId' then 'supported' else 'not_supported' end) then raise exception 'Ambiguous or weak answer assessment'; end if;
      measured:=least(measured,(c->>'confidence')::int);
      if c->>'optionId'=p_content->>'correctOptionId' and coalesce(jsonb_array_length(c->'evidence'),0)=0 then raise exception 'Correct answer lacks evidence'; end if;
      for citation in select value from jsonb_array_elements(c->'evidence') loop
        if citation->>'sourceId' is distinct from 'passage' or coalesce((citation->>'verseNumber')::int,0) not between passage_start and passage_end or coalesce(length(btrim(citation->>'quote')),0)<5
          or position(regexp_replace(btrim(citation->>'quote'),'\s+',' ','g') in regexp_replace(p_content->'sources'->0->>'excerpt','\s+',' ','g'))=0 then raise exception 'Answer quotation is absent from the source'; end if;
      end loop;
    end loop;
  end loop;
  if craft_minimum is distinct from (p_verification->'questionCraft'->>'score')::integer then raise exception 'Question craft summary disagrees with raw reviews'; end if;
  if abs(first_rating-second_rating)>2 or (p_content->'difficulty'->>'score')::int<>round((first_rating+second_rating)/2.0)::int then raise exception 'Difficulty must reflect reviewer consensus'; end if;
  if measured<>(p_verification->>'evidenceScore')::int then raise exception 'Evidence score must be the weakest assessed dimension'; end if;
  if p_content->'difficulty'->>'level' is distinct from p_difficulty then raise exception 'Daily set difficulty must match independent assessment'; end if;
  -- Editorial excellence is distinct from difficulty. A zero still fails;
  -- allow a specific useful fact or a slightly weaker third alternative only
  -- when the full question earns at least 7/8 and is unambiguously fair.
  if craft_minimum<7 then raise exception 'Daily set editorial gate requires at least seven craft points'; end if;
  for review in select value from jsonb_array_elements(p_verification->'reviews') loop
    if (review->'questionCraft'->>'fairChallenge')::int is distinct from 2 then raise exception 'Daily set question must be unambiguously fair'; end if;
  end loop;
end $$;

create table public.discovery_daily_jobs (
  publication_date date primary key,
  plan jsonb not null,
  epoch integer not null default 0 check(epoch between 0 and 2),
  retry_history jsonb not null default '[]',
  status text not null default 'pending' check(status in ('pending','generating','published','exhausted')),
  set_review jsonb,
  lease_owner uuid references public.discovery_generation_runs(id),
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.discovery_daily_attempts (
  publication_date date not null references public.discovery_daily_jobs(publication_date),
  epoch integer not null default 0 check(epoch between 0 and 2),
  position integer not null check(position between 1 and 3),
  attempt integer not null check(attempt between 1 and 3),
  run_id uuid not null references public.discovery_generation_runs(id),
  status text not null default 'running' check(status in ('running','rejected','accepted')),
  source_sha256 text not null,
  content jsonb,
  verification jsonb,
  reason_codes jsonb not null default '[]',
  discovery_id uuid references public.discoveries(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(publication_date,epoch,position,attempt)
);
create unique index discovery_daily_one_accepted on public.discovery_daily_attempts(publication_date,epoch,position) where status='accepted';
create table public.discovery_daily_sets (
  publication_date date primary key,
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now()
);
create table public.discovery_daily_set_items (
  publication_date date not null references public.discovery_daily_sets(publication_date),
  position integer not null check(position between 1 and 3),
  discovery_id uuid not null,
  revision integer not null,
  primary key(publication_date,position),
  unique(discovery_id),
  foreign key(discovery_id,revision) references public.discovery_reviews(discovery_id,revision)
);
create trigger discovery_daily_sets_immutable before update or delete on public.discovery_daily_sets for each row execute function public.discovery_immutable();
create trigger discovery_daily_items_immutable before update or delete on public.discovery_daily_set_items for each row execute function public.discovery_immutable();
-- A fixed published day's retired revision must never reappear when an editor
-- restores a newer revision of the same question for another use.
create function public.discovery_daily_keep_withdrawn() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.withdrawn and not new.withdrawn and exists(select 1 from public.discovery_daily_set_items where discovery_id=old.id) then raise exception 'A withdrawn fixed-set question stays withheld; use a new question ID for corrected future content'; end if;
  return new;
end $$;
create trigger discovery_daily_keep_withdrawn before update of withdrawn on public.discoveries for each row execute function public.discovery_daily_keep_withdrawn();

create function public.discovery_daily_claim(p_date date,p_plan jsonb,p_run uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.discovery_daily_jobs;
begin
  if p_date<(now() at time zone 'UTC')::date or p_date>(now() at time zone 'UTC')::date+90 then raise exception 'Date outside bounded daily generation window'; end if;
  if not exists(select 1 from public.discovery_generation_runs where id=p_run and status='running') then raise exception 'Run is not active'; end if;
  if jsonb_typeof(p_plan->'slots') is distinct from 'array' or jsonb_array_length(p_plan->'slots')<>3 or p_plan->>'date' is distinct from p_date::text then raise exception 'Three precommitted daily source slots required'; end if;
  if exists(select 1 from public.discovery_daily_sets where publication_date=p_date) then return null; end if;
  insert into public.discovery_daily_jobs(publication_date,plan) values(p_date,p_plan) on conflict do nothing;
  select * into job from public.discovery_daily_jobs where publication_date=p_date for update;
  if job.status in ('published','exhausted') then return null; end if;
  if job.lease_until>now() and job.lease_owner is distinct from p_run and exists(select 1 from public.discovery_generation_runs where id=job.lease_owner and status='running') then return null; end if;
  if exists(select 1 from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch group by position having count(*)>=3 and count(*) filter(where status='accepted')=0) then
    update public.discovery_daily_jobs set status='exhausted',lease_until=null,updated_at=now() where publication_date=p_date;
    update public.discovery_daily_attempts set status='rejected',reason_codes='["worker_interrupted"]',completed_at=now() where publication_date=p_date and epoch=job.epoch and status='running';
    return null;
  end if;
  update public.discovery_daily_jobs set status='generating',lease_owner=p_run,lease_until=now()+interval '15 minutes',updated_at=now() where publication_date=p_date returning * into job;
  return to_jsonb(job);
end $$;
create function public.discovery_daily_begin(p_date date,p_position integer,p_run uuid,p_source_sha256 text) returns integer language plpgsql security definer set search_path=public as $$
declare job public.discovery_daily_jobs; n integer; source jsonb;
begin
  select * into job from public.discovery_daily_jobs where publication_date=p_date for update;
  if not found or job.status<>'generating' or job.lease_owner is distinct from p_run or job.lease_until<now() or p_position not between 1 and 3 then raise exception 'Daily generation lease unavailable'; end if;
  if exists(select 1 from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and position=p_position and status='accepted') then raise exception 'Daily question already accepted'; end if;
  select coalesce(max(attempt),0)+1 into n from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and position=p_position;
  if n>3 then raise exception 'Daily question retry budget exhausted'; end if;
  source:=job.plan->'slots'->(p_position-1)->'sourceOptions'->(n-1);
  if source->>'sourceSha256' is distinct from p_source_sha256 then raise exception 'Daily source differs from frozen plan'; end if;
  update public.discovery_daily_attempts set status='rejected',reason_codes='["worker_interrupted"]',completed_at=now() where publication_date=p_date and epoch=job.epoch and position=p_position and status='running';
  insert into public.discovery_daily_attempts(publication_date,epoch,position,attempt,run_id,source_sha256) values(p_date,job.epoch,p_position,n,p_run,p_source_sha256);
  update public.discovery_daily_jobs set lease_until=now()+interval '15 minutes',updated_at=now() where publication_date=p_date;
  return n;
end $$;
create function public.discovery_daily_finish(p_date date,p_position integer,p_run uuid,p_attempt integer,p_content jsonb,p_verification jsonb,p_reasons jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.discovery_daily_jobs; a public.discovery_daily_attempts; source jsonb; target text; new_id uuid;
begin
  select * into job from public.discovery_daily_jobs where publication_date=p_date for update;
  if not found or job.status<>'generating' or job.lease_owner is distinct from p_run or job.lease_until<now() then raise exception 'Daily generation lease changed'; end if;
  select * into a from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and position=p_position and attempt=p_attempt for update;
  if not found or a.status<>'running' or a.run_id is distinct from p_run then raise exception 'Daily attempt is not active'; end if;
  if p_content is null then
    if jsonb_typeof(p_reasons) is distinct from 'array' or jsonb_array_length(p_reasons)<1 then raise exception 'Rejection reasons required'; end if;
    update public.discovery_daily_attempts set status='rejected',verification=p_verification,reason_codes=p_reasons,completed_at=now() where publication_date=p_date and epoch=job.epoch and position=p_position and attempt=p_attempt;
    if p_attempt=3 then update public.discovery_daily_jobs set status='exhausted',lease_until=null,updated_at=now() where publication_date=p_date; end if;
    return jsonb_build_object('status',case when p_attempt=3 then 'exhausted' else 'retry' end);
  end if;
  source:=job.plan->'slots'->(p_position-1)->'sourceOptions'->(p_attempt-1);
  target:=case p_position when 1 then 'easy' when 2 then 'moderate' when 3 then 'challenging' end;
  perform public.discovery_validate_set_candidate(p_content,p_verification,a.source_sha256,source->>'sourceReference',job.plan->>'corpusSha256',target);
  if p_verification->>'corpusSha256' is distinct from (select corpus_sha256 from public.discovery_generation_runs where id=p_run) then raise exception 'Daily corpus differs from active run'; end if;
  if exists(select 1 from public.discovery_revisions where lower(btrim(content->>'prompt'))=lower(btrim(p_content->>'prompt'))) then raise exception 'Duplicate daily discovery'; end if;
  new_id:=gen_random_uuid();
  insert into public.discoveries(id,slug) values(new_id,'daily-'||p_date::text||'-'||p_position::text||'-'||left(new_id::text,8));
  insert into public.discovery_revisions(discovery_id,revision,content) values(new_id,1,p_content);
  insert into public.discovery_reviews(discovery_id,revision,review_method,note,attestations) values(new_id,1,'automated_evidence','Approved under the daily-set editorial and evidence gates after two independent blinded reviews; not a human review or measured audience approval.',jsonb_build_object('sourceTextExact',true,'twoVerifierAgreement',true,'allClaimsSupported',true,'oneUnambiguousAnswer',true,'difficultyAssessed',true,'questionCraftAssessed',true,'questionCraftPolicy',p_verification->'questionCraft'->>'policyVersion','policyVersion',p_verification->>'policyVersion','runId',p_run,'evidenceScore',(p_verification->>'evidenceScore')::int,'dailySetPosition',p_position));
  update public.discovery_daily_attempts set status='accepted',content=p_content,verification=p_verification,discovery_id=new_id,completed_at=now() where publication_date=p_date and epoch=job.epoch and position=p_position and attempt=p_attempt;
  return jsonb_build_object('status','accepted','discoveryId',new_id,'revision',1);
end $$;

-- The same rolling-week packet is read by the editor and rechecked at publication.
-- Serializing publications prevents two workers from approving unseen neighbors.
create function public.discovery_daily_week_context(p_date date) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',i.publication_date,'position',i.position,'content',r.content) order by i.publication_date,i.position),'[]'::jsonb)
 from public.discovery_daily_set_items i join public.discovery_revisions r on r.discovery_id=i.discovery_id and r.revision=i.revision
 where i.publication_date between p_date-6 and p_date+6 and i.publication_date<>p_date
$$;

create function public.discovery_daily_publish(p_date date,p_run uuid,p_reviews jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.discovery_daily_jobs; r jsonb; hashes jsonb; manuscripts jsonb; week_context jsonb;
begin
  perform pg_advisory_xact_lock(67240103);
  select * into job from public.discovery_daily_jobs where publication_date=p_date for update;
  if not found or job.status<>'generating' or job.lease_owner is distinct from p_run or job.lease_until<now() then raise exception 'Daily publication lease changed'; end if;
  week_context:=public.discovery_daily_week_context(p_date);
  if (select count(*) from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and status='accepted')<>3 then raise exception 'Daily publication requires three accepted questions'; end if;
  if exists(select 1 from public.discovery_daily_attempts a join public.discoveries d on d.id=a.discovery_id where a.publication_date=p_date and a.epoch=job.epoch and a.status='accepted' and (d.withdrawn or d.correction_notice is not null)) then raise exception 'A reviewed question has been withheld or corrected; do not publish its retired revision'; end if;
  select jsonb_agg(encode(sha256(convert_to(content->>'prompt','UTF8')),'hex') order by position) into hashes from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and status='accepted';
  select jsonb_agg(content order by position) into manuscripts from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and status='accepted';
  if jsonb_typeof(p_reviews) is distinct from 'array' or jsonb_array_length(p_reviews)<>2
    or (select count(distinct x->>'model') from jsonb_array_elements(p_reviews) x)<>2 then raise exception 'Two independent daily set reviews required'; end if;
  for r in select value from jsonb_array_elements(p_reviews) loop
    if r->'questionContents' is distinct from manuscripts or r->'questionPromptHashes' is distinct from hashes or coalesce(length(r->>'responseId'),0)<5
      or r->>'weekReviewVersion' is distinct from 'sanctuary-trivia-rolling-week-v1' or r->'weekContext' is distinct from week_context
      or r->>'setEditorialVersion' is distinct from 'sanctuary-trivia-set-editor-v4'
      or jsonb_typeof(r->'issues') is distinct from 'array' or coalesce(length(btrim(r->>'rationale')),0)<15 then raise exception 'Set review is not bound to these questions'; end if;
  end loop;
  update public.discovery_daily_jobs set set_review=p_reviews,updated_at=now() where publication_date=p_date;
  if exists(select 1 from jsonb_array_elements(p_reviews) x where (x->>'approved')::boolean is distinct from true or jsonb_array_length(x->'issues')<>0) then
    update public.discovery_daily_jobs set status='exhausted',lease_until=null where publication_date=p_date;
    return '{"status":"exhausted","reason":"daily_set_review"}'::jsonb;
  end if;
  if (select count(distinct lower(btrim(choice->>'text'))) from public.discovery_daily_attempts a cross join lateral jsonb_array_elements(a.content->'choices') choice where a.publication_date=p_date and a.epoch=job.epoch and a.status='accepted' and choice->>'id'=a.content->>'correctOptionId')<>3 then raise exception 'Daily answers must be distinct'; end if;
  insert into public.discovery_daily_sets(publication_date) values(p_date);
  insert into public.discovery_daily_set_items(publication_date,position,discovery_id,revision) select p_date,position,discovery_id,1 from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and status='accepted';
  -- Older clients receive the same rigorously reviewed Easy question. The existing
  -- history trigger retains any replaced, already-released legacy revision.
  insert into public.discovery_schedule(publication_date,locale,discovery_id,revision)
    select p_date,'en',discovery_id,1 from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and position=1 and status='accepted'
    on conflict(publication_date,locale) do update set discovery_id=excluded.discovery_id,revision=excluded.revision;
  update public.discovery_daily_jobs set status='published',lease_until=null,updated_at=now() where publication_date=p_date;
  return '{"status":"published"}'::jsonb;
end $$;


-- An explicit operational retry starts a new bounded epoch. Old source plans,
-- reviews and attempts remain inspectable; no published set can be rewritten.
create function public.discovery_daily_retry(p_date date,p_plan jsonb,p_reason text,p_operator text) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.discovery_daily_jobs;
begin
  select * into job from public.discovery_daily_jobs where publication_date=p_date for update;
  if not found or job.status<>'exhausted' then raise exception 'Only an exhausted unpublished day can be retried'; end if;
  if exists(select 1 from public.discovery_daily_sets where publication_date=p_date) then raise exception 'Published daily sets are immutable'; end if;
  if job.epoch>=2 then raise exception 'Daily editorial epoch budget exhausted; investigate before further generation'; end if;
  if p_date<(now() at time zone 'UTC')::date or p_date>(now() at time zone 'UTC')::date+90 then raise exception 'Date outside bounded daily generation window'; end if;
  if length(btrim(coalesce(p_reason,'')))<20 or length(p_reason)>1000 or length(btrim(coalesce(p_operator,'')))<3 or length(p_operator)>200 then raise exception 'A named operator and concrete editorial reason are required'; end if;
  if jsonb_typeof(p_plan->'slots') is distinct from 'array' or jsonb_array_length(p_plan->'slots')<>3 or p_plan->>'date' is distinct from p_date::text or coalesce(length(p_plan->>'version'),0)<5 or (p_plan->>'corpusSha256') is distinct from (job.plan->>'corpusSha256') then raise exception 'A reviewed plan for the same date and corpus is required'; end if;
  if p_plan is not distinct from job.plan then raise exception 'Retry requires a revised source plan or editorial version, not resampling'; end if;
  update public.discovery_daily_jobs set
    retry_history=retry_history||jsonb_build_array(jsonb_build_object('epoch',epoch,'plan',plan,'setReview',set_review,'operator',p_operator,'reason',p_reason,'retriedAt',now())),
    epoch=epoch+1,plan=p_plan,status='pending',set_review=null,lease_owner=null,lease_until=null,updated_at=now()
    where publication_date=p_date returning * into job;
  return to_jsonb(job);
end $$;

alter table public.discovery_completions add column set_position integer check(set_position between 1 and 3);
create or replace function public.discovery_complete(p_user uuid, p_events jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; c jsonb; existing public.discovery_completions; elapsed integer; result_outcome text; puzzle date; results jsonb := '[]'::jsonb;
begin
  if p_user is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then raise exception 'Invalid completion batch'; end if;
  for e in select value from jsonb_array_elements(p_events) loop
    -- Even approved but unscheduled drafts and future-only revisions cannot earn completion.
    select r.content into c from public.discovery_revisions r
      join public.discoveries d on d.id = r.discovery_id
      where r.discovery_id = (e->>'discoveryId')::uuid and r.revision = (e->>'revision')::int and not d.withdrawn
      and (exists(select 1 from public.discovery_schedule s where s.discovery_id = r.discovery_id and s.revision = r.revision and s.publication_date <= (now() at time zone 'Pacific/Kiritimati')::date)
        or exists(select 1 from public.discovery_publication_history h where h.discovery_id = r.discovery_id and h.revision = r.revision)
        or exists(select 1 from public.discovery_daily_set_items s where s.discovery_id=r.discovery_id and s.revision=r.revision and s.publication_date<=(now() at time zone 'Pacific/Kiritimati')::date));
    if c is null then
      results := results || jsonb_build_array(jsonb_build_object('eventId', e->>'eventId', 'status','unavailable'));
      continue;
    end if;
    if e->>'mode' not in ('answered','revealed') or (e->>'mode' = 'answered' and not exists(select 1 from jsonb_array_elements(c->'choices') o where o->>'id' = e->>'optionId'))
      or (e->>'mode' = 'revealed' and e->>'optionId' is not null) then raise exception 'Invalid answer'; end if;
    elapsed := null;
    if e ? 'elapsedMs' and e->'elapsedMs' <> 'null'::jsonb then
      if jsonb_typeof(e->'elapsedMs') <> 'number' or (e->>'elapsedMs') !~ '^[0-9]+$' then raise exception 'Invalid elapsed time'; end if;
      elapsed := (e->>'elapsedMs')::integer;
      if elapsed not between 0 and 20000 or (e->>'mode' = 'answered' and elapsed >= 20000) then raise exception 'Invalid elapsed time'; end if;
    end if;
    if e ? 'timedOut' and jsonb_typeof(e->'timedOut') <> 'boolean' then raise exception 'Invalid timeout'; end if;
    if coalesce((e->>'timedOut')::boolean,false) and (e->>'mode' <> 'revealed' or elapsed is distinct from 20000) then raise exception 'Invalid timeout'; end if;
    result_outcome := case when e->>'mode' = 'answered' then case when e->>'optionId' = c->>'correctOptionId' then 'correct' else 'incorrect' end
      when coalesce((e->>'timedOut')::boolean,false) then 'timeout' else 'revealed' end;
    select min(publication_date) into puzzle from (
      select publication_date from public.discovery_schedule where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
      union all select publication_date from public.discovery_publication_history where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
      union all select publication_date from public.discovery_daily_set_items where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int
    ) dates;
    insert into public.discovery_completions(user_id, discovery_id, revision, event_id, mode, option_id, occurred_at, local_date, time_zone,elapsed_ms,outcome,puzzle_date,set_position)
      values (p_user, (e->>'discoveryId')::uuid, (e->>'revision')::int, (e->>'eventId')::uuid, e->>'mode', e->>'optionId', (e->>'occurredAt')::timestamptz, (e->>'localDate')::date, e->>'timeZone',elapsed,result_outcome,puzzle,(select position from public.discovery_daily_set_items where discovery_id=(e->>'discoveryId')::uuid and revision=(e->>'revision')::int))
      on conflict (user_id, discovery_id) do nothing;
    select * into existing from public.discovery_completions where user_id = p_user and discovery_id = (e->>'discoveryId')::uuid;
    results := results || jsonb_build_array(jsonb_build_object('eventId',e->>'eventId','status','accepted','completion',to_jsonb(existing)));
  end loop;
  return results;
end $$;

alter table public.discovery_daily_jobs enable row level security;
alter table public.discovery_daily_jobs force row level security;
alter table public.discovery_daily_attempts enable row level security;
alter table public.discovery_daily_attempts force row level security;
alter table public.discovery_daily_sets enable row level security;
alter table public.discovery_daily_sets force row level security;
alter table public.discovery_daily_set_items enable row level security;
alter table public.discovery_daily_set_items force row level security;
revoke all on public.discovery_daily_jobs,public.discovery_daily_attempts,public.discovery_daily_sets,public.discovery_daily_set_items from public,anon,authenticated;
grant all on public.discovery_daily_jobs,public.discovery_daily_attempts,public.discovery_daily_sets,public.discovery_daily_set_items to service_role;
revoke all on function public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text),public.discovery_daily_claim(date,jsonb,uuid),public.discovery_daily_begin(date,integer,uuid,text),public.discovery_daily_finish(date,integer,uuid,integer,jsonb,jsonb,jsonb),public.discovery_daily_publish(date,uuid,jsonb),public.discovery_daily_week_context(date),public.discovery_daily_retry(date,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text),public.discovery_daily_claim(date,jsonb,uuid),public.discovery_daily_begin(date,integer,uuid,text),public.discovery_daily_finish(date,integer,uuid,integer,jsonb,jsonb,jsonb),public.discovery_daily_publish(date,uuid,jsonb),public.discovery_daily_week_context(date),public.discovery_daily_retry(date,jsonb,text,text) to service_role;
revoke all on function public.discovery_daily_keep_withdrawn() from public,anon,authenticated;
grant execute on function public.discovery_daily_keep_withdrawn() to service_role;
commit;
