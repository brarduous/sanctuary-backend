begin;

alter table public.event_volunteers add column if not exists congregation_id integer references public.congregations(congregation_id) on delete cascade;
update public.event_volunteers ev set congregation_id=e.congregation_id from public.events e where e.id=ev.event_id and ev.congregation_id is null;
alter table public.event_volunteers alter column congregation_id set not null;

alter table public.role_members add column if not exists congregation_id integer references public.congregations(congregation_id) on delete cascade;
update public.role_members rm set congregation_id=vr.congregation_id from public.volunteer_roles vr where vr.id=rm.role_id and rm.congregation_id is null;
alter table public.role_members alter column congregation_id set not null;

create or replace function public.enforce_volunteer_tenant() returns trigger language plpgsql as $$
declare expected integer;
begin
  if tg_table_name='event_volunteers' then
    select e.congregation_id into expected from public.events e where e.id=new.event_id;
    if expected is null or expected<>new.congregation_id or not exists(select 1 from public.volunteer_roles r where r.id=new.role_id and r.congregation_id=expected) then raise exception 'Volunteer assignment tenant mismatch'; end if;
  else
    select r.congregation_id into expected from public.volunteer_roles r where r.id=new.role_id;
    if expected is null or expected<>new.congregation_id then raise exception 'Team membership tenant mismatch'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists event_volunteers_tenant_guard on public.event_volunteers;
create trigger event_volunteers_tenant_guard before insert or update on public.event_volunteers for each row execute function public.enforce_volunteer_tenant();
drop trigger if exists role_members_tenant_guard on public.role_members;
create trigger role_members_tenant_guard before insert or update on public.role_members for each row execute function public.enforce_volunteer_tenant();

alter table public.event_volunteers enable row level security;
alter table public.event_volunteers force row level security;
alter table public.role_members enable row level security;
alter table public.role_members force row level security;
revoke all on public.event_volunteers,public.role_members from anon;
drop policy if exists event_volunteers_staff_or_self_read on public.event_volunteers;
create policy event_volunteers_staff_or_self_read on public.event_volunteers for select to authenticated using(user_id=auth.uid() or public.has_congregation_capability(congregation_id,'volunteers.read',auth.uid(),null::bigint));
drop policy if exists event_volunteers_staff_write on public.event_volunteers;
create policy event_volunteers_staff_write on public.event_volunteers for all to authenticated using(public.has_congregation_capability(congregation_id,'volunteers.write',auth.uid(),null::bigint)) with check(public.has_congregation_capability(congregation_id,'volunteers.write',auth.uid(),null::bigint));
drop policy if exists role_members_staff_or_self_read on public.role_members;
create policy role_members_staff_or_self_read on public.role_members for select to authenticated using(user_id=auth.uid() or public.has_congregation_capability(congregation_id,'volunteers.read',auth.uid(),null::bigint));
drop policy if exists role_members_staff_write on public.role_members;
create policy role_members_staff_write on public.role_members for all to authenticated using(public.has_congregation_capability(congregation_id,'volunteers.write',auth.uid(),null::bigint)) with check(public.has_congregation_capability(congregation_id,'volunteers.write',auth.uid(),null::bigint));

commit;
