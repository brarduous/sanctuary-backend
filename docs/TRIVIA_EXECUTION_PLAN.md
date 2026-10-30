# Trivia execution plan: excellent questions, daily three, store review

Owner direction through October 30, 2026: call the feature **Trivia**; publish three questions daily, one Easy, one Medium, one Hard; share three ordered result squares; improve writing using strong examples and reference research; update mobile and submit the finished builds to Apple and Google for review. The owner requested this plan before setting the next execution path.

## Product contract

- A fixed set of three for each local calendar date. Every player sees the same reviewed revisions for that date. Order is always Easy → Medium → Hard.
- Keep the feature title Trivia. Use concise supporting copy such as “Three questions. Easy, medium, hard.” Internal routes/database identifiers can remain `discoveries`.
- Shared result: brand, date, three squares, score, dated browser link. Green means correct; red means answered incorrectly, timed out, or revealed; unplayed stays neutral. The app also uses checks/crosses, labels and accessibility announcements, so color is not the only signal. Never share questions, answers, scripture references that spoil a question, or private profile information.
- Save each answer immediately. Resume across app restarts, offline play, authentication changes and canonical server reconciliation. A partial set must never claim three played or a perfect-set streak.
- The twenty-second timer and existing answer elimination are currently retained. Validate their interaction with three questions and with the proposed difficulty bands before freezing the release.
- Broader reference research supports original Biblical trivia. Non-Biblical examples are writing benchmarks; they are not an instruction to turn the production feature into a general-knowledge feed.

## Final release state, October 30, 2026

The three-question browser game is live at https://sanctuaryapp.us/trivia. The production database has seven complete reviewed daily sets (21 questions), October 30–November 5, with no missing or exhausted dates in that runway. Backend and mobile source is merged into `main`; web source is merged into `master`. The backend and scheduled worker use the same question, separate difficulty, set and rolling-week gates.

Apple 1.2.11 (67) is **Waiting for Review**, submission `0f3b5b3a-6eea-4e3b-8f22-b4266f0530ec`. Google Play release 19, **139 (1.2.11) · Trivia**, is **In review**, contains only build 139 and deactivates 138. Apple manual release and Google managed publishing remain enabled. These are review submissions, not public native availability.

The [release checkpoint](qa/2026-10-30-trivia/release-checkpoint.json) records actual deployment IDs, commits, validation, the brief rollout compatibility mismatch and its resolution, and remaining measurement limits. The CMO brief and real production/native/store screenshots are in mobile `docs/releases/TRIVIA_SOCIAL_BRIEF.md`.

Validation: 205 full backend tests; 42 focused tests after the final rejected-draft retention fix; syntax checks; 20 mobile Trivia tests plus behavior/content-sharing checks; web lint, typecheck and production build. Hosted rollback/roll-forward preserved publications, attempts, completions and legacy schedules. Eight real hosted JWT/privacy checks passed and both disposable accounts were cleaned up. Production guest play exercised correct, incorrect and revealed outcomes and the exact **Share your Results** CTA.

The new rolling-week editors caught two cross-day answer leaks in the launch bank. Changed manuscripts passed every affected gate, with original reviews and rejections retained. A separate fresh scheduled-writer trial accepted Easy/Medium drafts but withheld the entire day when all three Hard attempts failed their gates. That isolated test changed no production content; it demonstrates the hold behavior, not guaranteed unattended generation success. Monitor missing/exhausted runway dates and use the concrete revised-plan operator retry when editorial intervention is needed. The token ceiling is checked between complete candidate/review operations, so an in-flight review can exceed that checkpoint limit.

The reference pilot stores 15 private original/extracted objects and an index of 95 entries from seven source editions. Retrieval is wired into future writing as research. Published claims still require the saved WEB passage. Difficulty remains estimated; physical-device accessibility and a recruited reader study have not been claimed.

Historical [prototype evidence](qa/2026-10-30-trivia/prototype-checkpoint.json) and all actual model audits remain available; no history was rewritten to make the final release appear cleaner.

## Scheduled runs use the same standards

`cron/generateDiscoveries.js` now invokes the daily-three worker exclusively. It never creates weaker single-question replacements through the old curriculum generator. Atomic publication also points legacy clients at the approved Easy question, retaining already-released legacy history.

The existing daily 08:15 UTC cron maintains a seven-day runway; a weekly/catch-up invocation uses the same worker, models, budgets and gates, with up to seven missing dates per run. Three source choices per slot are frozen before generation; all nine options have distinct chapters. Exhausted attempts remain held. Only a concrete operator reason and a revised plan can start a bounded retry epoch; old attempts and set reviews are retained.

Every complete day is reviewed against published sets within six days on either side. Both independent editors check repeated knowledge targets, people/place/object/action variety, Testament balance and cross-day answer leakage. This is a rolling-week review of available content, not a claim to have reviewed unseen future questions. Publication takes a database lock and requires the exact same question contents and neighboring context; changed context requires a new review. A rejection withholds the entire day. Missing or exhausted dates make cron/status checks unhealthy and visible in the existing admin inspection endpoint; no notification delivery is enabled.

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

Live model work has resumed. Preserve bounded evaluation budgets and all rejected attempts; do not rerun an unchanged rejected candidate to obtain a pass.

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

- **API access:** working again; no payment or billing change was performed.
- **Editorial input:** approval of benchmark direction; real-reader recruitment if a measured audience trial is required before launch.
- **Reference rights:** an accessible PDF is not automatically licensed for app ingestion or redistribution. Use approved open data first; request specific permissions only when a needed source requires them.
- **Store access:** existing authenticated tooling/sessions can be used. New binding agreements or account/security changes require their applicable user action.
- No bulk regeneration of historical private advice/news, no unrelated app redesign, no new notification rollout and no public store publication are included.

## Authorized completion path

“Execute `docs/TRIVIA_EXECUTION_PLAN.md` end to end, starting by finalizing the benchmark and writing guide. Build on the existing `feature/daily-trivia-three` work. Produce excellent source-backed Easy/Medium/Hard daily sets, verify backend/web/mobile, merge the finished changes into the default branches, deploy the compatible services, and submit the final mobile builds to both stores for review. Preserve source/attempt history and public publishing holds. Report real blockers and do not represent uploads or model scores as completed review or audience validation.”
