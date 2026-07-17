# Production migration safety

No P0 development command targets hosted Supabase. Local resets use the local Docker database only.

## Non-disruptive rollout

1. Restore a production backup into an isolated rehearsal environment.
2. Apply the additive migrations there. They use `create table if not exists`, nullable added columns, and preserve `leader_user_id`.
3. Confirm every existing leader was backfilled into `organization_memberships`, then run current-client access-parity tests.
4. Deploy compatibility-aware backend authorization. A missing capability RPC falls back only to the existing congregation leader rule.
5. Observe authorization results before enforcement. This migration does not enable or change RLS on legacy production tables.
6. Create a separate enforcement migration only after same-tenant, cross-tenant, and current-user parity tests pass. Production application requires explicit approval, a recent backup, and a tested rollback.

Never run `supabase db reset`, seed fixtures, destructive journeys, or local test credentials against a linked hosted project.

## Preflight and rollback commands

`npm run db:production:preflight` is read-only. It requires an already-linked production project, a clean reviewed commit, named approver and change ticket, and restore evidence for a backup verified in the prior 24 hours. It never links a project and only performs tests, migration inventory, and `db push --dry-run`.

Every post-baseline migration has a versioned rollback in `supabase/rollbacks`. Run one only in an approved rollback window with `npm run db:production:rollback -- <version>`. The command requires the same backup/review evidence plus an exact version confirmation. RLS rollbacks deliberately reopen the prior access model and therefore require immediate application rollback and read-only tenant verification. Prefer roll-forward repair whenever authorization integrity can be preserved.
