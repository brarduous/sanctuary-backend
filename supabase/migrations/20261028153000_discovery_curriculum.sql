begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter table public.discovery_reviews add column review_method text not null default 'human' check (review_method in ('human','automated_evidence'));
alter table public.discovery_reviews drop constraint discovery_reviews_attestations_check;
alter table public.discovery_reviews add constraint discovery_reviews_attestations_check check (
  (review_method='human' and attestations @> '{"sourcesReadInContext":true,"everyClaimSupported":true,"oneUnambiguousAnswer":true,"scopeAndUncertaintyAccurate":true,"rightsChecked":true}')
  or (review_method='automated_evidence' and reviewer_id is null and attestations @> '{"sourceTextExact":true,"twoVerifierAgreement":true,"allClaimsSupported":true,"oneUnambiguousAnswer":true,"difficultyAssessed":true}')
);
create table public.discovery_week_plans (
  start_date date primary key,
  end_date date not null check (end_date=start_date+6),
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create table public.discovery_generation_runs (
  id uuid primary key,
  policy_version text not null,
  corpus_version text not null,
  corpus_sha256 text not null check (length(corpus_sha256)=64),
  models jsonb not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  summary jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.discovery_curriculum_slots (
  publication_date date primary key,
  week_start date not null references public.discovery_week_plans(start_date),
  status text not null default 'pending' check (status in ('pending','generating','scheduled','awaiting_review','exhausted','superseded')),
  generation_epoch integer not null default 1,
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_owner uuid references public.discovery_generation_runs(id),
  lease_until timestamptz,
  discovery_id uuid references public.discoveries(id),
  question_fingerprint text unique,
  updated_at timestamptz not null default now()
);
create table public.discovery_generation_attempts (
  publication_date date not null references public.discovery_curriculum_slots(publication_date),
  generation_epoch integer not null,
  attempt integer not null check (attempt between 1 and 3),
  run_id uuid not null references public.discovery_generation_runs(id),
  status text not null default 'running' check (status in ('running','rejected','auto_approved','awaiting_review','superseded')),
  source_sha256 text not null,
  candidate_sha256 text,
  evidence_score integer check (evidence_score between 0 and 100),
  verification jsonb,
  reason_codes jsonb not null default '[]',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (publication_date,generation_epoch,attempt)
);
create function public.discovery_curriculum_claim(p_date date,p_week date,p_run uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare slot public.discovery_curriculum_slots;
begin
  if p_date < (now() at time zone 'UTC')::date or p_date > (now() at time zone 'UTC')::date+90 then raise exception 'Date is outside the bounded generation window'; end if;
  if p_date < p_week or p_date > p_week+6 then raise exception 'Slot does not belong to week plan'; end if;
  if not exists(select 1 from public.discovery_generation_runs where id=p_run and status='running') then raise exception 'Run is not active'; end if;
  if exists(select 1 from public.discovery_schedule where publication_date=p_date and locale='en') then return null; end if;
  insert into public.discovery_curriculum_slots(publication_date,week_start) values (p_date,p_week) on conflict do nothing;
  select * into slot from public.discovery_curriculum_slots where publication_date=p_date for update;
  if slot.status in ('scheduled','awaiting_review','exhausted','superseded') then return null; end if;
  if slot.lease_until>now() and slot.lease_owner is distinct from p_run and exists(select 1 from public.discovery_generation_runs where id=slot.lease_owner and status='running') then return null; end if;
  if slot.attempts>=3 then
    update public.discovery_curriculum_slots set status='exhausted',lease_until=null,updated_at=now() where publication_date=p_date;
    update public.discovery_generation_attempts set status='rejected',reason_codes='["worker_interrupted"]',completed_at=now() where publication_date=p_date and status='running';
    return null;
  end if;
  update public.discovery_curriculum_slots set status='generating',lease_owner=p_run,lease_until=now()+interval '15 minutes',updated_at=now() where publication_date=p_date returning * into slot;
  return to_jsonb(slot);
end $$;
create function public.discovery_curriculum_begin_attempt(p_date date,p_run uuid,p_source_sha256 text) returns integer language plpgsql security definer set search_path=public as $$
declare slot public.discovery_curriculum_slots; expected_source text;
begin
  select * into slot from public.discovery_curriculum_slots where publication_date=p_date for update;
  if not found or slot.status<>'generating' or slot.lease_owner is distinct from p_run or slot.lease_until<now() or slot.attempts>=3 then raise exception 'Generation lease or retry budget is unavailable'; end if;
  select day->>'sourceSha256' into expected_source from public.discovery_week_plans w, jsonb_array_elements(w.plan->'days') day where w.start_date=slot.week_start and day->>'date'=p_date::text;
  if expected_source is distinct from p_source_sha256 then raise exception 'Week-plan evidence changed'; end if;
  -- A killed worker consumes its attempt. Never silently reset a retry budget.
  update public.discovery_generation_attempts set status='rejected',reason_codes='["worker_interrupted"]',completed_at=now() where publication_date=p_date and generation_epoch=slot.generation_epoch and status='running';
  update public.discovery_curriculum_slots set attempts=attempts+1,lease_until=now()+interval '15 minutes',updated_at=now() where publication_date=p_date returning * into slot;
  insert into public.discovery_generation_attempts(publication_date,generation_epoch,attempt,run_id,source_sha256) values (p_date,slot.generation_epoch,slot.attempts,p_run,p_source_sha256);
  return slot.attempts;
end $$;
create function public.discovery_curriculum_finish_attempt(p_date date,p_run uuid,p_attempt integer,p_content jsonb,p_verification jsonb,p_reasons jsonb,p_auto_approve boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare slot public.discovery_curriculum_slots; new_id uuid; final_status text; review jsonb; c jsonb; minimum integer; source_hash text; expected_reference text; citation jsonb; measured integer:=100; rating integer; first_rating integer; second_rating integer; dimension text;
begin
  select * into slot from public.discovery_curriculum_slots where publication_date=p_date for update;
  if not found or slot.status<>'generating' or slot.lease_owner is distinct from p_run or slot.lease_until<now() or slot.attempts<>p_attempt then raise exception 'Generation lease changed or expired'; end if;
  if not exists(select 1 from public.discovery_generation_attempts where publication_date=p_date and generation_epoch=slot.generation_epoch and attempt=p_attempt and run_id=p_run and status='running') then raise exception 'Attempt is not active'; end if;
  if p_content is null then
    if jsonb_typeof(p_reasons)<>'array' or jsonb_array_length(p_reasons)=0 then raise exception 'Rejection reasons are required'; end if;
    update public.discovery_generation_attempts set status='rejected',verification=p_verification,candidate_sha256=p_verification->>'candidateSha256',evidence_score=(p_verification->>'evidenceScore')::integer,reason_codes=p_reasons,completed_at=now() where publication_date=p_date and generation_epoch=slot.generation_epoch and attempt=p_attempt;
    update public.discovery_curriculum_slots set status=case when attempts>=3 then 'exhausted' else 'generating' end,lease_until=case when attempts>=3 then null else lease_until end,updated_at=now() where publication_date=p_date;
    return jsonb_build_object('status',case when slot.attempts>=3 then 'exhausted' else 'retry' end);
  end if;
  -- Missing/NULL verdicts fail closed. No arithmetic average can hide one weak claim.
  if (p_verification->>'accepted')::boolean is distinct from true or p_verification->>'policyVersion' is distinct from 'discovery-evidence-v1'
    or coalesce((p_verification->>'evidenceScore')::integer,0)<95 or coalesce((p_verification->>'minimumScore')::integer,0)<95
    or jsonb_typeof(p_verification->'reviews') is distinct from 'array' or jsonb_array_length(p_verification->'reviews')<>2
    or coalesce(jsonb_array_length(p_verification->'reasons'),1)<>0 then raise exception 'Automated evidence gate did not pass'; end if;
  if p_content->>'kind' is distinct from 'biblical_text' or p_content->>'translation' is distinct from 'WEB' or p_content ? 'traditionLabel'
    or p_content->>'scopeNote' is distinct from 'This discovery describes what the cited passage says in the World English Bible.'
    or jsonb_array_length(p_content->'sources')<>1 or p_content->'sources'->0->>'type' is distinct from 'scripture'
    or jsonb_array_length(p_content->'claims') not between 1 and 3 or jsonb_array_length(p_content->'choices')<>4 then raise exception 'Only simple sourced Bible-text trivia can auto-approve'; end if;
  if (select count(distinct item->>'id') from jsonb_array_elements(p_content->'choices') item)<>4
    or (select count(distinct lower(btrim(item->>'text'))) from jsonb_array_elements(p_content->'choices') item)<>4
    or not exists(select 1 from jsonb_array_elements(p_content->'choices') item where item->>'id'=p_content->>'correctOptionId' and length(btrim(item->>'text'))>0 and position(lower(item->>'text') in lower(p_content->'sources'->0->>'excerpt'))>0)
    or not exists(select 1 from jsonb_array_elements(p_content->'explanationClaimIds') item where item#>>'{}'=p_content->>'answerClaimId') then raise exception 'Answer and explanation structure is invalid'; end if;
  select source_sha256 into source_hash from public.discovery_generation_attempts where publication_date=p_date and generation_epoch=slot.generation_epoch and attempt=p_attempt;
  if p_verification->>'sourceSha256' is distinct from source_hash or encode(sha256(convert_to(p_content->'sources'->0->>'excerpt','UTF8')),'hex') is distinct from source_hash then raise exception 'Source hash mismatch'; end if;
  select day->>'sourceReference' into expected_reference from public.discovery_week_plans w,jsonb_array_elements(w.plan->'days') day where w.start_date=slot.week_start and day->>'date'=p_date::text;
  if p_content->>'scriptureReference' is distinct from expected_reference or p_content->'sources'->0->>'locator' is distinct from expected_reference then raise exception 'Source reference differs from the curriculum'; end if;
  if p_verification->>'corpusSha256' is distinct from (select corpus_sha256 from public.discovery_generation_runs where id=p_run) then raise exception 'Corpus version differs from the run'; end if;
  minimum:=greatest(95,(p_verification->>'minimumScore')::integer);
  if p_content->'difficulty' is distinct from p_verification->'difficulty' or p_content->'difficulty'->>'rubricVersion' is distinct from 'discovery-difficulty-v1' or (p_content->'difficulty'->>'score')::int not between 0 and 8 or p_content->'difficulty'->>'level' is distinct from (case when (p_content->'difficulty'->>'score')::int<=2 then 'easy' when (p_content->'difficulty'->>'score')::int<=5 then 'moderate' else 'challenging' end) then raise exception 'Difficulty must match the independently assessed rubric'; end if;
  if (select count(distinct r->>'model') from jsonb_array_elements(p_verification->'reviews') r)<>2
    or (select count(distinct r->>'requestedModel') from jsonb_array_elements(p_verification->'reviews') r)<>2 then raise exception 'Two distinct review models are required'; end if;
  for review in select value from jsonb_array_elements(p_verification->'reviews') loop
    if coalesce((review->>'questionAccuracy')::int,0) not between minimum and 100 or coalesce((review->>'scopeAccuracy')::int,0) not between minimum and 100 or coalesce((review->>'explanationCoverage')::int,0) not between minimum and 100
      or (review->>'simpleTextualFact')::boolean is distinct from true or review->>'solvedOptionId' is distinct from p_content->>'correctOptionId'
      or coalesce(jsonb_array_length(review->'unresolvedIssues'),1)<>0 or coalesce(jsonb_array_length(review->'claims'),0)<>jsonb_array_length(p_content->'claims')
      or coalesce(jsonb_array_length(review->'options'),0)<>4 or (select count(*) from jsonb_array_elements(review->'options') item where item->>'status'='supported')<>1 then raise exception 'Incomplete or weak verifier assessment'; end if;
    measured:=least(measured,(review->>'questionAccuracy')::int,(review->>'scopeAccuracy')::int,(review->>'explanationCoverage')::int);
    rating:=0;
    foreach dimension in array array['familiarity','evidenceNavigation','reasoningSteps','distractorSimilarity'] loop
      if coalesce((review->'difficulty'->>dimension)::int,-1) not between 0 and 2 then raise exception 'Difficulty dimension outside the rubric'; end if;
      rating:=rating+(review->'difficulty'->>dimension)::int;
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
        if citation->>'sourceId' is distinct from 'passage' or coalesce(length(btrim(citation->>'quote')),0)<5
          or position(regexp_replace(btrim(citation->>'quote'),'\s+',' ','g') in regexp_replace(p_content->'sources'->0->>'excerpt','\s+',' ','g'))=0 then raise exception 'Supporting quotation is absent from the source'; end if;
      end loop;
    end loop;
    for c in select value from jsonb_array_elements(review->'options') loop
      if coalesce((c->>'confidence')::int,0) not between minimum and 100 or c->>'status' is distinct from (case when c->>'optionId'=p_content->>'correctOptionId' then 'supported' else 'not_supported' end) then raise exception 'Ambiguous or weak answer assessment'; end if;
      measured:=least(measured,(c->>'confidence')::int);
      if c->>'optionId'=p_content->>'correctOptionId' and coalesce(jsonb_array_length(c->'evidence'),0)=0 then raise exception 'Correct answer lacks evidence'; end if;
      for citation in select value from jsonb_array_elements(c->'evidence') loop
        if citation->>'sourceId' is distinct from 'passage' or coalesce(length(btrim(citation->>'quote')),0)<5
          or position(regexp_replace(btrim(citation->>'quote'),'\s+',' ','g') in regexp_replace(p_content->'sources'->0->>'excerpt','\s+',' ','g'))=0 then raise exception 'Answer quotation is absent from the source'; end if;
      end loop;
    end loop;
  end loop;
  if abs(first_rating-second_rating)>2 or (p_content->'difficulty'->>'score')::int<>round((first_rating+second_rating)/2.0)::int then raise exception 'Difficulty must reflect reviewer consensus'; end if;
  if measured<>(p_verification->>'evidenceScore')::int then raise exception 'Evidence score must be the weakest assessed dimension'; end if;
  if exists(select 1 from public.discovery_schedule where publication_date=p_date and locale='en') then
    update public.discovery_curriculum_slots set status='superseded',lease_until=null,updated_at=now() where publication_date=p_date;
    update public.discovery_generation_attempts set status='superseded',verification=p_verification,completed_at=now() where publication_date=p_date and generation_epoch=slot.generation_epoch and attempt=p_attempt;
    return '{"status":"occupied"}'::jsonb;
  end if;
  if exists(select 1 from public.discovery_revisions where lower(btrim(content->>'prompt'))=lower(btrim(p_content->>'prompt'))) then raise exception 'Duplicate discovery question'; end if;
  new_id:=gen_random_uuid();
  insert into public.discoveries(id,slug) values (new_id,'discovery-'||p_date::text||'-'||left(new_id::text,8));
  insert into public.discovery_revisions(discovery_id,revision,content) values (new_id,1,p_content);
  final_status:='awaiting_review';
  if p_auto_approve then
    insert into public.discovery_reviews(discovery_id,revision,review_method,note,attestations) values (new_id,1,'automated_evidence','Automatically approved under discovery-evidence-v1; this is not a human review or a calibrated probability of truth.',jsonb_build_object('sourceTextExact',true,'twoVerifierAgreement',true,'allClaimsSupported',true,'oneUnambiguousAnswer',true,'difficultyAssessed',true,'policyVersion','discovery-evidence-v1','runId',p_run,'evidenceScore',(p_verification->>'evidenceScore')::int));
    insert into public.discovery_schedule(publication_date,discovery_id,revision) values (p_date,new_id,1) on conflict do nothing;
    if found then final_status:='scheduled'; else final_status:='superseded'; end if;
  end if;
  update public.discovery_curriculum_slots set status=final_status,discovery_id=new_id,question_fingerprint=p_verification->>'questionFingerprint',lease_until=null,updated_at=now() where publication_date=p_date;
  update public.discovery_generation_attempts set status=case when final_status='scheduled' then 'auto_approved' else final_status end,candidate_sha256=encode(sha256(convert_to(p_content::text,'UTF8')),'hex'),evidence_score=(p_verification->>'evidenceScore')::int,verification=p_verification,reason_codes='[]',completed_at=now() where publication_date=p_date and generation_epoch=slot.generation_epoch and attempt=p_attempt;
  return jsonb_build_object('status',final_status,'discoveryId',new_id,'revision',1);
end $$;
create function public.discovery_curriculum_retry(p_date date,p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.discovery_require_admin(p_actor);
  update public.discovery_curriculum_slots set status='pending',attempts=0,generation_epoch=generation_epoch+1,lease_owner=null,lease_until=null,updated_at=now() where publication_date=p_date and status='exhausted';
  if not found then raise exception 'Only an exhausted slot can be explicitly retried'; end if;
end $$;
alter table public.discovery_week_plans enable row level security;
alter table public.discovery_week_plans force row level security;
alter table public.discovery_generation_runs enable row level security;
alter table public.discovery_generation_runs force row level security;
alter table public.discovery_curriculum_slots enable row level security;
alter table public.discovery_curriculum_slots force row level security;
alter table public.discovery_generation_attempts enable row level security;
alter table public.discovery_generation_attempts force row level security;
revoke all on public.discovery_week_plans,public.discovery_generation_runs,public.discovery_curriculum_slots,public.discovery_generation_attempts from anon,authenticated;
grant all on public.discovery_week_plans,public.discovery_generation_runs,public.discovery_curriculum_slots,public.discovery_generation_attempts to service_role;
revoke all on function public.discovery_curriculum_claim(date,date,uuid),public.discovery_curriculum_begin_attempt(date,uuid,text),public.discovery_curriculum_finish_attempt(date,uuid,integer,jsonb,jsonb,jsonb,boolean),public.discovery_curriculum_retry(date,uuid) from public,anon,authenticated;
grant execute on function public.discovery_curriculum_claim(date,date,uuid),public.discovery_curriculum_begin_attempt(date,uuid,text),public.discovery_curriculum_finish_attempt(date,uuid,integer,jsonb,jsonb,jsonb,boolean),public.discovery_curriculum_retry(date,uuid) to service_role;
commit;
