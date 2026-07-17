begin;

-- Legacy tenant tables were reconstructed without RLS. Enforce tenant boundaries
-- consistently before granting any authenticated direct-client access.
alter table public.bible_studies enable row level security;
alter table public.bible_studies force row level security;
alter table public.check_ins enable row level security;
alter table public.check_ins force row level security;
alter table public.church_crm_profiles enable row level security;
alter table public.church_crm_profiles force row level security;
alter table public.congregation_members enable row level security;
alter table public.congregation_members force row level security;
alter table public.congregations enable row level security;
alter table public.congregations force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.prayer_requests enable row level security;
alter table public.prayer_requests force row level security;
alter table public.volunteer_roles enable row level security;
alter table public.volunteer_roles force row level security;

create or replace function public.is_congregation_member(requested_congregation_id integer, requested_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.congregation_members m where m.congregation_id = requested_congregation_id and m.user_id = requested_user_id);
$$;
revoke all on function public.is_congregation_member(integer,uuid) from public;
grant execute on function public.is_congregation_member(integer,uuid) to authenticated, service_role;

create policy congregations_tenant_read on public.congregations for select to authenticated using (
  public.is_congregation_member(congregation_id) or
  exists (select 1 from public.organization_memberships m where m.congregation_id = congregations.congregation_id and m.user_id = auth.uid() and m.active)
);
create policy congregations_staff_update on public.congregations for update to authenticated
using (public.has_congregation_capability(congregation_id, 'staff.manage'))
with check (public.has_congregation_capability(congregation_id, 'staff.manage'));

create policy congregation_members_self_or_staff_read on public.congregation_members for select to authenticated using (
  user_id = auth.uid() or public.has_congregation_capability(congregation_id, 'people.read')
);
create policy congregation_members_staff_write on public.congregation_members for all to authenticated
using (public.has_congregation_capability(congregation_id, 'people.write'))
with check (public.has_congregation_capability(congregation_id, 'people.write'));

create policy crm_profiles_self_or_staff_read on public.church_crm_profiles for select to authenticated using (
  user_id = auth.uid() or public.has_congregation_capability(congregation_id::integer, 'people.read')
);
create policy crm_profiles_staff_write on public.church_crm_profiles for all to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'people.write'))
with check (public.has_congregation_capability(congregation_id::integer, 'people.write'));

create policy households_staff_read on public.households for select to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'people.read'));
create policy households_staff_write on public.households for all to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'people.write'))
with check (public.has_congregation_capability(congregation_id::integer, 'people.write'));

create policy prayers_owner_or_care_read on public.prayer_requests for select to authenticated using (
  user_id = auth.uid() or public.has_congregation_capability(congregation_id::integer, 'care.read')
);
create policy prayers_member_insert on public.prayer_requests for insert to authenticated with check (
  user_id = auth.uid() and public.is_congregation_member(congregation_id::integer)
);
create policy prayers_owner_or_care_update on public.prayer_requests for update to authenticated
using (user_id = auth.uid() or public.has_congregation_capability(congregation_id::integer, 'care.write'))
with check (user_id = auth.uid() or public.has_congregation_capability(congregation_id::integer, 'care.write'));
create policy prayers_owner_or_care_delete on public.prayer_requests for delete to authenticated
using (user_id = auth.uid() or public.has_congregation_capability(congregation_id::integer, 'care.write'));

create policy events_tenant_read on public.events for select to authenticated using (
  (is_public and public.is_congregation_member(congregation_id::integer)) or public.has_congregation_capability(congregation_id::integer, 'events.read')
);
create policy events_staff_write on public.events for all to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'events.write'))
with check (public.has_congregation_capability(congregation_id::integer, 'events.write'));

create policy volunteer_roles_tenant_read on public.volunteer_roles for select to authenticated using (
  public.is_congregation_member(congregation_id::integer) or public.has_congregation_capability(congregation_id::integer, 'volunteers.read')
);
create policy volunteer_roles_staff_write on public.volunteer_roles for all to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'volunteers.write'))
with check (public.has_congregation_capability(congregation_id::integer, 'volunteers.write'));

create policy check_ins_authorized_read on public.check_ins for select to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'check_in.read'));
create policy check_ins_authorized_write on public.check_ins for all to authenticated
using (public.has_congregation_capability(congregation_id::integer, 'check_in.write'))
with check (public.has_congregation_capability(congregation_id::integer, 'check_in.write'));

create policy bible_studies_tenant_read on public.bible_studies for select to authenticated using (
  user_id = auth.uid() or public.has_congregation_capability(congregation_id, 'content.read') or
  (is_published and public.is_congregation_member(congregation_id))
);
create policy bible_studies_author_write on public.bible_studies for all to authenticated
using (user_id = auth.uid() and public.has_congregation_capability(congregation_id, 'content.write'))
with check (user_id = auth.uid() and public.has_congregation_capability(congregation_id, 'content.write'));

revoke all on table public.bible_studies, public.check_ins, public.church_crm_profiles, public.congregation_members,
  public.congregations, public.events, public.households, public.prayer_requests, public.volunteer_roles from anon;
grant select, insert, update, delete on table public.bible_studies, public.check_ins, public.church_crm_profiles,
  public.congregation_members, public.events, public.households, public.prayer_requests, public.volunteer_roles to authenticated;
grant select, update on table public.congregations to authenticated;

commit;
