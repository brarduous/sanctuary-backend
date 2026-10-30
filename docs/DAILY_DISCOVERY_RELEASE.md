# Daily Discovery: editorial and release runbook

Implemented October 28, 2026. The feature is disabled by default. Hosted preview migrations and rollback have been rehearsed; production publication remains gated by the recovery requirements and content runway. See [the rollout record](DAILY_DISCOVERY_ROLLOUT_2026_10_28.md).

Policy update: at the user’s request, straightforward Bible-text trivia can now auto-approve and schedule after the 95-point evidence gate. See [curriculum, auto-approval, calibration, and difficulty methodology](DAILY_DISCOVERY_CURRICULUM.md). The manual workflow below remains available and is required for historical, tradition-specific, or disputed claims outside that automation.

## Accuracy standard

“100% defensible” is an editorial acceptance standard, not a certainty score assigned by software. A valid JSON document, an exact quotation, a familiar church teaching, or an AI response does not establish a fact. Reject a candidate when its wording cannot be defended in context.

The active bank contains **4 unpublished contextual biblical-text candidates**: one assistant-written question reviewed by both live models and three questions written and assessed by the actual generation pipeline. The retired 36-item starter bank and experimental drafts are not import targets. Active questions use the app’s World English Bible (classic) translation and include exact saved excerpts and SHA-256 checksums. No generated historical claim is published with this release. Historical content requires primary evidence and independent scholarly support for every claim; tradition-specific content requires a named tradition and an official source for every claim.

The [editorial review packet](DAILY_DISCOVERY_REVIEW.html) displays every question, correct answer, explanation, excerpt, and source link. Those initial candidate files remain `pending`; no bulk approval is implied. Approval records distinguish authenticated human reviews from audited `automated_evidence` decisions. Both bind to an immutable revision.

For each manual approval, read the whole passage/document and affirm:

1. `sourcesReadInContext`: the cited evidence and relevant surrounding context were read.
2. `everyClaimSupported`: the answer, heading, and every explanatory assertion are supported; inference is qualified.
3. `oneUnambiguousAnswer`: exactly one option answers the actual wording, including alternate translations or historical uncertainty.
4. `scopeAndUncertaintyAccurate`: textual statements, independent historical conclusions, parables, and later traditions are distinguished.
5. `rightsChecked`: quotation and attribution rights are established.

Record a specific manual-review rationale of at least 40 characters. There is no “approve all candidates” command. Importing an edit creates a new revision and does not inherit approval. The automated curriculum must independently pass the complete evidence policy for each new question. A prior reviewed revision can remain live until explicitly corrected or withdrawn. Withdraw immediately when an existing claim becomes doubtful.

The evidence checks verify excerpt integrity and answer containment, **not semantic correctness**. The official [World English Bible legal page](https://ebible.org/eng-web/copyright.htm) establishes public-domain use; [the edition page](https://ebible.org/eng-web/) identifies the classic translation used for the saved excerpts. The applicable automated or manual contextual review must also catch phrasing differences and unsupported implications.

## Local checks

In `sanctuary-backend`:

```sh
npm run validate:discoveries
npm run review:discoveries
npm run test:discoveries
npm run typecheck
npm test
```

The discovery integration tests run the real additive migration, SQL functions, API routes, RLS grants, and rollback against isolated in-memory PostgreSQL via PGlite. They do not load production Supabase configuration. Test approvals are explicitly synthetic and never exported into bundled content.

In `sanctuary-mobile`:

```sh
npm run typecheck
npm run test:discoveries
npm run check:behavior
```

In `sanctuary-layperson-web`, run `npm run typecheck`, lint the new discovery files, and run `npm run build` with the intended environment configuration. `src/lib/discoveryCore.ts` is the public contract mirrored from `sanctuary-mobile/lib/discoveryCore.ts`; update both copies together and verify they remain identical.

### Isolated browser demonstration

Run `node scripts/discoveries/previewLocal.js` from the backend to start a **test-only** API at `http://127.0.0.1:4013`. It uses disposable in-memory data and synthetic approvals, binds only to loopback, and refuses `NODE_ENV=production`.

Start the layperson web development server with:

```sh
BACKEND_API_URL=http://127.0.0.1:4013 \
NEXT_PUBLIC_BACKEND_URL=http://localhost:4013 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4013 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=local-preview-placeholder \
npm run dev -- --port 3010
```

Visit `http://localhost:3010/discoveries/1f28f594-18f0-55af-860b-45169f41436e`. These placeholders only allow the existing web auth provider to initialize for a guest preview; the loopback API is not a Supabase authentication service. Do not use test values or the preview server for production builds/deployments.

## Staging and content publication

1. Follow the repository’s [database rollout process](PRODUCTION_DATABASE_ROLLOUT.md). Rehearse migration `20261028120000_daily_discoveries.sql` and rollback `supabase/rollbacks/20261028120000.sql` in an isolated environment. All new tables have forced RLS and no direct `anon`/`authenticated` grants. The five content migrations leave existing table policies unchanged. The separate reminder migration adds a capability column and expands existing notification category constraints and preference auditing; review that migration separately against the hosted schema.
2. Deploy the backend routes while `discovery_runtime_settings.enabled=false`. An older database without the discovery settings table returns a disabled bundle. Other database failures are reported as failures.
3. Set `DISCOVERY_ADMIN_URL` to the intended backend origin and `DISCOVERY_ADMIN_TOKEN` to the signed-in global administrator’s access token, using the normal secure local environment mechanism. Do not commit or paste the token into content or review packets.
4. Run `node scripts/discoveries/importCandidates.js` for a dry run. Add `--apply` to import validated, unpublished revisions. Repeating the import skips unchanged latest revisions. No command automatically approves or schedules them.
5. Use authenticated `GET /admin/discoveries` for revisions, reviews, reports, schedule, contiguous content-runway warning, and runtime settings. Use `GET /admin/discoveries/:id/revisions/:revision` for the exact preview and evidence package. The JSON preview is the initial editorial surface; a richer Studio editor remains optional.
6. After reading the sources, submit `POST /admin/discoveries/:id/approve` with `{revision, note, attestations}`. `attestations` must explicitly contain all five boolean criteria above. The service records the verified administrator and review time.
7. Submit `POST /admin/discoveries/:id/schedule` with `{revision, date:"YYYY-MM-DD"}`. The database foreign key requires approval for that exact revision. Dates cannot conflict, withdrawn items cannot be scheduled, and past dates cannot be reassigned through this endpoint.
8. Prepare at least 30 scheduled days and a sustainable 14-day runway before a public pilot. Expand the reviewed library toward the plan’s 60-item target after the factual-review process is proven; four draft items are not a completed launch library.
9. After a discovery is actually released, use `DISCOVERY_PUBLIC_URL=<backend-origin> node scripts/discoveries/exportFallback.js <released-id>` to validate a bundled offline fallback. Add `--apply` only after reviewing the returned public item. Never export synthetic local-preview content into a release build. The checked-in fallback is deliberately empty until an actual human-reviewed release exists.
10. Deploy mobile and web changes. Android needs a native build for the new verified intent-filter path. Confirm AASA and `assetlinks.json` at both domain hosts, the existing Apple team/app ID, and the Play signing certificate. Repository configuration alone does not establish that live link verification succeeds.
11. Enable only the internal audience through `POST /admin/discoveries/settings` with `{enabled:true,rolloutPercentage:0,internalUserIds:[...]}`. Then progress through 10%, 50%, and 100% after observing the relevant release gates. `enabled:false` hides the Home card while retaining published public links. Public content already downloaded may remain visible offline until the next successful refresh.

The pilot is a product/release decision; it has not been started by this implementation. The approval APIs require global admin status, not congregation membership or ordinary clergy access. Never expose the service-role credential to a client.

## Corrections and reports

- Public readers can submit a source/factual issue without signing in. Reports are rate-limited and stored in `discovery_issue_reports`; the admin inventory exposes them for editorial follow-up. Do not include personal information in a report.
- `POST /admin/discoveries/:id/withdraw` with `{notice}` immediately removes online public access and adds a bundle tombstone. The withdrawing administrator and time are recorded. Offline copies cannot be recalled until reconnect.
- Import corrected content under the same ID and slug, review the new revision, then use `POST /admin/discoveries/:id/restore` with `{revision,notice}`. Restoration requires a newer, approved revision and a public correction notice. The notice is displayed beside the explanation.
- For a correction that does not require temporary withdrawal, approve the new revision and update its current/future schedule explicitly. Previous released revisions are archived when replaced, so delayed offline completions and reports still reference real evidence history. Editing a pending future schedule does not publish the canceled item.
- Re-export any bundled fallback affected by a withdrawal/correction before the next native release. Clear queued social assets if social publishing is introduced later.

## Release verification and current limits

Verified locally: guest browser question and direct-reveal paths, evidence disclosure, narrow layout, public social image rendering, and browser report submission reaching the isolated database. Automated tests cover privacy/access, draft/future filtering, exact-revision review, correction/withdrawal/restoration history, idempotent completion, account deletion, SQL rollback, offline durability, concurrent taps/sync, guest merge, account isolation, timezone/DST, and permission-free token refresh/cold notification routing.

Verification results on October 28: 178 backend tests, 14 mobile Discovery tests, existing mobile behavior checks, both web builds, web/mobile type checks, and targeted web lint passed. Hosted preview migration, reverse rollback, reapply, and forced-RLS/client-grant checks passed. Hosted checks do not establish native physical-device acceptance or a production content runway.

Native physical-device acceptance remains required: VoiceOver/TalkBack, large text, airplane-mode/restart/reconnect, native sharing, installed/uninstalled app links, and terminated-app notification routing. The existing Expo web preview currently fails in the pre-existing devotional screen’s `react-native-share` import (`getEnforcing`), so it cannot substitute for native acceptance. It was not changed as part of this feature.

Dedicated Discovery reminders are implemented as an explicitly opted-in notification category, disabled by the migration until rollout. A Studio editor, adaptive repetition, historical/tradition libraries, social publishing, and attribution SDKs remain optional future work. Token refresh never requests system permission on app mount.

Offline completions are persisted before reveal and scoped to the account. An explicit guest merge is available; guest history is not silently uploaded. Sign-out attempts a sync and gives an unsynced-progress notice before removing that account’s local history. Corrupt progress is preserved for recovery rather than overwritten. Public bundle refresh uses ETags, revalidates after 15 minutes/foreground/manual refresh, retries failed work while active, and selects today using the device calendar.

Production schema and private generation are installed; current publication gates are recorded in the rollout record. Passing checks does not establish a sufficient content library or factual certainty.

## Context/craft policy revision

After the curriculum and game-result migrations, apply `20261028220000_discovery_question_craft.sql` in the same reviewed rollout as evidence policy v3. This adds no public tables; it replaces the automation gate to require independent writing-quality and contextual-premise checks as well as the existing factual threshold. Its executable rollback is `supabase/rollbacks/20261028220000.sql`; roll the application policy back together. Existing stored v1 week plans require explicit source-plan review for curriculum v2. Preview migrations and rollback have been verified. Production status is recorded separately in the rollout record.

## Daily trivia reminders

The existing Vercel `/api/push/dispatch` scheduler runs every 15 minutes; do not add a second dispatch scheduler. It calls the backend calendar, which now includes `discovery`. Generation is a separate Render cron at 08:15 UTC (`npm run cron-discoveries`). Keep generation disabled until its database migrations are installed.

Apply `20261028230000_discovery_reminders.sql` after the four content migrations. It creates a disabled `discovery` setting at 18:00 recipient-local time. Users opt in with `user_preferences.notifications.trivia === true`; missing or string values never count as consent. New onboarding and profile controls default trivia off. No existing-user backfill is performed.

A reminder requires a scheduled, nonwithdrawn question for that user's local date, inclusion in both content and notification rollouts, no synced completion of that question, no accepted notification within six hours, and a supported delivery channel. Native support is registered by the authenticated updated app and bound to the exact Expo token; older native clients are skipped, with web subscription fallback when available. Capability registration does not request permission. User/profile tokens are not logged. Unsynced offline results cannot be known to the server until reconnect.

The database permits only one Discovery delivery per user/local day, including across content corrections and overlapping invocations. Failed deliveries are not resent that day. Push copy is generic, short, and does not reveal the prompt or answer. Quiet hours are 21:00–08:00. Existing category spacing remains in effect.

Before enabling, call `POST /api/notifications/dispatch` with `{category:"discovery",dryRun:true}` using the configured cron secret, inspect skip reasons, then enable an internal cohort through the existing admin notification settings API. Review delivery failures, opt-outs, unsupported-client counts and content availability before increasing the stage. Discovery stages require an explicit operator change; the existing automatic devotional/advice promotion does not promote trivia. Rollback disables the category and retains delivery/audit history.
