-- Deploy before the clients: 20 seconds reading + 20 seconds answering.
-- Existing 20-second rounds/outbox events remain valid during rollout.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
alter table public.discovery_completions drop constraint discovery_completions_elapsed_ms_check;
alter table public.discovery_completions add constraint discovery_completions_elapsed_ms_check check (elapsed_ms between 0 and 40000);
do $migration$
declare
  definition text := pg_get_functiondef('public.discovery_complete(uuid,jsonb)'::regprocedure);
  old_limit text := 'elapsed not between 0 and 20000 or (e->>''mode'' = ''answered'' and elapsed >= 20000)';
  old_timeout text := 'elapsed is distinct from 20000';
begin
  if position(old_limit in definition)=0 or position(old_timeout in definition)=0 then
    raise exception 'Unexpected trivia completion function; review reading-time migration';
  end if;
  execute replace(replace(definition,old_limit,'elapsed not between 0 and 40000 or (e->>''mode'' = ''answered'' and elapsed >= 40000)'),old_timeout,'(elapsed is null or elapsed not in (20000,40000))');
end;
$migration$;
commit;
