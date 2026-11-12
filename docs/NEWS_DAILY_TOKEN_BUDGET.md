# Daily edition and token budget

News defaults to one richer daily edition built directly from publisher RSS excerpts. It no longer needs newly generated article outlooks. The web news page leads with the edition; earlier article outlooks remain accessible in an optional archive. Daily email uses that same edition and refuses stale editions.

The normal path makes one writing call (6,000 completion tokens maximum) and one independent source/Scripture review (2,000 maximum). No automatic paid retries or rewrites. Input is at most 24 fresh, deduplicated publisher excerpts, each limited to 900 characters, plus titles, attribution and links. The 8,000 completion-token ceiling includes reasoning; it excludes input tokens. Actual savings require comparing production usage before and after rollout. Per-article generation, reviews, impact scoring, cluster generation and taxonomy AI work are bypassed by the default cron entry point.

A database claim allows only one attempt per UTC date, including concurrent invocations. Failed editions retain the previously published edition. A failed attempt needs operator investigation before manually clearing its claim; this deliberately prevents retry storms. The claim table records known successful-call token usage, including a rejected review; failures without returned usage cannot be measured there.

## Rollout

1. Apply `supabase/migrations/20261112120000_news_daily_budget.sql` before deploying the backend. The generator fails closed if this table is missing.
2. Deploy the backend and layperson web changes. The Render blueprint adds a daily edition job at 11:00 UTC (6 a.m. Eastern standard time, 7 a.m. daylight time), ahead of the briefing delivery window.
3. Remove `NEWS_ARTICLE_AI_ENABLED=true` from existing news workers. Existing `cron-outlook` invocations redirect to the budgeted daily edition. Disable duplicate legacy article/backfill jobs outside this blueprint; scripts explicitly invoked for maintenance retain their original behavior.
4. Check the next edition, review result, source links and `news_daily_generation_runs.tokens`. No live generation, email delivery, database migration or deployment was performed during implementation.

To explicitly restore legacy article processing, set `NEWS_ARTICLE_AI_ENABLED=true`. The old Puppeteer install pre-hook was removed; install Chrome separately before running legacy full-text collection if needed.

## November 12 rollout verification

The release is based on current production `origin/main`, preserving the newer reported-conduct assessment and reader-correction policy. Each daily story cites supplied publisher report IDs; these become external report links rather than invented internal article IDs. The general content auditor excludes news and daily briefs in the default mode, and queued news rewrites are protected without model calls. Other content continues its existing quality process.

Production Supabase PITR was available and a private snapshot of all 940 daily summaries was saved before the migration. An isolated PostgreSQL rehearsal verified repeat application, existing-row retention, uniqueness of daily claims, and denied anonymous access. The additive migration was applied and recorded as version `20261112120000`; all 940 summaries remained. Application rollback retains the additive schema and edition history.

The existing `sanctuary-scriptural-outlook-cron` is suspended. The existing `sanctuary-daily-news-overview` replaces its former three-times-daily schedule with `0 11 * * *`. No additional daily cron service is created. The public news website uses the brief as its homepage; the previous feed lives at `/archive`. Both daily readers and the newsletter share the stored edition.
