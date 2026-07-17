begin;

drop policy if exists memberships_visible_to_staff on public.organization_memberships;
drop policy if exists campuses_visible_to_staff on public.campuses;
drop policy if exists audit_visible_to_authorized_staff on public.audit_events;
drop policy if exists guardians_visible_to_checkin on public.guardian_relationships;
drop policy if exists medical_visible_to_checkin on public.medical_alerts;
drop policy if exists kiosk_visible_to_checkin on public.kiosk_sessions;
drop policy if exists pickup_visible_to_checkin on public.pickup_credentials;

drop function if exists public.has_congregation_capability(bigint,text,uuid,bigint);
drop function if exists public.has_congregation_capability(integer,text,uuid,bigint);

create function public.has_congregation_capability(
  requested_congregation_id integer,
  requested_capability text,
  requested_user_id uuid default auth.uid(),
  requested_campus_id bigint default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_memberships membership
    left join public.role_capabilities defaults
      on defaults.role = membership.role and defaults.capability = requested_capability::public.capability
    left join public.capability_overrides override
      on override.membership_id = membership.id and override.capability = requested_capability::public.capability
    where membership.congregation_id = requested_congregation_id
      and membership.user_id = requested_user_id
      and membership.active
      and (membership.campus_id is null or requested_campus_id is null or membership.campus_id = requested_campus_id)
      and coalesce(override.allowed, defaults.capability is not null)
  );
$$;

revoke all on function public.has_congregation_capability(integer,text,uuid,bigint) from public;
grant execute on function public.has_congregation_capability(integer,text,uuid,bigint) to authenticated, service_role;

create policy memberships_visible_to_staff on public.organization_memberships for select to authenticated
using (user_id = auth.uid() or public.has_congregation_capability(congregation_id, 'staff.manage', auth.uid(), null::bigint));
create policy campuses_visible_to_staff on public.campuses for select to authenticated
using (exists (select 1 from public.organization_memberships m where m.congregation_id = campuses.congregation_id and m.user_id = auth.uid() and m.active));
create policy audit_visible_to_authorized_staff on public.audit_events for select to authenticated
using (public.has_congregation_capability(congregation_id, 'audit.read', auth.uid(), null::bigint));
create policy guardians_visible_to_checkin on public.guardian_relationships for select to authenticated
using (public.has_congregation_capability(congregation_id, 'check_in.read', auth.uid(), null::bigint));
create policy medical_visible_to_checkin on public.medical_alerts for select to authenticated
using (public.has_congregation_capability(congregation_id, 'check_in.read', auth.uid(), null::bigint));
create policy kiosk_visible_to_checkin on public.kiosk_sessions for select to authenticated
using (public.has_congregation_capability(congregation_id, 'check_in.read', auth.uid(), null::bigint));
create policy pickup_visible_to_checkin on public.pickup_credentials for select to authenticated
using (public.has_congregation_capability(congregation_id, 'check_in.read', auth.uid(), null::bigint));

commit;
