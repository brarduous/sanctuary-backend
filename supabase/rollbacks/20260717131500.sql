\echo 'Rollback 20260717131500 restores the bigint capability function signature.'
begin;
drop function if exists public.has_congregation_capability(integer,text,uuid,bigint) cascade;
create function public.has_congregation_capability(requested_congregation_id bigint, requested_capability text, requested_user_id uuid default auth.uid(), requested_campus_id bigint default null)
returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.organization_memberships m left join public.role_capabilities d on d.role=m.role and d.capability=requested_capability::public.capability left join public.capability_overrides o on o.membership_id=m.id and o.capability=requested_capability::public.capability where m.congregation_id=requested_congregation_id and m.user_id=requested_user_id and m.active and coalesce(o.allowed,d.capability is not null)); $$;
revoke all on function public.has_congregation_capability(bigint,text,uuid,bigint) from public;
grant execute on function public.has_congregation_capability(bigint,text,uuid,bigint) to authenticated,service_role;
commit;
