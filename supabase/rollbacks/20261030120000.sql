begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Restore v1 backend workers before this rollback. Existing v2 audit records
-- remain intact; no content, approval, schedule, or history is deleted.
do $rollback$
declare
  definition text := pg_get_functiondef('public.discovery_curriculum_finish_attempt(date,uuid,integer,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  old_gate text := $old$p_verification->'questionCraft'->>'policyVersion' is distinct from 'discovery-question-craft-v1'$old$;
  new_gate text := $new$coalesce(p_verification->'questionCraft'->>'policyVersion','') not in ('discovery-question-craft-v1','discovery-question-craft-v2')$new$;
  old_attestation text := $old$'questionCraftPolicy','discovery-question-craft-v1'$old$;
  new_attestation text := $new$'questionCraftPolicy',p_verification->'questionCraft'->>'policyVersion'$new$;
begin
  if position(old_gate in definition)>0 and position(old_attestation in definition)>0 then return; end if;
  if position(new_gate in definition)=0 or position(new_attestation in definition)=0 then
    raise exception 'Unexpected trivia acceptance function; review craft-version rollback before applying';
  end if;
  execute replace(replace(definition,new_gate,old_gate),new_attestation,old_attestation);
end;
$rollback$;

commit;
