-- Atomically merge a duplicate CRM profile into a surviving tenant profile.
create or replace function public.merge_crm_profiles(
  requested_congregation_id bigint,
  target_profile_id uuid,
  source_profile_id uuid,
  actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_profile_id = source_profile_id then raise exception 'MERGE_INVALID'; end if;
  if not exists (select 1 from public.church_crm_profiles where id = target_profile_id and congregation_id = requested_congregation_id and deleted_at is null)
     or not exists (select 1 from public.church_crm_profiles where id = source_profile_id and congregation_id = requested_congregation_id and deleted_at is null)
  then raise exception 'MERGE_PROFILE_NOT_FOUND'; end if;

  delete from public.communication_preferences s using public.communication_preferences t
    where s.congregation_id=requested_congregation_id and s.profile_id=source_profile_id and t.congregation_id=s.congregation_id and t.profile_id=target_profile_id;
  update public.communication_preferences set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id;

  delete from public.communication_group_members s using public.communication_group_members t
    where s.profile_id=source_profile_id and t.profile_id=target_profile_id and t.group_id=s.group_id;
  update public.communication_group_members set profile_id=target_profile_id where profile_id=source_profile_id;

  delete from public.message_deliveries s using public.message_deliveries t
    where s.congregation_id=requested_congregation_id and s.profile_id=source_profile_id and t.message_id=s.message_id and t.profile_id=target_profile_id and t.channel=s.channel;
  update public.message_deliveries set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id;

  delete from public.event_registrations s using public.event_registrations t
    where s.congregation_id=requested_congregation_id and s.profile_id=source_profile_id and t.event_id=s.event_id and t.profile_id=target_profile_id;
  update public.event_registrations set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id;

  delete from public.guardian_relationships s using public.guardian_relationships t
    where s.congregation_id=requested_congregation_id and ((s.guardian_profile_id=source_profile_id and t.guardian_profile_id=target_profile_id and t.child_profile_id=s.child_profile_id) or (s.child_profile_id=source_profile_id and t.child_profile_id=target_profile_id and t.guardian_profile_id=s.guardian_profile_id));
  delete from public.guardian_relationships where congregation_id=requested_congregation_id
    and ((guardian_profile_id=source_profile_id and child_profile_id=target_profile_id) or (guardian_profile_id=target_profile_id and child_profile_id=source_profile_id));
  update public.guardian_relationships set guardian_profile_id=target_profile_id where congregation_id=requested_congregation_id and guardian_profile_id=source_profile_id;
  update public.guardian_relationships set child_profile_id=target_profile_id where congregation_id=requested_congregation_id and child_profile_id=source_profile_id;

  update public.person_timeline_events set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id;
  update public.care_cases set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id;
  update public.check_ins s set deleted_at=now(), deleted_by=actor_user_id, deletion_reason='Merged duplicate check-in'
    where s.congregation_id=requested_congregation_id and s.profile_id=source_profile_id and s.deleted_at is null
      and exists (select 1 from public.check_ins t where t.event_id=s.event_id and t.profile_id=target_profile_id and t.deleted_at is null);
  update public.check_ins set profile_id=target_profile_id where congregation_id=requested_congregation_id and profile_id=source_profile_id and deleted_at is null;
  update public.gifts set donor_profile_id=target_profile_id where congregation_id=requested_congregation_id and donor_profile_id=source_profile_id;
  update public.recurring_gifts set donor_profile_id=target_profile_id where congregation_id=requested_congregation_id and donor_profile_id=source_profile_id;
  update public.medical_alerts set child_profile_id=target_profile_id where congregation_id=requested_congregation_id and child_profile_id=source_profile_id;
  update public.pastoral_notes set crm_profile_id=target_profile_id where crm_profile_id=source_profile_id;

  update public.church_crm_profiles set merged_into_id=target_profile_id, deleted_at=now(), deleted_by=actor_user_id, deletion_reason='Merged duplicate'
    where id=source_profile_id and congregation_id=requested_congregation_id;
  return target_profile_id;
end;
$$;

revoke all on function public.merge_crm_profiles(bigint,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.merge_crm_profiles(bigint,uuid,uuid,uuid) to service_role;
