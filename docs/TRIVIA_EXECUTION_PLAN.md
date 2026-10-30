# Trivia execution plan: excellent questions, daily three, store review

Owner direction through October 30, 2026: call the feature **Trivia**; publish three questions daily, one Easy, one Medium, one Hard; share three ordered result squares; improve writing using strong examples and reference research; update mobile and submit the finished builds to Apple and Google for review. The owner requested this plan before setting the next execution path.

## Product contract

- A fixed set of three for each local calendar date. Every player sees the same reviewed revisions for that date. Order is always Easy → Medium → Hard.
- Keep the feature title Trivia. Use concise supporting copy such as “Three questions. Easy, medium, hard.” Internal routes/database identifiers can remain `discoveries`.
- Shared result: brand, date, three squares, score, dated browser link. Green means correct; red means answered incorrectly, timed out, or revealed; unplayed stays neutral. The app also uses checks/crosses, labels and accessibility announcements, so color is not the only signal. Never share questions, answers, scripture references that spoil a question, or private profile information.
- Save each answer immediately. Resume across app restarts, offline play, authentication changes and canonical server reconciliation. A partial set must never claim three played or a perfect-set streak.
- The twenty-second timer and existing answer elimination are currently retained. Validate their interaction with three questions and with the proposed difficulty bands before freezing the release.
- Broader reference research supports original Biblical trivia. Non-Biblical examples are writing benchmarks; they are not an instruction to turn the production feature into a general-knowledge feed.

## Actual state at this checkpoint

| Area | State | Evidence/remaining work |
| --- | --- | --- |
| Earlier release integration | Complete | Backend/mobile release work merged into `main`; web into its existing default `master`. The earlier one-question production experience is still live. |
| Three-question backend | Local prototype | Additive migration, service-only generation/publishing functions, complete-set projection, dated lookup, canonical results, fixed ordering, legacy-client compatibility, and atomic publication have implementation/tests. Backend suite: 195 passed; final lease/atomic-publication tests: 4 passed. **Migration not applied to hosted databases.** |
| Mobile | Local prototype | Three-question entry, home card, next-question flow, check/cross results, shared squares, offline result fields and perfect-set streak are implemented. Typecheck, 19 Trivia tests and behavior checks passed before the final checkpoint. **No new signed build or store submission yet.** |
| Web | Local prototype | Trivia naming, three-question flow, dated spoiler-free shares, results screen and generic social preview updated. Lint, typecheck and production build passed with public application config. |
| Browser journey | Synthetic isolated QA passed | Used a separate local API, not production approvals. Played correct, incorrect and revealed cases; verified 1/3, green/red/red order, progression, source rendering and copyable spoiler-free share fallback. Screenshot: [prototype](qa/2026-10-30-trivia/web-three-result-preview.jpg). |
| Question quality | Unfinished | One trial earned 8/8 craft; others exposed inconsistent difficulty and over-restrictive distractor judgments. **No excellent complete daily set has been established or published.** |
| Reference library | Design/research only | Verified potential open sources and reuse constraints. No external PDF/reference corpus has been ingested into production. |
| Live generation | Blocked | The configured OpenAI project returned HTTP 429 with “no credits remaining.” Further live model calls stopped. Funding/billing changes were not attempted. |
| Existing store review | Earlier builds only | Last recorded iOS 1.2.11 (66) and Android 138 were submitted previously. Verify current store status before preparing replacements. Manual release/managed publishing holds remain the intended settings. |

Checkpoint evidence: [tests, synthetic browser journey and content trial summary](qa/2026-10-30-trivia/prototype-checkpoint.json).

The implementation currently lives on `feature/daily-trivia-three` in backend, mobile and layperson web. Treat it as work in progress. Prompt scoring rules and the new database migration are not ready for production solely because tests pass.

## Execution order and acceptance gates

### 1. Freeze editorial standards and a benchmark

Read [the writing guide](TRIVIA_WRITING_GUIDE.md) and [the benchmark examples](TRIVIA_EXCELLENCE_BENCHMARKS.md).

Deliver:

- At least nine positive anchors, three per level, across recognition, geography, word meanings, customs, objects and grounded connections. Use strong published examples to study craft, and write original Biblical anchors with source support.
- At least six negative cases, including the disliked original question, answer leakage, an ambiguous chronology, a weak/overlapping option, a lexical fallacy, and disputed geography stated as certain.
- Source/edition, answer, rationale, authorship/rights, expected editorial decision and proposed difficulty for every benchmark. Distinguish publisher labels, our estimates, and actual measured success rates.
- A versioned reviewer calibration and a separate hold-out group not shown during prompt editing. Fix contradictory instructions before adding new thresholds.

Exit: the standards make sense to the owner/editor, factual failures always reject, and reviewers distinguish worthwhile easy questions from inevitable outcomes. A clear correct statement and a high model score do not automatically establish excellent trivia. Do not repeatedly rerun one rejected candidate hoping for a favorable score.

### 2. Build a small, licensed research pilot

Follow [the reference-library design](TRIVIA_REFERENCE_LIBRARY_PLAN.md).

Deliver:

- Private storage of permitted originals and a versioned source registry with rights, attribution, editions, hashes and retrieval provenance.
- Exact verse/reference/concordance search, structured lexicon lookup, and place/alias/period lookup. Add semantic retrieval only after testing it against precise lookup.
- Bounded tool calls for searching, expanding context, identifying words/places and comparing evidence.
- A small evaluation set testing retrieval, source lineage, OCR/Greek/Hebrew errors, ambiguous names, uncertain sites, and no-answer behavior.

Keep commentary interpretation, lexical sense and historical claims distinct. A modern map pin is not proof of an ancient identification. Two sites repeating one source are not independent evidence.

Exit: each retrieved fact is traceable to an allowed source and exact location; sources can be inspected in context; tools can report insufficient evidence. No unlicensed bulk PDF import, paid subscription purchase or large infrastructure commitment is needed to reach this gate.

### 3. Finish generation and approve an initial content bank

Resume live model work only once the API credit issue is resolved. Use the benchmark and a bounded evaluation budget first; do not regenerate a month of content while the rubric is still moving.

Deliver:

- Versioned writer/reviewer prompts whose difficulty estimates reflect the intended audience and are calibrated against the benchmark.
- A small source-backed pilot, then at least seven complete daily sets (21 original questions) for launch. Each question has a precise knowledge target, credible alternatives, a concise rewarding reveal, saved evidence and independently solved answer.
- A complete-set review for variety, repeated answers, legitimate Easy/Medium/Hard progression and cross-question answer leakage.
- A reproducible record of accepted and rejected attempts. Explicitly authorized/editor-reviewed retries must preserve prior attempts and source plans rather than silently resetting an exhausted quota.
- An operations path for exhausted/withheld days and stale runways. Add the missing admin retry/review flow before relying on unattended generation.

The prototype's automatic gate accepts simple WEB-text facts. Before automatically publishing lexicon-only, archaeological or external-geography facts, implement a versioned multi-source schema and server/database validation with per-claim evidence and uncertainty. Reference suggestions must not bypass this boundary.

Exit: an editor has actually assessed the launch bank; the full benchmark passes; held-out quality checks pass; no question's difficulty is relabeled merely to fill a missing slot. If real audience testing is not yet available, report difficulty as estimated. Prepare a consent-based 12–20-person pilot when the owner supplies/recruits testers; do not send recruitment messages autonomously.

### 4. Complete product, compatibility and accessibility QA

Build on the existing prototype; do not restart it.

Backend/database:

- Rehearse the additive migration on hosted staging, including grants/RLS, rollout/rollback strategy, privacy, real API results and legacy-client parity. Keep all existing revisions, approvals, schedules and completions.
- Verify atomic sets, first-accepted answers, matching revisions, fixed result order, partial states, withdrawal of one question, date boundaries, archived links, duplicate submissions, interrupted workers and lease/retry budgets.
- Add a safe, versioned admin retry path preserving attempts and rejected content. Review correction/withdrawal behavior for a fixed published daily set.
- Keep existing notifications off unless separately authorized. Update future reminder capability/selection so a three-question client is reminded about unfinished sets and links to the correct daily set; retain older-client compatibility.

Web/mobile:

- Verify the full three-question journey, returning to results, reviewing each answer, all-correct/all-wrong/mixed/revealed/timeout outcomes, partial shares and copy/share cancellation.
- Check persistence after restart and offline play, guest import, sign-in/out isolation, server canonicalization, midnight/DST/travel, archive dates and withdrawn questions.
- Check small screens, large text, light/dark themes, focus order, VoiceOver/TalkBack and non-color result labels. Ensure twenty seconds remains usable for approved Hard questions.
- Exercise native installed/uninstalled universal links and the dated browser share link. Confirm social previews expose no answers.
- Ensure the public feature name is Trivia in entry points, screen titles, settings, reminders, social previews and store copy.

Checks: backend `npm test` and `npm run typecheck`; mobile `npm run typecheck`, `npm run test:discoveries`, `npm run test:content-share`, `npm run check:behavior`; web lint, typecheck and production build. Use meaningful integration checks and actual browser/native evidence rather than source-string tests as proof of behavior.

Exit: the complete story works across browser, API, data and mobile with recorded evidence. Any unperformed physical-device checks are explicitly listed; they are never marked passed because simulator checks passed.

### 5. Release the compatible backend/web and submit mobile for review

Prepare a concrete release before store actions:

1. Create reviewable PRs, resolve review/CI findings, merge the final source into backend/mobile `main` and web `master`, and verify release heads are included. Avoid leaving fixes only on release branches.
2. Recheck production backup/recovery evidence, staging rehearsal, migration inventory and the reviewed release commit. Apply the additive database change, deploy compatible backend/content jobs and verify health, old-client behavior and the reviewed content runway.
3. Stage/test the production web build, then promote the tested deployment. Verify the production dated Trivia link and all three reviewed items. Keep notification delivery unchanged.
4. Build signed iOS and Android packages from the same clean final mobile commit using production configuration. Read the actual remote version counters first; do not assume build 67/139 remains available. Inspect bundles for the new Trivia flow and production services, with no local/staging endpoints or diagnostics.
5. Update release notes and screenshots to accurately describe three questions, Easy/Medium/Hard, source-backed reveals and spoiler-free result squares.
6. Upload and select the new builds. If the old release is still waiting for review, replace/withdraw it as required and resubmit the finished replacement. Verify **Waiting for Review/In Review** in Apple and **Changes in review** in Google. TestFlight/internal upload alone is not completion.
7. Preserve Apple's manual release and Google's managed publishing. The authorized goal is store review submission; public app-store publication remains a later owner action unless explicitly authorized.

Exit: final source is on default branches; backend/web are verified live; today and the launch runway contain complete reviewed sets; both stores visibly reference the new builds in review. Record build IDs, source commit, deployments, store states and evidence links. Report any external agreement/account/review blocker precisely.

## Dependencies and scope controls

- **Required external change:** usable API credits. No payment or billing change was authorized/performed.
- **Editorial input:** approval of benchmark direction; real-reader recruitment if a measured audience trial is required before launch.
- **Reference rights:** an accessible PDF is not automatically licensed for app ingestion or redistribution. Use approved open data first; request specific permissions only when a needed source requires them.
- **Store access:** existing authenticated tooling/sessions can be used. New binding agreements or account/security changes require their applicable user action.
- No bulk regeneration of historical private advice/news, no unrelated app redesign, no new notification rollout and no public store publication are included.

## Suggested next goal instruction

“Execute `docs/TRIVIA_EXECUTION_PLAN.md` end to end, starting by finalizing the benchmark and writing guide. Build on the existing `feature/daily-trivia-three` work. Produce excellent source-backed Easy/Medium/Hard daily sets, verify backend/web/mobile, merge the finished changes into the default branches, deploy the compatible services, and submit the final mobile builds to both stores for review. Preserve source/attempt history and public publishing holds. Report real blockers and do not represent uploads or model scores as completed review or audience validation.”
