# Timed trivia and spoiler-free sharing — October 28, 2026

User requests: timer, remove incorrect choices, streak and elapsed-time stats, simple sharing with no answer (the user explicitly rejected Wordle squares); always show a short factoid and the Scripture from the user's preferred Bible-reader edition after answering. Remove report/help section. One simulator only.

Research inspected:
- HQ Trivia question timer: https://mobbin.com/screens/83cf8c38-888a-48bd-9f16-31c2be7fa120 — circular countdown above short question and answers.
- HQ Trivia results: https://mobbin.com/screens/8e6e2824-e979-417c-8a93-117ad3b4302b — concise correct/incorrect results with a single Done action.
- Kahoot: https://mobbin.com/screens/00e75c6c-5132-44dc-875f-8fb08dd26bce — quiz editor (not live play), explicit 20-second duration and large answer blocks.
- Duolingo: https://mobbin.com/screens/f84d9b73-f89f-451a-8d81-6f8eaa579cb2 — compact result metrics; no claim that this capture shows sharing.
- Netflix rules: https://help.netflix.com/en/node/683580550445668 — general knowledge rounds have four choices and 20 seconds.
- Netflix statistics: https://help.netflix.com/en/node/683575592229476 — response speed, correct answers, streak and lifetime stats.
- Roku: https://support.roku.com/article/roku-new-os-features — daily set and archive. No live Roku interaction was performed.

Confirmed behavior (user chose automatic elimination and consecutive correct days): 20 seconds; remove one wrong choice at 7 and 14 seconds, leave two until timeout; a wrong tap ends the round. Correct daily-answer streak (not a general devotion/faith streak). Start explicitly before revealing the question. Persist the deadline so backgrounding or reopening does not reset the clock. Timeout must still show factoid and preferred Scripture. Keep existing save-before-reveal behavior.

Share: a short sentence and generic /discoveries link. A correct daily result says “I answered Sanctuary trivia correctly today!” or “I answered Sanctuary trivia correctly for the 5th day in a row!” Ordinals handle 11th/12th/13th and later decades. Other outcomes say only that the user played. Archive results do not claim to have answered today. No grid, question, answer choices, correct answer/position, factoid, Scripture citation, elapsed-time report, or item-specific preview is shared. Historical practice must not inflate the daily streak. Do not share an app screenshot containing the answer.

The marketing app now owns /discoveries and /discoveries/[id], with playable trivia, homepage navigation/invitation/footer links, and bundled-reader Scripture. Native, app web, and marketing use identical tested game rules. Marketing guest history is local to that browser.

Implemented locally: shared native/web game rules, persisted deadline and first completion timing, SQL-derived canonical outcome/date, additive game-result migration and rollback, timer/result/share views, generic public daily landing and spoiler-free preview image. Native correct-answer/share/translation and browser reload/timeout/manual-copy flows were exercised. 45 backend and 14 mobile Discovery tests pass; mobile behavior checks and both type checks pass. See mobile/docs/design/2026-10-28/VISUAL_QA.md for captures and coverage limits.

Question authorship resumed at the user's request using the Trivia Hall of Fame guide. Original assistant-authored starters are retired. The default bank now contains a smaller source-checked contextual pilot, with live writer/reviewer provenance; held or rejected experiments are not playable candidates. See content/discoveries/README.md and docs/DAILY_DISCOVERY_CURRICULUM.md. No question is published or human-approved by these local files.

Database: read-only inspection of the hosted Sanctuary project confirmed that public.discoveries, public.discovery_revisions, and public.discovery_schedule do not exist. No hosted mutation has occurred. Production rollout prerequisites remain in docs/PRODUCTION_DATABASE_ROLLOUT.md. The original 36 assistant-authored drafts are archived under content/discoveries/retired. Current candidate counts and live audit records are documented in content/discoveries/README.md; source hashes and answer containment are validated, and human approval/publication remain pending.
