# Younger-audience content review — October 30, 2026

Audience assumption: late teens through young adults, including people new to church. Relatability comes from recognizable situations, plain language, useful next steps, and curiosity. Do not assume everyone attends college, has a safe family, works predictable hours, or shares the same income or relationship circumstances. Avoid forced slang and generational stereotypes.

## Editorial grades

These are manual **prompt-design grades**, based on the repository's latest prompt definitions and runtime overlays. They are not measured audience engagement, live database grades, or grades of newly generated output. Live Supabase and model credentials were unavailable for this review. Historical SQL definitions may differ from live templates.

Each dimension scores 0–4: absent/harmful, weak, mixed, solid, consistently specific/useful. Dimensions: relatability (R), clarity (C), usefulness (U), shareability (S), integrity (I). A = 18–20, B = 15–17, C = 11–14, D = 7–10, F = 0–6. A serious factual, privacy, or safety failure caps the grade at D. Integrity scores below describe the instructions, not proof that generated content is accurate.

| Content | Before R/C/U/S/I | Before | Revised design R/C/U/S/I | Revised | Main finding |
| --- | --- | --- | --- | --- | --- |
| Devotionals | 2/3/3/3/4 | 15/20 · B | 3/4/4/4/4 | 19/20 · A | Strong contextual formation and slides; missing a defined younger-reader voice and a short, portable central insight. |
| Advice | 2/3/4/2/4 | 15/20 · B | 3/4/4/3/4 | 18/20 · A | Three actionable steps and care guardrails already exist; no step word budget or instruction to offer usable conversation wording. |
| Trivia | 2/4/3/3/4 | 16/20 · B | 3/4/4/3/4 | 18/20 · A | Excellent evidence, brevity, and distractor rules; writer and craft reviewer assume general adult church familiarity. |
| Article news | 2/2/2/1/4 | 11/20 · C | 3/4/4/4/4 | 19/20 · A | Base prompt asks for a thorough synopsis; runtime overlay adds 2–4 outlook paragraphs; mobile shares the full outlook. |
| Daily news brief | 1/1/2/1/3 | 8/20 · D | 3/4/4/4/4 | 19/20 · A | Base prompt asks for a comprehensive podcast/video script, conflicting with a quick mobile summary. |

Before evidence: `supabase/migrations/20260920120000_devotional_research_playbooks.sql`, `20260927180000_devotional_curriculum_planning.sql`, `prompts.js` quality overlays, `cron/generateGeneralDevotionals.js`, `scripts/sql/2026-05-25-sanctuary-news-thought-to-remember.sql`, and trivia writer v4 / craft v1 in `utils/discoveryModels.js` and `utils/discoveryQuestionCraft.js`. Revised design scores reflect explicit new instructions; usefulness with real readers remains untested. A relatability score of 3 deliberately leaves room for feedback from the intended audience.

## Changes implemented

The versioned `utils/audienceContentPolicy.js` supplies the final voice and copy requirements after database templates. Earlier voice/length instructions yield to it; JSON contracts, Scripture fidelity, private context, and safety/evidence requirements remain in force. A backend release applies the copy policy without rewriting production database prompts. Trivia's database acceptance function requires the compatibility migration described below before backend release.

- Devotionals: 120–160 words in short paragraphs; a contextual insight of at most 16 words; one observable same-day practice. Preserve the assigned title, verse, claim, and practice. A first move should take about two minutes when the practice permits. Story slides now target 6–12, 15–25, and 10–25 words, with a concrete action on the final slide. Both database-backed generation and the separate weekly planner/day writer use the policy.
- Advice: exactly three action strings, normally 15–35 words each; a useful now/next/support sequence when fitting; wording someone can actually say or text. Safety instructions can exceed these targets. Keep the existing professional-help and growth-consent guidance.
- Trivia: writer v5 and craft rubric v2 reward accessible scenes, source-supported human stakes, and a satisfying reveal. Retain the 22-word/140-character maximum, four parallel choices, independently solved answer, two reviewers, existing craft threshold, and minimum evidence score. Modern scenarios and imagined motives are prohibited. Existing approved questions are not rewritten or reapproved by this change.
- News: identical `synopsis` and `newsSummary`, normally 35–60 words; a factual headline; an 8–18 word original reflection; an 80–120 word, two-paragraph outlook. Preserve attribution and essential uncertainty even if that requires exceeding length targets. Keep verification metadata intact.
- Daily news: up to three distinct nuggets, 60–100 words total, with blank lines between stories and fewer words for sparse input. No opening monologue or mood-of-the-world commentary. Parse serialized outlooks and prefer factual summaries over raw article bodies. Reject malformed or prayer-only model responses instead of storing an incomplete brief.
- Topic/category briefs: 30–50 words in two short sentences, applied in both the standard generator and the direct refresh script.
- Mobile sharing: news shares summary + labeled reflection + original source link; devotional sharing offers a quick three-slide takeaway and full text; advice shares steps and the reading reference without automatically appending the private situation, acknowledgment, or growth suggestion. No client-side truncation of factual sentences.

## Illustrative copy

These are editorial examples, not model evaluation results. The news example is fictional.

Devotional insight, grounded in James 1:19: “Listening can be your first act of love in a tense conversation.” Practice: “Before your next reply, ask, ‘What did you mean by that?’ Then let them finish.” Keep the actual passage's meaning and the planned practice authoritative.

Advice step for an ordinary, non-dangerous disagreement: “Before replying, write the one thing you need clarified. Try: ‘Can we talk tomorrow? I want to understand what happened.’” This is an example of specificity, not a prescription for an unsafe relationship.

Trivia question, grounded in Luke 19:1–5: “In Luke's account, Zacchaeus can't see past the crowd. What does he climb?” Choices should use the corpus's exact supported key and three plausible, parallel alternatives. Never approve this illustration without the normal source and reviewer gates.

Fictional news nugget: “The city council proposed extending evening bus service on two routes. A vote is scheduled for next month. The proposal would add later trips if approved; fares and a start date have not been announced.” The proposal status and unknowns belong in shared copy too.

## Evaluation and release

`npm run evaluate-prompts` now grades the composed runtime prompts for devotionals, advice, article news, and daily news using the five-dimension rubric. Devotional evaluation includes story slides; daily-news evaluation includes the thought and prayer and uses the actual `daily_news_synopses` table. Personalized prompt evaluation uses labeled curriculum placeholders rather than exposing private profile notes. Existing samples can predate the new policy, so output grades must be distinguished from prompt grades. Running this command requires database/model credentials and writes evaluations using its existing behavior.

Trivia remains in its own source-verification and craft-review pipeline. Use `npm run draft:discoveries -- --live ...` only with a reviewed source plan and bounded generation settings to assess new writer-v5 drafts; it creates unpublished local candidates and audits. It does not establish audience appeal. Older in-progress draft audits require their original policy or a new output path because writer/reviewer prompt hashes changed.

Before releasing the backend, apply `supabase/migrations/20261030120000_discovery_audience_craft.sql` through the existing reviewed database rollout. It accepts craft v1 and v2 during rolling deployment, records the version actually used in each approval attestation, and retains all evidence and craft-score thresholds. It does not reapprove or rewrite existing content. A guarded rollback is in `supabase/rollbacks/20261030120000.sql`; restore the older backend before narrowing acceptance to v1. Both scripts reject an unexpected function definition rather than guessing how to patch it.

Offline verification covers effective prompt composition against deliberately stale templates, weekly devotional generation, factual brief input/response handling, trivia accuracy and retry gates, isolated PostgreSQL compatibility/rollback, mobile share formatting, and TypeScript compatibility. No live generation, production regeneration, hosted database mutation, deployment, or measured youth-user testing is included. Existing saved devotionals, trivia, and article summaries keep their current wording; new copy applies after release when content is next generated. Mobile share changes require a mobile release.

Validation completed: backend `npm test` passed all 189 tests; backend `npm run typecheck` and syntax checks of the changed cron/scripts passed. In `sanctuary-mobile`, `npm run test:content-share` passed 3 tests, `npm run test:discoveries` passed 14 tests, and `npm run typecheck` passed. Both repositories passed `git diff --check`.

The prompt structure uses explicit instructions and examples, consistent with the [OpenAI Docs prompt-engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering#message-formatting-with-markdown-and-xml). Effectiveness should be assessed separately with fresh generated samples and feedback from intended readers.
