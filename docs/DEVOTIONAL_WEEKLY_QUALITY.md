# Weekly devotional quality review

The November 1, 2026 investigation found one group-chat reference in the October 18–November 1 curriculum, on November 1, and one in the account's saved personalized history. October 29–31 did not contain that phrase. This does not confirm consecutive days of group-chat examples. A broader editorial review did identify repeated breathing/settling openings and messaging, calendar, and meeting practices. It also flagged a featured-passage/body mismatch on October 27 and potentially unsafe simplifications of forgiveness and reconciliation. These findings are recorded as editorial concerns, not claims of independent source verification.

The shared audience guidance previously led with “a tense group chat” as a stock illustration. The writer only received recent titles and verses. Generation now receives recent full reflections from the authenticated reader's server-owned history and from the curriculum; planning and writing both receive variety guidance. The shared audience guidance no longer leads with a digital example.

## Schedule and coverage

`npm run cron-devotional-quality` runs on Render at `0 6 * * 1`: Mondays at 06:00 UTC (1 a.m. Eastern standard time; 2 a.m. Eastern daylight time). It reviews the seven completed Monday–Sunday UTC publication dates. It requires all seven curriculum dates and includes up to 28 personalized reader/day samples. Selection keeps reader histories together, removes duplicate requests, and rotates readers by a weekly hash. Personalized loading is capped at 1,000 rows and reports that cap when reached. The report states sample and population counts; it does not claim full coverage at scale.

`npm run cron-devotional-quality -- --dry-run` performs the same evaluation without claiming the week or changing settings. It still makes paid model calls. The source module also accepts injected database, model client, and clock for testing.

## What changes automatically

GPT-6 Astra grades helpfulness, biblical accuracy, audience fit, and freshness from 0–100, with supporting excerpts and serious-concern flags. Letter grades use A ≥90, B ≥80, C ≥70, D ≥60, F <60. Scores are model editorial estimates; they are not measured reader helpfulness, independent biblical verification, or proof that an audience will prefer the result.

When a dimension falls below its target, the worker tries approved supplemental instructions for variety, helpfulness, accuracy, and audience fit. It never rewrites the core system templates or audience, Scripture, safety, or JSON requirements. The accuracy supplement explicitly distinguishes forgiveness from renewed access, restored trust, or foregoing legal protection, including in slides.

Legacy `gpt-5-mini` curriculum and `gpt-4o` personalization configurations are compared with `gpt-6.1-sol`. An already modern model with weak results is compared with `gpt-6-astra`. This matches the [official model guidance](https://developers.openai.com/api/docs/models): Sol balances capability and cost, while Astra is the higher-capability option. No model outside the checked-in allowlist can be adopted. The migration preserves the deployed legacy settings until a comparison earns an upgrade.

Each lane must complete three matched cases. Curriculum trials compare planning **and** writing with the same weekly theme and seven fixed featured passages/quotations. Personalization trials use the real prompt builder and generic spiritual-growth context, the same curriculum and recent history, and fixed practices. They are controlled replay cases, not an evaluation of each reader's private profile. The reviewer sees randomized variant labels without model names. The baseline's formatting failures remain visible as evidence; a candidate must pass the output checks.

Promotion requires at least a five-point mean improvement, accuracy ≥90, all other dimensions ≥80, no serious concern, and no per-case regression in any dimension. Incomplete responses, invalid candidates, uncertain accuracy, failed planning, or unavailable models prevent promotion. A healthy modern setup is kept. The worker makes at most 188,000 completion tokens' worth of requests per run, plus bounded inputs, with no SDK retries. It does not train model weights or discover new model names automatically.

## Persistence and operations

Apply `20261101160000_devotional_quality.sql` before enabling the cron. It creates only two private tables and two service-role-only functions. `devotional_quality_runtime` stores revisioned models and supplemental-rule keys. `devotional_quality_runs` stores weekly grades, evidence, experimental artifacts, comparisons, and before/after settings. Browser roles cannot read these tables or invoke the functions. No messages are sent to readers or staff.

Claims are idempotent by week; failed or two-hour-stale claims can be retried. Settings and the completed report commit together under a revision check. A duplicate or concurrent run cannot silently overwrite another settings revision. Failure exits nonzero for Render monitoring. Logs contain aggregate grades and model decisions; detailed artifacts remain in the private report table.

New personalized requests use current settings immediately. Already-generated curriculum remains scheduled; curriculum settings affect newly generated weeks. The job never silently rewrites past devotionals, reader history, or an existing future schedule. For an intentional future-content refresh, use the existing revision-archiving `scripts/refreshScheduledDevotionals.js` after reviewing the generated window. Retain existing week boundaries and featured Scriptures unless correcting an explicitly reviewed assignment.

To restore earlier settings, take the desired report's `before` model/rule fields, update the singleton runtime row with a revision check, and increment its revision; retain the review reports. To remove the feature entirely, first suspend its Render cron and deploy the earlier application version, then apply `supabase/rollbacks/20261101160000.sql`. The rollback drops the new feature's tables, including its audit history; export that history first.

Validation includes realistic grading failures, reader/day repetition, promotion floors and regression rejection, output contracts, private-table privileges, retry claims, atomic settings/report updates, migration reapplication, and rollback in a disposable PostgreSQL runtime.
