# Younger-audience content rollout — October 30, 2026

The production backend and all four content jobs are deployed with the younger-audience copy policy. All **31 shared devotionals from October 30 through November 29** were regenerated and read back successfully. Today's one existing personalized devotional and its prayer were also refreshed in place. No notifications were sent by the refresh.

## Content verification

The successful refresh used the existing five dated, validated curriculum plans. It preserved the weekly formation goals, Scripture selections and complete quotations, historical day briefs, scheduled dates, and devotional IDs. Copy was regenerated with at most three simultaneous day requests; regular daily generation keeps its sequential default. Earlier preparation attempts did not publish content.

All 31 original shared devotional rows were verified in the database revision archive. Readback confirmed all replacements, policy tags, plan metadata, unchanged IDs and Scripture, and anonymous access to today's updated reflection. Bodies range from 115–162 words; every share slide is at most 22 words. These are measured copy lengths, not a measured audience-appeal score.

Today's reflection remains **“Listen Longer Than You Plan” — James 1:19**, with a 138-word body and share slides of 7, 18 and 16 words. Its practical response is two minutes of uninterrupted listening followed by a one-minute summary before responding.

The personalized devotional and prayer retained their IDs and original creation dates. Original/private and prepared rows were saved outside the repositories with restrictive file permissions. Only count-based completion evidence is committed; no profile notes, user identifiers, private devotional content, or credentials are included here.

Evidence: [shared content and archive readback](qa/2026-10-30-audience/content-verification.json), [personalized completion counts](qa/2026-10-30-audience/personalized-refresh-summary.json).

## Deployment and ongoing generation

Runtime code is on `release/daily-discoveries`. The backend, devotional job, article-news job and daily-news job track this reviewed branch; the trivia job already tracked it. The original audience release was `00f7ffd`; subsequent refresh-tooling and planner fixes are included through `80a64f9`. Each service's exact live commit and deployment ID is in the [deployment evidence](qa/2026-10-30-audience/deployments.json). Trivia's unchanged writer-v5/reviewer policy is live from `00f7ffd`.

The daily devotional job continues at 08:00 UTC with its existing 28-day runway target. The refreshed schedule extends through November 29. New generation uses the updated voice, practice and slide requirements. The planner explicitly requests practice verbs accepted by its validator; a live model call for the next curriculum theme produced a validated seven-day plan without database writes. See the [live planner check](qa/2026-10-30-audience/future-planner-check.json).

The API health endpoint returned 200. Public trivia remains disabled with an empty public bundle; this deployment did not change its launch or notification settings. New news and advice requests use the updated prompts. Historical news and private advice records were not bulk rewritten.

## Database compatibility

Migration `20261030120000` is applied and recorded in production. The acceptance function supports craft v1/v2 during rolling deployment and records the actual craft version in approval attestations. Authenticated clients still cannot execute the worker-only function.

The hosted proof branch passed apply/rollback/reapply with unchanged editorial row counts and no expanded authenticated execution permission. Production preflight passed with a fresh seven-day PITR recovery check, existing restore evidence, a clean release commit and a dry run showing only this migration. A guarded rollback remains in `supabase/rollbacks/20261030120000.sql`.

Evidence: [hosted rehearsal](qa/2026-10-30-audience/migration-rehearsal.json), [recovery/preflight](qa/2026-10-30-audience/recovery-preflight.json). Backend tests passed all 191 cases after the bounded-refresh change; the final planner-wording and preserve-plan changes passed the 13 relevant generation/refresh tests and syntax checks. Prior mobile validation passed 17 tests and TypeScript.

## Native sharing release

Mobile commit `58913bf` produced signed **iOS 66** and **Android 138**, version 1.2.11. Both binaries contain the new quick-takeaway, news-summary and labeled-reflection sharing copy and production API/database configuration; the inspected bundles contain neither the staging database nor the local QA API.

- iOS 66 uploaded successfully to App Store Connect/TestFlight: [submission](https://expo.dev/accounts/donarduous/projects/sanctuary/submissions/23d1ca15-5693-47fe-a7cd-61814106263f).
- Android 138 uploaded successfully to Google Play's internal track: [submission](https://expo.dev/accounts/donarduous/projects/sanctuary/submissions/f31ac8e2-f82e-4ea6-b104-e2d514cce6a0). Google rejected `changesNotSentForReview`; EAS retried using Google's normal review process. Managed publishing was subsequently verified **on**. The existing production 135 release remains ready to publish and was not published by this task.

Public native release holds remain in place. Backend content improvements are live for installed clients; the new native sharing controls require distribution of these builds. No store-publication button was pressed.

Evidence: [iOS bundle inspection](qa/2026-10-30-audience/ios-66-artifact-audit.json), [Android bundle inspection](qa/2026-10-30-audience/android-138-artifact-audit.json), [submission summary](qa/2026-10-30-audience/native-submissions.json).
