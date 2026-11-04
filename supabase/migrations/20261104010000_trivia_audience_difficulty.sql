-- New general-audience rubric; preserve the old validator and every saved rating.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
alter function public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text) rename to discovery_validate_set_candidate_pre_v3;
create function public.discovery_validate_set_candidate(p_content jsonb,p_verification jsonb,source_hash text,expected_reference text,p_corpus_sha256 text,p_difficulty text) returns void
language plpgsql security definer set search_path=public as $$
declare review jsonb; c jsonb; minimum integer; citation jsonb; measured integer:=100; rating integer; first_rating integer; second_rating integer; dimension text; craft_score integer; craft_minimum integer:=8; passage_start integer; passage_end integer; rubric text;
begin
  rubric:=p_content->'difficulty'->>'rubricVersion';
  if rubric is distinct from 'discovery-difficulty-v3' then
    perform public.discovery_validate_set_candidate_pre_v3(p_content,p_verification,source_hash,expected_reference,p_corpus_sha256,p_difficulty); return;
  end if;
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
  if p_content->'difficulty' is distinct from p_verification->'difficulty' or coalesce(rubric,'') not in ('discovery-difficulty-v1','discovery-difficulty-v2','discovery-difficulty-v3') or (p_content->'difficulty'->>'score')::int not between 0 and (case when rubric='discovery-difficulty-v3' then 5 when rubric='discovery-difficulty-v2' then 10 else 8 end) or p_content->'difficulty'->>'level' is distinct from (case when (p_content->'difficulty'->>'score')::int<=(case when rubric='discovery-difficulty-v3' then 0 when rubric='discovery-difficulty-v2' then 3 else 2 end) then 'easy' when (p_content->'difficulty'->>'score')::int<=(case when rubric='discovery-difficulty-v3' then 2 when rubric='discovery-difficulty-v2' then 6 else 5 end) then 'moderate' else 'challenging' end) then raise exception 'Difficulty must match the independently assessed rubric'; end if;
  if (select count(distinct r->>'model') from jsonb_array_elements(p_verification->'reviews') r)<>2
    or (select count(distinct r->>'requestedModel') from jsonb_array_elements(p_verification->'reviews') r)<>2 then raise exception 'Two distinct review models are required'; end if;
  for review in select value from jsonb_array_elements(p_verification->'reviews') loop
    if rubric in ('discovery-difficulty-v2','discovery-difficulty-v3') and (review->'difficultyAssessment'->>'rubricVersion' is distinct from rubric
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
      if coalesce((review->'difficulty'->>dimension)::int,-1) not between 0 and (case when rubric='discovery-difficulty-v3' then 1 else 2 end) then raise exception 'Difficulty dimension outside the rubric'; end if;
      rating:=rating+(review->'difficulty'->>dimension)::int*(case when rubric in ('discovery-difficulty-v2','discovery-difficulty-v3') and dimension='familiarity' then 2 else 1 end);
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
  if abs(first_rating-second_rating)>2 or (p_content->'difficulty'->>'score')::int<>floor((first_rating+second_rating)/2.0)::int then raise exception 'Difficulty must reflect reviewer consensus'; end if;
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

revoke all on function public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text) to service_role;
do $m$
declare d text:=pg_get_functiondef('public.discovery_daily_publish(date,uuid,jsonb)'::regprocedure);
begin
 -- A v7 final editor uses the new general-audience standard. Older saved sets retain their own reviews.
 if position('sanctuary-trivia-set-editor-v4' in d)=0 then raise exception 'Unexpected set editor function'; end if;
 d:=replace(d,'r->>''setEditorialVersion'' is distinct from ''sanctuary-trivia-set-editor-v4''','coalesce(r->>''setEditorialVersion'','''') not in (''sanctuary-trivia-set-editor-v4'',''sanctuary-trivia-set-editor-v5'',''sanctuary-trivia-set-editor-v7'')');
 -- Handles the previous learning migration, when already installed.
 d:=replace(d,'''sanctuary-trivia-set-editor-v4'',''sanctuary-trivia-set-editor-v5'')','''sanctuary-trivia-set-editor-v4'',''sanctuary-trivia-set-editor-v5'',''sanctuary-trivia-set-editor-v7'')');
 d:=replace(d,'  week_context:=public.discovery_daily_week_context(p_date);',
 '  if p_date>=date ''2026-11-04'' and exists(select 1 from public.discovery_daily_attempts where publication_date=p_date and epoch=job.epoch and status=''accepted'' and content->''difficulty''->>''rubricVersion'' is distinct from ''discovery-difficulty-v3'') then raise exception ''General audience difficulty v3 required for new daily sets''; end if;
  week_context:=public.discovery_daily_week_context(p_date);');
 execute d;
 d:=pg_get_functiondef('public.discovery_daily_finish(date,integer,uuid,integer,jsonb,jsonb,jsonb)'::regprocedure);
 if position('  perform public.discovery_validate_set_candidate(' in d)=0 then raise exception 'Unexpected daily finish function'; end if;
 d:=replace(d,'  perform public.discovery_validate_set_candidate(',
 '  if p_date>=date ''2026-11-04'' and p_content->''difficulty''->>''rubricVersion'' is distinct from ''discovery-difficulty-v3'' then raise exception ''General audience difficulty v3 required for new daily sets''; end if;
  perform public.discovery_validate_set_candidate(');
 execute d;
end $m$;
commit;
