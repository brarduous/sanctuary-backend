-- Preserve historical rubric labels and published questions. Future candidates
-- use the lower edge of the existing relative bands and avoid specialist recall.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $migration$
declare
  definition text := pg_get_functiondef('public.discovery_validate_set_candidate(jsonb,jsonb,text,text,text,text)'::regprocedure);
  anchor text := 'if first_rating is null then first_rating:=rating; else second_rating:=rating; end if;';
  gate text := $gate$if (review->'difficulty'->>'familiarity')::int=2
      or ((review->'difficulty'->>'evidenceNavigation')::int=2 and (review->'difficulty'->>'reasoningSteps')::int=2)
      or (p_difficulty='moderate' and rating>4) or (p_difficulty='challenging' and rating>7)
      then raise exception 'Daily question is too difficult for learning'; end if;
    $gate$;
begin
  if position(anchor in definition)=0 then raise exception 'Unexpected daily difficulty function; review learning migration'; end if;
  execute replace(definition,anchor,gate||anchor);
  definition:=pg_get_functiondef('public.discovery_daily_publish(date,uuid,jsonb)'::regprocedure);
  if position('r->>''setEditorialVersion'' is distinct from ''sanctuary-trivia-set-editor-v4''' in definition)=0 then raise exception 'Unexpected daily editor gate; review learning migration'; end if;
  execute replace(definition,'r->>''setEditorialVersion'' is distinct from ''sanctuary-trivia-set-editor-v4''','coalesce(r->>''setEditorialVersion'','''') not in (''sanctuary-trivia-set-editor-v4'',''sanctuary-trivia-set-editor-v5'')');
end;
$migration$;
commit;
