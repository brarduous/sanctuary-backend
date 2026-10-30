# Discovery curriculum, automated approval, and difficulty

Implemented October 28, 2026. This updates the initial manual-only policy at the user’s explicit request: straightforward Bible-text questions may auto-approve. Historical conclusions, doctrine, tradition-specific assertions, disputed readings, and unsupported interpretations remain outside this automation.

## Context-first writing and live provenance — October 28 revision

The original 36 candidate questions were assistant-authored starter drafts, not products of a running cron. They had only excerpt/hash/answer-containment validation and are retired. Production now runs the source-bound curriculum generator and all six Discovery migrations. Current content, deployment and visibility state is recorded in the [rollout record](DAILY_DISCOVERY_ROLLOUT_2026_10_28.md). Early synthetic preview approvals are not production approvals.

The current writer is `sanctuary-trivia-writer-v4`, default model `gpt-5.6-sol`; reviewers are `gpt-6.1-sol` and `gpt-6-astra` in separate calls. Model availability was checked against the project's actual provider inventory before the live pilot. `draft:discoveries` uses the same model adapters, schemas and evidence/craft gates as the cron, without any database connection or publication. Prompt hashes, resolved model IDs, response IDs, token usage, rejected attempts and full verdicts are retained in its audit. A successful live batch is not a deployed scheduled job.

[Writing Great Questions](https://www.triviahalloffame.com/writeq) informed the editorial approach: useful context and clues, interesting details, audience fit, precise wording, clearly wrong alternative choices, and avoiding tricks or subjective claims. This guide is editorial guidance, never evidence for biblical facts. Question premises, answers and factoids must be supported by the fixed Scripture excerpt.

Questions aim for 12–18 words, with a hard limit of 22 words/140 characters; factoids remain at most 30 words/220 characters. Natural biblical framing such as “In John's account” replaces the forced chapter prefix. Bare verse-number lookups and repeating the answer in the question fail deterministic checks. Coherent scene selections prevent an unrelated adjacent genealogy or event from becoming a decorative clue.

Both reviewers separately rate context, interest, fair challenge and choice quality from 0–2. Each must reach at least 6/8, with no zero dimension. Accuracy and difficulty remain separate. A factually correct but dull, misleading or grammatically obvious question is rejected. Specific reviewer criticism is passed into retries; the writer is not given a target factual-confidence score.

Each contextual premise is checked independently, including chronology and scene details. Reviewers select only verse IDs within the saved evidence. The strict response schema enumerates only the saved verse IDs. Code copies the exact trusted verse text into the audit; references outside that range produce invalid evidence and fail the gate. Model-transcribed quotations cannot pass as evidence. For answer options, the raw schema names `verdictConfidence` explicitly: confidence in the supported/not-supported decision, not the probability that an option is the answer. This fixes the live-trial failure where a reviewer assigned zero to a clearly wrong choice. The normalized audit retains `confidence` for compatibility with the SQL gate.

Evidence policy `discovery-evidence-v3` keeps the minimum factual score at 95 for every premise, claim and option verdict. The additive `20261028220000_discovery_question_craft.sql` migration recomputes craft thresholds and source quotations in SQL; it rejects forged accepted flags, missing context checks, low scores, summary mismatches and old policy verdicts. Apply it after the curriculum migration; its rollback restores the earlier gate and must accompany an application-policy rollback. Existing week plans now use curriculum version v3, so stale plans require explicit review rather than silently changing their meaning.

The active unpublished pilot currently contains three live-model-written questions and one assistant-authored contextual Lazarus revision, all independently checked; see content/discoveries/README.md for the exact dispositions and response provenance. The original 36 starters are retired. The live pilot exposed protocol and writing failures. Rejections and earlier experiments remain auditable; they are not published candidates. Self-rated scores are not a measured 95% probability of truth. The independent labeled calibration procedure below is still required before making such a claim.

```sh
npm run draft:discoveries -- --plan content/discoveries/contextual-pilot-plan.json
# Requires the existing OPENAI_API_KEY; calls real models but writes no database data.
npm run draft:discoveries -- --live --plan content/discoveries/contextual-pilot-plan.json --count 7 --output content/discoveries/new-candidates.json
# Resume retains accepted results and consumed attempts; it cannot reset an exhausted candidate.
npm run draft:discoveries -- --live --resume --plan content/discoveries/contextual-pilot-plan.json --count 7 --output content/discoveries/new-candidates.json
```

## Daily curriculum job

`npm run cron-discoveries` maintains 30 calendar days of approved, scheduled discoveries, filling only missing dates. By default, one run attempts up to seven dates. A cold start therefore needs at least five full seven-date runs with no rejections or budget interruptions to establish the full runway; later runs replenish it. The job never overwrites an existing publication date or restores withdrawn content automatically.

The deployed Render service `sanctuary-daily-discovery-curriculum` runs at **08:15 UTC daily**, after the existing 08:00 UTC devotional job. Render cron schedules use [UTC](https://render.com/docs/cronjobs). The existing `discovery_runtime_settings` visibility flag is separate and is not enabled by this job. See the rollout record for the exact deployed commit and service IDs.

The curriculum has 52 dated weeks built from 13 learning modules and four seven-day source selections per module: creation/covenant, Exodus/wilderness, Israel’s stories, exile/return, poetry/wisdom, prophets, Matthew, encounters with Jesus, Luke/John, John/Acts, Acts/Romans, early-church letters, and letters/hope. Each week records a learning goal, seven distinct daily angles, source references/hashes, and difficulty targets. Existing plans are reused rather than silently regenerated.

When a general devotional already exists for a date, its featured passage is expanded into a bounded surrounding reading and used for that discovery. When it does not exist, the job uses the explicit curriculum source. Missing source text never gets filled from model memory. The alignment flag is recorded; a discovery is not presented as a direct link to a personalized devotional.

### Source collection

`content/discoveries/web-corpus.json` is a self-contained, versioned extraction of the app’s existing World English Bible classic. It contains 66 shared biblical books and 1,189 chapters; this source selection is not a claim about other Christian canons. The file records its source SHA-256, corpus SHA-256, translation, attribution, and public-domain rights. The job verifies the corpus hash on load, selects 1–20 complete verses, stores their exact excerpt, and supplies the full chapter as context for verification.

The existing app file has five empty verse entries: Luke 17:36, Acts 8:37, Acts 15:34, Acts 24:7, and Romans 16:25. The extraction records them explicitly and refuses to use them as evidence. This job does not adjudicate manuscript variants or manufacture missing wording.

To intentionally rebuild from an updated trusted file:

```sh
node scripts/discoveries/buildScriptureCorpus.js ../sanctuary-mobile/assets/bible/web-optimized.json
```

Review the corpus/version change and persisted plans before deployment. The deployed backend does not need the mobile repository. Model-supplied URLs are never fetched; public source URLs are constructed from the fixed eBible edition and book/chapter code.

## Evidence gate: minimum 95, no averaging

The pipeline is:

1. **Source first.** Fix the passage, exact source text/hash, edition, scope, and curriculum date before asking for a question.
2. **Write a candidate.** The v4 schema-constrained writer produces four distinct choices and 1–2 source-backed claims, with at most 14 words per claim. It cannot supply its own sources or approval score. The server supplies the heading, source metadata, and scope statement.
3. **Deterministic checks.** Validate content shape, source identity, complete answer phrase in the actual passage, claim/source mapping, passage attribution, textual question form, explanation coverage, and duplicate/near-duplicate exclusion. Negative/trick questions, superlatives such as “oldest,” unsupported authorship, and unqualified historical assertions are excluded.
4. **Two verifier calls.** Different configured models independently solve the question and assess it without the answer key, target difficulty, writer confidence, or the other verifier’s response. They evaluate every claim and every option, scope, and explanatory coverage. Chapter context is available to expose misleading extraction; accepted quotations must come from the saved excerpt.
5. **Hard rejection conditions.** Reject any unsupported/partial/uncertain/contradicted claim, missing assessment, second valid or ambiguous answer, disagreement with the key, fabricated/missing quote, unresolved issue, complex interpretive claim, malformed output, incomplete model response, or strongly conflicting difficulty ratings.
6. **Minimum score.** The evidence score is the **minimum** of both verifiers’ question accuracy, scope accuracy, explanatory coverage, every claim confidence, and all four option-confidence scores. Every component must be an integer at or above 95. A 94-point claim fails even if everything else is 100. `DISCOVERY_MIN_EVIDENCE_SCORE` may raise the floor to 100 but cannot lower it below 95.
7. **Atomic approval and scheduling.** The database rechecks the gate, source hash, quotes, assessment coverage, rubric, distinct models, and retry lease. Only a passing Bible-text revision receives `review_method=automated_evidence` and a schedule entry. It records no fictitious human reviewer or human-source-reading attestation. Low-scoring candidates never enter the content library.

OpenAI [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) supplies schema adherence, not factual correctness. We reuse the existing Responses helper with strict schemas, `store:false`, explicit completion checking, 90-second call timeouts, and zero hidden provider retries. The writer defaults to `gpt-5.6-sol`; independent reviewers use `gpt-6.1-sol` and `gpt-6-astra`. Model IDs are configurable; actual returned model IDs are audited and must differ too.

**The score is an evidence-assessment threshold, not a calibrated 95% probability of truth.** Different models can share errors; their confidence values are not multiplied to manufacture a probability. Direct source checks, disagreements, strict scope, and calibration are therefore separate parts of the methodology.

### Rejection and recovery

- Each date has a persistent budget of **three candidates**, including interrupted attempts. Failure feedback tells the writer what was unsupported, without supplying a target confidence score. It must choose a different textual fact rather than polish an unsupported assertion until it passes.
- After three failures, leave the date empty, mark it exhausted, report it in status, and exit the standalone job unsuccessfully. A future cron run cannot reset the budget automatically.
- A 15-minute database lease prevents concurrent cron/API workers from spending on the same date. Interrupted workers consume their allocated attempt; a dead third attempt is reported as exhausted and cannot obtain a fourth attempt.
- API authentication, invalid-request, and rate-limit failures stop the run after recording the failure rather than exhausting every future date. A token-budget setting stops additional work between attempts/dates; it is not an exact dollar limit and cannot cancel an already billed call.
- An administrator can reset an exhausted date through `POST /admin/discoveries/curriculum/YYYY-MM-DD/retry`. This starts a new audited generation epoch and preserves previous failures. Review/fix the source or rubric issue first.
- `DISCOVERY_AUTO_APPROVE_BIBLICAL=false` preserves passing candidates as drafts for manual review. Manual approval of historical/tradition content still uses the existing global-admin review workflow.

## Difficulty rubric

Audience: a general adult Christian reader. Difficulty is estimated from the task, not inferred from the model’s factual confidence.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Familiarity | Widely familiar account/detail | Recognizable account, less familiar detail | Little-known textual detail |
| Evidence navigation | Directly stated in one verse | Two nearby explicit statements | Several details across the passage |
| Reasoning steps | Direct identification | One supported connection | Two supported connections |
| Distractor similarity | Clearly different categories | Plausible alternatives of the same type | Closely related alternatives separated by clear evidence |

Each verifier assigns all four values and gives a rationale. Sum 0–2 is **Easy**, 3–5 **Moderate**, and 6–8 **Challenging**. A difference greater than two total points between verifiers rejects the candidate for regeneration. Otherwise, round their mean total and derive the public band from that score. The full assessments/rationales stay in the private audit; the content stores `{rubricVersion,level,score}`.

The weekly target is three Easy, three Moderate, and one Challenging item. Targets guide writing; the independently assessed level always wins. A valid Easy question is labeled Easy even on a Challenging target day. Actual mix is recorded in the run summary so future planning can be tuned. Ambiguity, trick wording, missing evidence, and obscure unstated assumptions never count as legitimate difficulty.

The label appears on the mobile Home card, discovery detail screen, public web question, question-share text, and social image. Existing unassessed items keep no invented label. A manual editor can include difficulty only with a consistent rubric version/score/band; the ordinary revision review still applies.

## Calibration and empirical quality

Unit tests and synthetic verifier fixtures establish code behavior; they do not measure model accuracy. A live calibration command is provided:

```sh
npm run eval:discovery-accuracy -- content/discoveries/evaluation-cases.example.json
npm run eval:discovery-accuracy -- /path/to/independently-labeled-holdout.json --live
```

Without `--live`, this only validates the labeled dataset and makes no API or database calls. The two-case example is an illustrative smoke test, not a representative benchmark. Live evaluation calls the actual configured verifier pair, makes no database writes, and records accepts/rejects against the supplied independent labels.

Build the real hold-out set before claiming measured 95% precision. Keep it separate from generation prompts and retry feedback. Include correct questions plus wrong keys, two valid options, plausible distractors, altered quotations, misleading references, parable/history confusion, translation-sensitive claims, invented details, and weak-source cases. Establish expected decisions from sources independently of the models being tested, with a written rationale for every label.

The report includes false acceptances, precision among accepted questions, disagreements, and a Wilson 95% lower confidence bound. It does not call a small perfect sample “95% accurate”: 20 perfect accepted cases still fail the empirical gate. Live evaluation exits unsuccessfully if there is any false acceptance or if the lower bound on precision is below 0.95. This result only applies to the evaluated population; it does not establish truth for every future question. Periodically sample production approvals, investigate every factual report, and rerun the hold-out set after model/prompt/corpus/policy changes.

Difficulty estimates should later be checked against sufficiently sized aggregate answer results before revising the rubric; no private user history is exposed by this implementation.

## Operations and rollout

Apply/rehearse `20261028153000_discovery_curriculum.sql` after the original discovery migration, following the repository’s existing production database process. It creates private week plans, runs, slots, and attempts, and distinguishes human/automated reviews. It does not change legacy-table permissions or enable the public feature. The rollback refuses to relabel existing automated approvals as human approvals; after any auto-approval, disable the job and use an audited roll-forward/restore procedure.

Commands:

```sh
npm run cron-discoveries
npm run cron-discoveries:status
npm run test:discoveries
npm run typecheck
npm test
```

Authenticated cron routes: `GET/POST /api/cron/discoveries` and `GET /api/cron/discoveries/status`, using the existing cron-secret mechanism. Status returns 503 for an unhealthy runway; generation returns 503 if dates are exhausted. No `force` input can bypass the evidence gate or overwrite a date.

Global-admin inspection: `GET /admin/discoveries/curriculum` returns plans, recent run summaries, and assessment audits. These tables and RPCs are inaccessible to direct anonymous/member clients. Both automated and manual approval support the existing withdrawal/correction flow; a correction must pass the appropriate new-revision review.

Configure the environment values documented in `.env.example`/`render.yaml`. No hosted migration, real generation run, live model evaluation, service deployment, or visibility change was performed during implementation. No OpenAI API key was available in this workspace; provider behavior and empirical precision remain unmeasured until configured live evaluation. The cron/retry/database paths have been tested with isolated PostgreSQL and explicit synthetic model fixtures.

Verification: all 162 backend tests passed; the final discovery-focused suite passed all 43 tests after the last SQL gate changes. All ten mobile discovery tests, backend/mobile/web type checks, targeted web lint, and the web production build passed. The difficulty label was also checked in the browser at phone width using a synthetic UI fixture: [preview](../../sanctuary-mobile/docs/assets/daily-discovery-difficulty-preview.png).

Rejected valid drafts and generation metadata remain in the private attempt audit, separate from the publishable library. Invalid writer output also counts toward the token budget and is retained as generation provenance. Retry feedback includes the rejected draft as untrusted data alongside specific review criticism; it never lowers the evidence or craft thresholds.

## Production source-quality revision

The first production run produced two passing questions but exhausted dates whose devotional passages required abstract interpretation. Source policy v3 prioritizes concrete narrative details: a curated 36-scene source/angle catalogue supplies the initial narrative runway and alternate sources. Narrative devotional references can still align with the day's devotional; poetry and letters are not forced into trivia just to preserve alignment. The source/angle catalogue is planning data, not approved question copy.

Each date precommits at most three source options with exact passage references and SHA-256 hashes. Candidate attempt 1 uses option 1, attempt 2 option 2, and attempt 3 option 3. Both SQL and JavaScript enforce the selected source for that attempt. A rejected draft can therefore move to a better passage without gaining another attempt or lowering the evidence/craft thresholds. Exhaustion still persists, and future cron runs cannot silently reset it.

Apply `20261028234500_discovery_source_options.sql` before deploying this planner. Its rollback restores the previous source selector and full v3 evidence/craft gate. Stored v2 week plans require an explicit operator review/upgrade; retain the original plan as provenance and preserve approved schedules. An exhausted date may be reset only through the existing admin workflow after the source issue is reviewed. No reset is an approval of any question.

Final local validation after this change: 178 backend tests pass, including source selection, SQL rejection of an unplanned source, persisted three-attempt limits, and executable source-options rollback. The hosted proof branch also passed apply/rollback/reapply with unchanged legacy query hashes.

## Writer v4 and explicit operational repairs — October 29

The production rejection audit exposed a prompt defect: the writer received the reviewer's instructions to rate craft and difficulty. Some drafts put grading commentary into the claims shown after answering. Writer `sanctuary-trivia-writer-v4` removes rating tasks from the writer and describes claims as final factual sentences only. Its strict schema requires exactly four choices and one or two claims, at most fourteen words each. The existing 30-word/220-character public copy ceiling and all evidence/craft/difficulty acceptance gates remain unchanged. Draft schema constraints improve formatting; they do not establish factual truth. See [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and the user's [question-writing reference](https://www.triviahalloffame.com/writeq).

A bounded live pilot on three previously exhausted scenes passed all three after nine total attempts. It used the existing production model IDs, not a model upgrade. Six adversarial controls (wrong key, invented location, equivalent alternatives, grading commentary, historical-proof claim and wrong reference) were rejected. Some controls failed deterministic checks; the others exercised both live reviewers. These assistant-defined perturbations are diagnostic probes, not a human-labeled precision study or a measured 95% guarantee. Exact responses and rejected attempts are retained under `content/discoveries/experiments/sanctuary-writer-v4-*`.

`node scripts/discoveries/repairSourcePlan.js --project-ref <ref> --actor <global-admin-uuid> --manifest <reviewed-json> --output <new-audit.json>` prepares a read-only repair. Add `--apply` only for an explicitly reviewed operator repair; the cron never invokes this tool. The transaction validates the administrator, locks against a starting generation run, checks exact prior plan/slot state, retains previous source selections in the plan audit, and invokes the existing retry function. It cannot change a scheduled/released date or approve any question. Source replacements must be new for the slot. A `writer_revision` repair can reuse sources only when all three persisted failures name the earlier writer version and the manifest targets the current code policy; current-policy failures cannot be reset using the same repair. SQL rechecks the prior writer audit before committing.

The first six-date narrative repair filled October 31, November 1 and November 7. November 2–4 remained exhausted; their failed drafts revealed the writer-contract defect above. The original manifest, exact old/new plans, epochs and applied receipt are in `content/discoveries/source-repairs/2026-10-29*`. No failure was promoted to an approval and no old attempt was removed.

### Reviewer pair v2 and catalogue expansion

The first verifier is now `gpt-6.1-sol`; the independent `gpt-6-astra` review, writer model, 95-point floor and 6/8 craft gate are unchanged. The provider inventory confirmed availability, and the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) confirms Responses and Structured Outputs support. Live diagnostic checks rejected all six adversarial controls; two of three previously passing drafts passed recheck, while one was rejected at 5/8 craft. This is a small diagnostic evaluation, not a human-labeled calibration or a measured accuracy claim. Exact verdicts are in `experiments/sanctuary-strong-verifier-*`. Existing approvals retain their original model provenance.

A `reviewer_revision` operator repair requires three recorded rejections from the named prior pair and the current writer. It can target only the different pair matching the current code configuration, and SQL rechecks the generation-run model audit before resetting that one exhausted slot. Failures from the new pair cannot be reset with the same manifest. No cron performs this repair automatically.

The versioned narrative catalogue now contains 54 scene/angle pairs. The extra alternatives use passages already inspected during the explicit source repair. New week plans record the catalogue version; existing plans keep their precommitted source selections. This expands variety for future generation without rewriting accepted questions or silently changing stored plans.
