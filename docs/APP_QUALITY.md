# Application quality and reader evidence

## Production jobs and reports

`npm run cron-app-quality` runs hourly at minute 15 (UTC). It reads the actual anonymous public APIs and checks devotional continuity, seven-day trivia availability, news freshness, notification-provider outcomes, server timings, partial token totals, reader responses and dated privacy release evidence. Failures and warnings remain visible. A nonzero process exit marks `needs_attention`; reports remain stored for diagnosis. This job never sends notifications or publishes content.

`npm run cron-content-quality` runs Mondays at 06:30 UTC, after the devotional improvement job at 06:00 UTC. Its lookback is fourteen days to obtain at most three recent samples per content type, rather than pretending every type has a daily supply. The devotional improvement job reviews the previous Monday–Sunday UTC week. Local wall-clock times change with daylight saving.

The broader content audit uses `gpt-6-astra` for prayers, guidance, sermons, studies, news, briefs and trivia. It grades helpfulness, accuracy, audience fit and freshness against type-specific rubrics and available evidence. A maximum of seven 6,000-completion-token calls bounds each run. Source identifiers and hashes permit review of the exact sampled version. Private evidence stays in service-only reports; this audit does not change prompts, models, source records, editorial publication decisions or another reader's experience. The existing separately guarded devotional improvement loop remains responsible for tested prompt/model promotion.

Administrators can read `/admin/quality` and the web `/quality` page. The API uses authenticated server-side role checks. Operational, editorial and release evidence are separate. Unknowns have no score, there is no overall average, and a good content score never offsets a failed privacy or availability check.

## Reader feedback

The web devotional detail page optionally asks whether the reading helped, whether its practice feels feasible, and which predefined issues apply. Responses can be changed or removed. There is no free-text field. The API verifies ownership of private completed content or availability of released public content. It derives identity from the session, limits requests, and disables caching. Raw feedback has no anonymous or authenticated database access; service-only API access enforces ownership.

Reports distinguish response count from unique readers, mark fewer than five respondents as insufficient sample, and disclose optional-response bias. Perceived feasibility does not prove the reader performed a practice or experienced spiritual growth. Mobile feedback UI is not part of this web release.

## Privacy boundaries and verification

The release includes authenticated route ownership, congregation membership checks and direct database RLS boundaries for private devotional, prayer, guidance, feedback, activity, sermon, series and profile tables. Restrictive policies prevent legacy permissive policies from granting foreign inserts or owner reassignment. Existing study-parent sharing determines lesson visibility; only the parent author may modify lessons. Raw diagnostic logs and prompt evaluations are service-only. Profile display/preferences remain editable while roles, subscription entitlements, billing identifiers and usage controls are server-managed. Existing paid profiles retain entitlements during legitimate client upserts.

`QA_CONFIRM_PRODUCTION=account-isolation node scripts/verifyAccountIsolationProduction.js` creates two disposable confirmed-email accounts, reads only their synthetic private records, verifies both direct database and public HTTP boundaries, then removes its fixtures. It does not send email, publish content or invoke payment. A dated release report records checks and cleanup, not credentials. Two-church membership combinations additionally use isolated HTTP integration tests. This is scoped verification, not a security certification.

Migrations 1800 and 1900 are repeatable. Apply through the normal production migration process before enabling the routes/jobs. Rollback 1800 requires disabling feedback and quality jobs and exporting history first. Rollback 1900 deliberately fails closed: it removes new permissive owner access but retains RLS, restrictive ownership boundaries, profile guards and diagnostic restrictions. It must not restore known private-data exposure.

## Limits and remaining release work

Real-device VoiceOver/TalkBack, large text, offline/recovery journeys, crash-free sessions and sandbox subscription purchase/restore/cancellation/cross-device entitlement checks require observed device evidence. They are explicitly unmeasured here. Provider acceptance is not proof of notification delivery. Mixed server-operation timings are not screen load latency or user error rates. Token telemetry is incomplete, so no dollar cost is invented.

An initial measurement found a short trivia publication runway with exhausted generation attempts, and source-attribution concerns in a small news sample. These remain warnings for review; this monitor neither lowers content validation thresholds nor certifies incomplete reporting as false. Investigate the dated report and source hash before changing editorial decisions. Actual reader outcomes and before/after cohorts require sustained consented usage data; model grades alone cannot establish improvement.
