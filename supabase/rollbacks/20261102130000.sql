begin;
-- Backward-compatible telemetry columns/history remain for investigation.
-- Pause sends before rolling the application back to the legacy dispatcher.
update public.notification_runtime_settings set enabled=false,rollout_stage='dry_run',updated_at=now() where category='discovery';
commit;
