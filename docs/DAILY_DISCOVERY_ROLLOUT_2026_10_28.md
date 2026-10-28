# Daily Discovery rollout record — October 28, 2026

Status: backend code deployed; website/native packages staged; production database publication has not occurred.

## Recovery and hosted rehearsal

- Production project: `cmakuvkjxknwhonfqbit` (Sanctuary). Supabase reports physical backup `2095144859` completed at `2026-10-28T07:59:02.741Z`. **PITR is disabled.** A completed backup listing is not proof of a tested restore or a point-in-time recovery bookmark. The repository's required recovery rehearsal/approval remains open; no exception is assumed.
- New isolated preview branch: `discovery-release-20261028`, project `nwrozzdrlwlzjpfhgtlk`, created without production data. Existing staging/snapshot branches were preserved.
- Read-only hosted schema inventory confirmed the notification table/constraint names and existing profile columns. All five Discovery migrations applied to the cloned hosted schema, then all five rollbacks ran in reverse order, followed by a successful reapply. Commands set a 3-second lock timeout and a 60-second statement timeout. Recorded elapsed times below include network overhead; they are not measured lock duration.
- All 13 Discovery tables enforce and force RLS; `anon` and `authenticated` lack direct SELECT grants. Existing profile policies were not broadened.
- These schema-only hosted checks supplement isolated PostgreSQL integration tests. They do not replace production-shaped load tests, old-client acceptance, a sanitized snapshot restore, or physical-device acceptance.

| Migration | SHA-256 | Apply round trip (ms) | Rollback round trip (ms) |
| --- | --- | ---: | ---: |
| `20261028120000_daily_discoveries.sql` | `3626a8b1a9ae06f4c896d0d947baa2c0a40f4697f833a0738a93b1f6f35723bc` | 1692 | 1593 |
| `20261028153000_discovery_curriculum.sql` | `2f5a30e66c94d29fb8d9bd7fd94964803504c12827500fcf2ecf547e3795eede` | 1638 | 1456 |
| `20261028200000_discovery_game_results.sql` | `088b58930dda7ab85bdf2d07ebd2b7e716ff6de402e1e261de2579e1173fc2a5` | 1583 | 1500 |
| `20261028220000_discovery_question_craft.sql` | `b68290af57201227367d47e12fa701eac0f12da8070ccecb551b1f17f42eb133` | 1444 | 2610 |
| `20261028230000_discovery_reminders.sql` | `308bf81c42aa70279f3837e116c67904ddacba3b504feade5f4542ae1376fdf3` | 1604 | 1930 |

## Live generation rehearsal

The actual cron engine, trusted corpus, writer and two independent reviewers ran against the hosted preview. Run `30abe594-221f-4fcb-b496-8f0b2d58310b` considered two dates: one auto-approved/scheduled at an evidence score of 95 after three attempts; the other exhausted three attempts and remained unscheduled. Five drafts were rejected. Provider-reported usage was 93,899 tokens. Scores are rubric judgments, not calibrated probabilities.

The preview has **one contiguous scheduled day**, not a launch library. The active file bank contains four unpublished questions and is not silently merged into the cron's approved schedule. The exhausted date has not been reset. Before public launch, fill and inspect a 30-day schedule and sustain at least a 14-day contiguous runway. Never lower thresholds or silently reset retry budgets to meet the date target.

The rehearsal also identified an audit gap. The release now retains rejected valid candidates in private attempt verification and includes them as untrusted retry context; invalid writer output also consumes the token budget and retains provenance. These records never enter public projections.

## Application packages

- Native release branch: `release/daily-discoveries-1.2.11`, commit `d58e87a`. Version 1.2.11 includes the Android generic `/discoveries` verified-link path, so a new native build is required. Android build `2b135c3e-8bce-485d-8fa6-9577b96442ba` uses version code 134.
- iOS packaging exposed a certificate/profile that expired today. After the user's Apple verification, a new distribution certificate and provisioning profile were created for `us.sanctuaryapp.app`, team `QKQ2WNHKWS`, expiring October 28, 2027. The push key and App Store API key were preserved. iOS build `4ac1ed3f-4a3d-4ce9-aa3c-12361c5a1082` is version 1.2.11, build 63. No store release has been submitted by this rollout.
- Staged production-environment web deployment: `https://sanctuary-layperson-webapp-oyws6mihu.vercel.app`. Separate marketing deployment: `https://sanctuary-app-home-qtr8-dabw4sxjc.vercel.app`. Both were built using `--prod --skip-domain`; the canonical domain must be promoted only after data/content readiness. `sanctuaryapp.us` belongs to the layperson web project, which also includes the Discoveries landing link and branded trivia shell.

## Validation and outstanding launch gates

Backend test suite and targeted Discovery tests pass; mobile has 14 passing Discovery tests plus the existing behavior checks. Both web production builds, type checks, and scoped lint pass. Compatible dependency updates and OpenAI SDK 7.45.1 remove all npm audit findings from production backend dependencies; a live strict-JSON Responses call passed on the updated SDK.

Production remains gated on the recovery process above, sufficient independently approved scheduled content, representative old-client and physical-device checks, successful signed native builds, and production smoke tests before promotion/enabling. Generation and reminder settings must remain disabled until their schema is installed. See [release runbook](DAILY_DISCOVERY_RELEASE.md) for per-stage switches and rollback.

## Deployed infrastructure and smoke checks

Backend production deployment `dep-dbh7s9mtlv9c73eqrlj0` is live at commit `71f41546d9fa0b9bcc8af14734838daf06b99ff0`. `GET /health` returned 200. `GET /api/v1/discoveries/bundle` returned 200 with `enabled:false` and no items against the existing production schema. Unauthenticated requests to generation, capability registration and notification dispatch all returned 401.

Render cron `crn-dbh7s9ek1f9s73aur280` (`sanctuary-daily-discovery-curriculum`) is provisioned on release/daily-discoveries at 08:15 UTC, with `DISCOVERY_CURRICULUM_ENABLED=false` and auto-deploy off. Its one-off disabled smoke run `job-dbh7smutlv9c73eqsqv0` succeeded without querying the missing production Discovery schema. After the DB/content gates pass, enable the environment flag and explicitly deploy the reviewed release. No separate reminder scheduler was created.

The staged web trivia shell returned successfully and the staged `/api/push/dispatch` returned 401 without the cron secret. Marketing's deployed Scripture endpoint returned the bounded WEB passage. The canonical web project still targets original deployment `dpl_GK3wmKbohymfivp41ES7K9pcTTEU`; `sanctuaryapp.us`, `www` and `beta` were not promoted.

A local browser connected to the hosted-stage database completed the real generated question, displaying a 3.1-second correct answer, one-day streak and the exact Genesis 3:1–12 passage in the reader's WEB preference. Screenshot: [hosted staging result](../../sanctuary-layperson-web/docs/qa/2026-10-28/hosted-stage-result.jpg). This progress is guest data in the local test browser and did not create a production completion.

Final backend verification: 176 tests passed, including 57 targeted Discovery tests and a 1,103-profile reminder audience to exercise pagination. The backend syntax checks and production dependency audit passed (zero production advisories).

## Recovery approval and retry correction

The user explicitly approved seven-day PITR and required Small compute during rollout. PITR was enabled on the production project through its existing Supabase account. The Management API confirms `pitr_enabled:true` with a recovery window from 2026-10-21T23:10:34Z through 2026-10-28T23:10:34Z at verification; capture a fresh latest bookmark immediately before migration. Small compute adds approximately $5.15/month over the current Micro size; the approved change is being processed.

The next hosted generation run exposed a candidate validation exception with HTTP status 400 being classified as a provider configuration failure. The release now classifies `candidate_contract_invalid` before provider HTTP statuses, records its rejected draft and token usage, and feeds the contract issue into the bounded retry path. Actual authentication/configuration failures still stop the run. All 176 tests pass after the fix.

Signed Android build 134 completed and was uploaded successfully to Google Play's internal testing track (submission b00d811c-087d-4e90-8483-8fc073e13add). Signed iOS build 63 was uploaded successfully to App Store Connect (submission be600d49-0c7c-4a92-b650-ffcdbe912725). Neither platform was publicly released by these uploads.

The final clean-commit staged website URLs are https://sanctuary-layperson-webapp-8zbezsxul.vercel.app and https://sanctuary-app-home-qtr8-brj1sloxz.vercel.app. The final web page returned 200, its cron rejected missing authentication with 401, and marketing's Scripture endpoint returned the exact WEB test passage. Backend GitHub CI passed both application and complete migration/reset/lint jobs on Node 22 at 3105a407683b839e33c4f0cc7c6eec3c16ed25d7.

## Final guarded migration rehearsal

Small compute and seven-day PITR are now confirmed in the production dashboard. A second schema-only proof branch (`gjwvtqdfqprzcpgqrfhr`) restored 39 editorial devotional rows and four disabled notification settings from a scoped, sanitized production snapshot. No production accounts, push tokens, subscriptions or personal preferences were copied. Synthetic fixtures matched current production volumes: 46 profiles, 108 campaigns and 319 deliveries.

The final migration and rollback files include transaction-scoped 3-second lock and 60-second statement timeouts. Apply, reverse rollback and reapply passed on the hosted proof database. Representative legacy profile/devotional query results and campaign/delivery counts retained the same SHA-256 throughout: `cd9826c60ff0b4ca16ff902dd5a7f59371f743eac680e1eaf0c509f4b63f8160`. This is a scoped production-shaped rehearsal, not a claim that the entire production database was physically restored.

| Final migration | SHA-256 | Server elapsed ms |
| --- | --- | ---: |
| `20261028120000_daily_discoveries.sql` | `adf8faa127f3c14f172fae79f96a5f1475b9565d6d2438dbca1ce210e803ddc1` | 131.560 |
| `20261028153000_discovery_curriculum.sql` | `e1d4774da0b2de205503426fed429d2a9a297d2227a6f3247aac9449117286c5` | 70.578 |
| `20261028200000_discovery_game_results.sql` | `2891f118305a57ef64cc60c316718c639c1340b3e08cde042c3b71ad24e3f0d0` | 7.392 |
| `20261028220000_discovery_question_craft.sql` | `3f05918817c19a6d0be6dcf2538402efc54d735936c206481fcc749d86132d14` | 6.234 |
| `20261028230000_discovery_reminders.sql` | `777dd95e26867c9d6898ecd3996d24f70cf3576403d9da099f29c5598900f3b5` | 8.613 |

The production migration ledger matches the repository through September 28. Only the five Discovery migrations are pending. Backend CI passed full database reset/lint and the application suite before this timeout-only hardening; the final local suite also passed 176 tests.
