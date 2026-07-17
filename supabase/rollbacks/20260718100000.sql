-- Rollback is intentionally limited to the additive operations objects.
-- Run only in an approved window after confirming no production records depend on them.
drop table if exists public.ai_generation_runs, public.content_versions, public.gift_refunds, public.gifts, public.recurring_gifts,
  public.giving_batches, public.giving_funds, public.checkin_labels, public.volunteer_rotations, public.volunteer_availability,
  public.volunteer_profiles, public.event_registrations, public.event_resource_bookings, public.event_resources, public.care_cases,
  public.person_timeline_events, public.person_segments, public.message_deliveries, public.communication_preferences,
  public.communication_group_members, public.communication_groups, public.checkin_rooms cascade;
