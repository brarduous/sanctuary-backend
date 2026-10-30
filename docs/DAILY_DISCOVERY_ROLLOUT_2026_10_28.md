# Daily Discovery rollout record — October 28–29, 2026

Status at 2026-10-29 22:18 UTC: production infrastructure and private generation are installed, with **30 consecutive approved questions through November 27** and no exhausted dates. Public Discovery and reminders remain disabled. The user chose simulator QA for now; physical-device acceptance and public release remain pending. This record does not claim a completed public launch.

## Production recovery and database

The owner explicitly approved seven-day PITR and the required Small compute upgrade. Both are enabled on production project `cmakuvkjxknwhonfqbit`. The dashboard confirms a seven-day recovery period. PITR adds $100/month; the dashboard estimated Small's incremental compute cost at approximately $5.15/month over Micro.

![Production seven-day recovery](qa/2026-10-29/production-seven-day-pitr.jpg)

All six migrations through `20261028234500_discovery_source_options.sql` were applied using the normal linked migration ledger after the production preflight passed. Each migration and rollback has transaction-scoped 3-second lock and 60-second statement timeouts. All 13 new tables force RLS and deny direct anonymous/authenticated SELECT access. Hosted schema comparison found no unintended legacy policy/column/index changes. The reminder migration intentionally expands notification category constraints and preference auditing.

A schema-only proof branch, `gjwvtqdfqprzcpgqrfhr`, restored 39 editorial devotional rows and four disabled notification settings from a scoped sanitized production snapshot. Synthetic fixtures matched 46 profiles, 108 campaigns and 319 deliveries. No production accounts, tokens, subscriptions, preferences or completions were copied. Six-migration apply, reverse rollback and reapply preserved the legacy query-result hash `cd9826c60ff0b4ca16ff902dd5a7f59371f743eac680e1eaf0c509f4b63f8160`. This is a scoped production-shaped rehearsal, not a full physical restore.

Evidence: [hosted proof](qa/2026-10-29/hosted-migration-proof.json), [pre-migration recovery bookmark](qa/2026-10-29/pre-migration-recovery-bookmark.json), [earlier production dry run](qa/2026-10-29/production-release-status.json), [current 30-day audit](qa/2026-10-29/approved-runway-audit.json). Refresh the recovery bookmark before any subsequent database rollout.

## Backend and generation

Production API: https://api.sanctuaryapp.us. Render service: `srv-d1uqipvdiees73b0kj20`. Backend deployment `dep-dbhrljutlv9c73cglc1g` and cron deployment `dep-dbhrlk3bc2fs73a4u830` are live at `bc56c77fcf78900d68e510cdbc64d7e3ae9fb64d`, including writer v4, source repair guards and the stronger first verifier. Subsequent evidence-only commits do not change runtime behavior. Health returns 200. The public bundle returns 200 with `enabled:false` and zero items. Unauthenticated generation, capability registration and dispatch return 401.

The active Render cron is `crn-dbh7s9ek1f9s73aur280`, `sanctuary-daily-discovery-curriculum`, at **08:15 UTC daily**. It runs `npm run cron-discoveries` on Node 22, with generation enabled, auto-approval enabled, a 30-day target, seven considered dates per run, and 150,000-token budget checked between attempts. An in-flight request can exceed that boundary. Three persisted attempts per date prevent endless retry; exhaustion produces a failed job and requires explicit reviewed repair. Auto-deploy is off; explicitly deploy the reviewed branch after changes.

Production uses writer `gpt-5.6-sol` under `sanctuary-trivia-writer-v4`, with verifiers `gpt-6.1-sol` and `gpt-6-astra`. The first verifier upgrade was checked against provider inventory, official documentation, three positive drafts and six negative controls; all six controls were rejected. Two positive drafts passed; the third still failed craft. Earlier accepted questions retain their original mini/Astra reviews. Every question premise, claim and option verdict must score at least 95; both blind reviewers must independently agree on the key, exact source evidence and scope. Craft must reach 6/8 with no zero dimension. Difficulty is assessed independently of the assigned target. These scores are not a calibrated 95% probability of truth.

The first production run `a8ddbf0c-abd7-4af8-a604-29dbc41102ab` accepted two candidates, rejected ten, exhausted three dates and correctly failed its job. The source-v3 planner subsequently precommitted three narrative source options per date; SQL binds each attempt to its source hash. Two bounded fill jobs, `job-dbh8kr0n74is73cl7iq0` and `job-dbh8kr67bikc73dt60ag`, completed unsuccessfully due to exhausted dates. No failed candidate was converted to an approval.

The explicit v2→v3 source-plan repair archived the old plans, preserved approved questions, reset four named dates under the owner's administrator workflow, and held the awkward future James mirror question before publication. Old attempts, reviews and immutable revisions remain. No human factual attestations were fabricated. Exhausted v3 dates have not been silently reset.

The source-repair CLI defaults to preview and requires a new manifest, written rationale, owner administrator identity and `--apply`. Its transaction rechecks source-plan equality, slot epoch/attempts, future publication, absent schedule and no active worker. Writer/model revision repairs additionally prove the three prior failures came from the named older policy/model pair. Actual source changes precommit three genuinely new passages. All previous plans, attempts and failures remain auditable; a repair never grants factual approval.

The final two bounded fill jobs, `job-dbhs3o0473hc738u7bu0` and `job-dbhs77l9el5s738aiku0`, succeeded. Their source repairs and applied receipts are under `content/discoveries/source-repairs/2026-10-29*`. The [read-only audit](qa/2026-10-29/approved-runway-audit.json) rechecked all 30 exact scheduled revisions against their original independent verdicts and the trusted corpus. Minimum evidence score: 95; minimum craft score: 6/8. Prompts contain at most 19 words and factoids at most 28. Difficulty estimates are 21 Easy and nine Moderate. No question was forced into a target difficulty and no gate was lowered. This establishes the configured content runway, not empirical factual precision.

Writer v4 separates writing from grading instructions, limits generated explanations to one or two short factual claims, and rejects reviewer commentary in publishable copy. The curated source catalogue now contains 54 narrative scenes. Diagnostic drafts and controlled rejections remain under `content/discoveries/experiments`; they are not silently imported or promoted.

## Reminders

The existing Vercel `/api/push/dispatch` cron remains the only reminder scheduler, every 15 minutes. Discovery is disabled in `dry_run`, at 18:00 recipient-local time. Only explicit boolean `notifications.trivia === true` opts a user in. There is no existing-user opt-in backfill. Unsupported native versions are skipped unless web delivery is available. Completion, rollout visibility, quiet hours, six-hour spacing and daily deduplication are enforced.

The authenticated production dry run returned 200 with zero eligible, attempted, accepted or failed sends. The earlier 05:30 UTC check saw all 46 profiles outside the local send window; the latest detailed skip counts are saved in the evidence JSON. There are zero Discovery delivery records. A separate [16-check hosted authenticated journey](qa/2026-10-29/HOSTED_JOURNEY.md) used two disposable staging accounts: completion ownership/outcome, first-event canonicalization, account isolation, denied table reads, capability/timezone registration and reminder selection passed. The dry run skipped the completed user and selected the opted-in unplayed user, with zero sends or delivery writes. Both accounts and their completions were cleaned up. This checks backend behavior, not push delivery acceptance on a real device. Keep the category off until content and device checks pass, then use an opted-in internal account before staged expansion.

## Websites

Both production-environment builds are staged using `--prod --skip-domain`:

- Main/canonical web project: https://sanctuary-layperson-webapp-8zbezsxul.vercel.app
- Separate marketing project: https://sanctuary-app-home-qtr8-brj1sloxz.vercel.app

`sanctuaryapp.us`, `www` and `beta` belong to the layperson project and remain on the prior deployment `dpl_GK3wmKbohymfivp41ES7K9pcTTEU`. The separate marketing project has no custom domain. Staged trivia returns 200, missing cron authentication returns 401, and marketing's Scripture endpoint returns an exact bounded WEB passage. No preview or loopback environment values were placed in production builds.

A browser connected to the hosted staging database completed an actual generated question, showing 3.1 seconds, one correct-day streak and the preferred WEB passage. [QA screenshot](../../sanctuary-layperson-web/docs/qa/2026-10-28/hosted-stage-result.jpg). This guest test did not create a production completion.

## Native store drafts

Version **1.2.11** builds **65 (iOS)** and **137 (Android)** were signed, inspected for production configuration and uploaded successfully from mobile `b2fb713`, including the Dynamic Type reflow fix. A subsequent visual review produced `2e5fb4e`; new production packages are required to include that polish. Use the [native release record](../../sanctuary-mobile/docs/releases/1.2.11.md) for build IDs and selection state.

Google Play build 134 was approved and remains held by managed publishing. Internal EAS uploads also advanced queued production edits into review: release 17 with 135 is in review and held, while 137 is uploaded to internal testing. Mobile's internal submission profile now sets `changesNotSentForReview:true`. Current public Android remains 133/1.2.10. Do not publish 134/135; the final production draft must use a package containing the visual polish. This work has not published a store release.

Apple sign-in was renewed by the owner. Build 65 is selected and saved with manual release, verified after reload. No new App Review request was made. Existing signing keys, age-rating answers and screenshots were preserved. The updated Developer Program License Agreement notice remains for Account Holder review; no agreement was accepted by this work.

## Validation and remaining launch work

Backend application and complete Supabase migration/reset/lint CI both passed on the deployed final runtime commit, including the test-clock repair. Local verification includes 184 passing backend tests, mobile typecheck, 14 Discovery tests and behavior checks, both web builds/typechecks, scoped lint, hosted rollback/reapply and live API smoke checks. Backend production dependencies have zero npm audit advisories. The final reminder fixture freezes both SQL and dispatcher clocks so it remains valid after October 28.

The 30-day content gate is complete. Simulator checks cover light/dark presentation, larger text, native share-sheet cancellation, preferred translation, saved results and warm offline/reconnect. A separate simulator Release app passed cold recovery after the Discovery API and Metro were stopped and the simulator restarted; this was API unavailability, not full airplane mode. Fixes address offscreen onboarding redirects, adaptive actions/stats and immediate Dynamic Type reflow. A fresh [Mobbin/imagegen visual review](../../sanctuary-mobile/docs/design/2026-10-29-launch-review/REVIEW.md) added compact trivia, persistent result actions, clearer Home photo labels, semantic Guidance states and useful empty-feed recovery; its rebuilt simulator Release passed focused checks.

Remaining launch work includes packaging the new visual source, reviewing article freshness/test church content and edition typography, and completing physical-device accessibility/app-link/cold-notification acceptance. The owner explicitly deferred physical checks in favor of simulator work for now; those checks have not been marked passed. Promote tested websites and submit native releases only after the applicable gates; expand content and reminder cohorts through the documented stages. Do not lower evidence/craft thresholds to force a launch date.

Related draft PRs: [backend #17](https://github.com/brarduous/sanctuary-backend/pull/17), [mobile #3](https://github.com/brarduous/sanctuary-mobile/pull/3), [web #3](https://github.com/brarduous/sanctuary-layperson-web/pull/3), [marketing #2](https://github.com/brarduous/sanctuary-marketing-home/pull/2).
