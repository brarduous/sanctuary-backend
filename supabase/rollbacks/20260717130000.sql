\echo 'Rollback 20260717130000 preserves data by removing only new authorization objects.'
begin;
drop table if exists public.pickup_credentials, public.kiosk_sessions, public.medical_alerts, public.guardian_relationships, public.capability_overrides, public.role_capabilities, public.organization_memberships, public.campuses cascade;
drop function if exists public.prevent_audit_mutation() cascade;
drop function if exists public.has_congregation_capability(integer,text,uuid,bigint) cascade;
drop table if exists public.audit_events cascade;
drop type if exists public.capability;
drop type if exists public.staff_role;
commit;
