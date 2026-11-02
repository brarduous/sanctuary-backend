-- Stop the automatic replacement cron and disable CONTENT_QUALITY_AUTOREPAIR_ENABLED first.
-- Preserve private version history and withheld content; never republish a failed candidate.
update public.content_quality_replacements set status='protected',lease_token=null,lease_until=null where status in ('queued','running','retry_wait');
