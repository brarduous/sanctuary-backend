# Production database rollout safety

The checked-in P0 migration is additive only: it creates new authorization, audit, guardian, medical, kiosk-session, and pickup-credential objects. It does not change RLS, policies, columns, ownership, or records on existing production tables.

Production execution is intentionally manual and blocked until all of the following occur:

1. Export the hosted schema without data and compare it with the migration in an isolated staging project.
2. Restore a sanitized production-shaped snapshot into staging and record migration lock time and query plans.
3. Run old clergy and layperson clients against staging before and after migration.
4. Run same-tenant and cross-tenant tests, then separately review proposed policies for each legacy table.
5. Confirm a point-in-time recovery bookmark and rehearse rollback in staging.
6. Obtain explicit engineering and product approval for a maintenance window.

Legacy-table RLS changes, soft-delete columns, backfills, and replacement of `leader_user_id` are deliberately excluded from the additive migration. They require separate expand/backfill/verify/contract changes and must never be bundled into an automatic application deploy.

Backend authorization temporarily accepts the existing `congregations.leader_user_id` when the capability RPC is unavailable or returns no grant. This preserves current lead-pastor access during expand/backfill. Remove it only after every active congregation has a verified lead-pastor membership and old-client staging tests pass.

`supabase/templates/local_legacy_baseline.sql` is a disposable-test template, not a production migration. Local setup must load a verified schema snapshot before running the additive migration. The earlier reconstructed core schema was removed from `supabase/migrations` because production already owns those tables and their UUID relationships must never be guessed or recreated.
