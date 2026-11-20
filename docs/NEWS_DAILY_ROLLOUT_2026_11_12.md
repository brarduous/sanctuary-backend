# News daily edition production rollout — November 12, 2026

Live website: https://www.sanctuarynews.org
Backend release: `63916d57b7d992a4751d7ea8d5777107e2d3e601`
News website release: `081223aa2cb7bb92a7f343a16f34b5f5819baf32`

## Production changes

- Applied and recorded only `20261112120000_news_daily_budget`: one private daily-generation claim table and an additive `sources` column. The 940 existing editions were retained. Supabase PITR availability was checked and a private edition snapshot was saved before applying the migration.
- Deployed the backend, daily news job, and shared quality workers from current production `origin/main` plus the isolated news changes.
- Suspended `sanctuary-scriptural-outlook-cron` (`crn-d2vlmtodl3ps739au0p0`).
- Changed existing `sanctuary-daily-news-overview` (`crn-d4qns70gjchc73bfk8og`) from `0 11-23/6 * * *` to `0 11 * * *`. No duplicate cron service was created.
- Disabled news article/brief auditing and queued paid rewrites in the generic content-quality workers by default. Non-news content retains its existing behavior.
- Published the daily edition as the news homepage and retained the earlier article feed at `/archive`. Original-report links are validated against the report IDs supplied to the writer. Earlier article links remain valid.

## First edition and duplicate protection

The new edition is ID 1200, prepared November 12 at 11:14 a.m. Eastern. It contains four stories sourced from a 24-excerpt input package across seven publishers. One draft and one independent review used 13,654 combined input/output tokens. The completion-token caps are 6,000 for writing and 2,000 for review; these limits include reasoning but exclude input tokens.

The daily claim is `completed` with `tokens=13654`. A second Render invocation returned without a new edition or further model processing. The stored edition count remained 941. There are no automatic writer/provider retries. A failed edition needs operator investigation before its claim is cleared for another paid attempt.

## App preservation

No Sanctuary mobile, Sanctuary layperson web, Sanctuary Clergy, or Studio frontend deployment was performed. The backend release leaves `index.js`, all routes, middleware, authentication/billing configuration, devotional/trivia generation jobs, and their related utilities unchanged from production. It does not remove or reset app data. Existing daily-summary fields (`synopsis`, `scripture`, `prayer`, `created_at`) remain available to existing clients; source links are additive.

## Verification

- All 270 backend tests passed, including daily input bounds, citation validation, duplicate-run protection, failed-review behavior, and disabled paid news rewrites.
- Backend syntax checks and the news web typecheck passed; all 10 web tests passed.
- The Vercel production build reached READY and assigned the production domains.
- Public `/`, `/today`, and `/archive` returned 200; both daily pages rendered all four headlines from edition 1200, fuller detail, and original-report links.
- Production backend health, the daily-summary API, existing-article API, and public trivia bundle returned 200. The daily API retained all legacy client fields.
- Visual browser QA was unavailable because the computer-use browser host was unavailable. HTTP/content verification was completed instead.

Rollback preserves the additive schema and all edition/source history. Restore the previous application commits and cron settings only if needed. No newsletter send was manually triggered.
