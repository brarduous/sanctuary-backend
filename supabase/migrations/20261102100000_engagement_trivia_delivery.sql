begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.discovery_runtime_settings add column if not exists recycle_unplayed_sets boolean not null default false;
alter table public.discovery_metrics add column if not exists audience_eligible boolean not null default false;
create table if not exists public.discovery_delivery_days(
 presentation_date date primary key,
 source_date date not null references public.discovery_daily_sets(publication_date),
 history jsonb not null default '[]',
 created_at timestamptz not null default now()
);
alter table public.discovery_delivery_days enable row level security;
revoke all on public.discovery_delivery_days from public,anon,authenticated;
grant all on public.discovery_delivery_days to service_role;
create or replace view public.discovery_delivery_items with(security_invoker=true) as
 select d.presentation_date as publication_date,d.source_date as source_publication_date,i.discovery_id,i.revision,i.position
 from public.discovery_delivery_days d join public.discovery_daily_set_items i on i.publication_date=d.source_date;
revoke all on public.discovery_delivery_items from public,anon,authenticated;
grant select on public.discovery_delivery_items to service_role;
create or replace function public.discovery_is_internal(p_user uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select p_user is not null and (
 exists(select 1 from public.user_profiles where user_id=p_user and role='admin')
 or exists(select 1 from public.discovery_runtime_settings where p_user=any(internal_user_ids))
 or exists(select 1 from auth.users u join public.admin_emails a on lower(a.email)=lower(u.email) where u.id=p_user)
 or exists(select 1 from auth.users u where u.id=p_user and u.raw_user_meta_data->>'quality_test'='true'));
$$;
create or replace function public.discovery_delivery_set(p_date date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen date; prior date; replacement date;
begin
 if p_date<(now() at time zone 'UTC')::date-90 or p_date>(now() at time zone 'Pacific/Kiritimati')::date then raise exception 'Delivery date outside released window'; end if;
 perform pg_advisory_xact_lock(91020261102100000);
 select source_date into chosen from public.discovery_delivery_days where presentation_date=p_date;
 if not found then
  select source_date into prior from public.discovery_delivery_days where presentation_date<p_date order by presentation_date desc limit 1;
  if prior is not null and (select count(*) from public.discovery_daily_set_items i join public.discoveries d on d.id=i.discovery_id where i.publication_date=prior and not d.withdrawn)=3
   and not exists(select 1 from public.discovery_completions c join public.discovery_daily_set_items i on i.discovery_id=c.discovery_id where i.publication_date=prior and c.mode='answered' and not public.discovery_is_internal(c.user_id))
   and not exists(select 1 from public.discovery_metrics m join public.discovery_daily_set_items i on i.discovery_id=m.discovery_id where i.publication_date=prior and m.event='answer_committed' and m.audience_eligible)
  then chosen:=prior;
  else
   select i.publication_date into chosen from public.discovery_daily_set_items i join public.discoveries d on d.id=i.discovery_id
    where i.publication_date<=p_date and (prior is null or i.publication_date>prior)
    group by i.publication_date having count(*)=3 and bool_and(not d.withdrawn)
    order by case when prior is null then -extract(epoch from i.publication_date::timestamp) else extract(epoch from i.publication_date::timestamp) end limit 1;
   if chosen is null and prior is not null and (select count(*) from public.discovery_daily_set_items i join public.discoveries d on d.id=i.discovery_id where i.publication_date=prior and not d.withdrawn)=3 then chosen:=prior; end if;
  end if;
  if chosen is null then return '[]'::jsonb; end if;
  insert into public.discovery_delivery_days(presentation_date,source_date) values(p_date,chosen);
 end if;
 -- A withdrawal hides the entire coherent set, including cached delivery aliases.
 if (select count(*) from public.discovery_daily_set_items i join public.discoveries d on d.id=i.discovery_id where i.publication_date=chosen and not d.withdrawn)<>3 then
  select i.publication_date into replacement from public.discovery_daily_set_items i join public.discoveries d on d.id=i.discovery_id
   where i.publication_date<=p_date and i.publication_date<>chosen
   group by i.publication_date having count(*)=3 and bool_and(not d.withdrawn)
   order by case when i.publication_date>chosen then 0 else 1 end,
    case when i.publication_date>chosen then extract(epoch from i.publication_date::timestamp) else -extract(epoch from i.publication_date::timestamp) end limit 1;
  if replacement is null then return '[]'::jsonb; end if;
  update public.discovery_delivery_days set source_date=replacement,history=history||jsonb_build_array(jsonb_build_object('previousSourceDate',chosen,'at',now(),'reason','withdrawn_set_replaced')) where presentation_date=p_date;
  chosen:=replacement;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(i) order by position) from public.discovery_delivery_items i where publication_date=p_date),'[]'::jsonb);
end $$;
revoke all on function public.discovery_is_internal(uuid),public.discovery_delivery_set(date) from public,anon,authenticated;
grant execute on function public.discovery_is_internal(uuid),public.discovery_delivery_set(date) to service_role;
commit;
