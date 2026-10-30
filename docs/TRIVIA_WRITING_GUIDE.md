# Write a question someone would enjoy sharing

> Current release standard: **Trivia**, three daily questions in Easy → Medium → Hard order, three spoiler-free squares, and **Share your Results**. See [the execution plan](TRIVIA_EXECUTION_PLAN.md) for actual release status. Weekly and catch-up generation use the same gates as launch content.

Audience: late teens and young adults, including people new to church. A question must be true, clear, fair **and worth playing**. Source verification does not establish that last property.

## Why October 30's question failed

“In Mark’s account, the man saw unclearly at first; what happened after Jesus laid hands on his eyes again?” asks for an expected successful outcome. The wordy sequence consumes attention without creating curiosity. “Saw everyone clearly” is easy to infer from the setup; alternatives such as losing sight again feel manufactured. Its explanation repeats the recovery before mentioning a separate instruction.

The earlier automated craft score of 6/8 was not evidence of audience appeal. Our rubric rewarded an “interesting consequence” too loosely and did not force reviewers to distinguish a wrong alternative from a believable one. The second-clue preference also encouraged unnecessary clauses.

The stronger knowledge target in this passage is its unusual visual image: the man describes people as trees walking. That is specific enough to remember and tell someone else. It still needs accurate framing and good alternatives.

Illustrative edit: **“In Mark, a man regaining his sight compared people to what?”** Choices: Trees / Statues / Shadows / Scarecrows. The reveal can describe the walking-tree image, followed by the second touch and clear sight. Both blinded reviewers accepted this edited example (craft 6/8 and 7/8; evidence 100). It is a proposed style example, not a claim of audience approval or a scheduled replacement. [Review evidence](qa/2026-10-30-audience/trivia-edited-example.json).

## Editorial workflow

1. **Find the discovery.** Read the whole saved passage. Identify one distinctive fact: an image, object, unexpected action, or contrast. State privately what makes it worth telling a friend. Discard ideas whose only attraction is their obscurity or religious importance.
2. **Choose the answer.** Establish one exact answer and its source before writing the question. Check whether another answer could reasonably fit.
3. **Ask naturally.** Write one direct question someone can understand after hearing it once. Identify the person or situation. Include necessary scope, without a forced second clue or compressed chronology. Keep our existing mobile copy limits.
4. **Try guessing without knowing.** Hide the passage. Can the setup and everyday expectations identify the key? A healing followed by recovery, surrounded by three failures, often fails this test. An easy distinctive fact is welcome; an inevitable answer is not.
5. **Build credible alternatives.** Use the same category and grammatical structure. Explain privately why a player might consider each wrong choice. Absence from the passage is not that explanation. If three credible alternatives cannot be found, change the fact being tested.
6. **Reward the reveal.** Add one brief, directly supported discovery beyond the key. Avoid repeating the question, moralizing, or inventing a modern application.
7. **Review independently.** Solve blind, verify every premise and option, then judge craft separately. A zero for interest, fairness, or alternatives rejects the item regardless of factual confidence. Record feedback and retain rejected attempts.

Youth appeal means understandable situations, vivid details, and satisfying discoveries. It does not require slang, easier-than-necessary answers, a sermon, or an assumed church upbringing. Model ratings remain editorial signals; actual audience response must be evaluated separately.

## Sources and adaptation

[Trivia Warehouse's writing guide](https://triviawarehouse.com/blogs/trivia-resources/how-to-write-trivia-questions) describes starting with the answer and its source, writing for spoken comprehension, checking ambiguity, and reviewing audience fit. We adapt that editorial sequence to one short Bible question rather than a full pub-quiz packet.

[American College of Surgeons' multiple-choice guidance](https://www.facs.org/for-medical-professionals/education/cme-resources/test-writing/) supports one clear task, one defensible answer, and plausible choices consistent in content, grammar, and length, without answer cues. We use its option-construction principles; our product is a daily curiosity game, so engagement and a memorable reveal are additional requirements.

[ACF's question-writing guidance](https://acf-quizbowl.com/guidelines/packet-sub/#question-writing-philosophy) emphasizes audience-appropriate topics and discourages questions likely to go unanswered. Its long, progressively clued tossup format should not be copied into our 20-second multiple-choice game.

## Current versioned editorial gates

Writer v9 uses the shared editorial guide. For daily-three content, two different models independently solve and verify every premise, claim and option at evidence confidence >=95. Craft requires >=7/8, full marks for fair challenge and no zero dimension. Two separate blinded calls then estimate closed-book difficulty; locating quotations during factual verification is not used as a player-difficulty proxy.

Daily difficulty v2 weights familiarity twice: `2*familiarity + evidenceNavigation + reasoningSteps + distractorSimilarity`, each dimension 0–2. Easy is 0–3, Medium 4–6, Hard 7–10. The two models must agree on the band. These are estimates, not audience-measured success rates. Existing v1 content is neither relabeled nor silently regraded.

Two final editors then assess the complete set and rolling week. A useful geographical/relational distinction can earn modest interest without being dramatic; fair Hard questions do not require obscure names or arbitrary counts. Compare the actual questions, choices and reveals across dates: a different target in the same passage still fails if its reveal exposes an earlier answer. Preserve partial-week limits in the audit. Bind approval to full manuscripts and exact published context before atomic publication.

Weekly regression checks include the disliked predictable healing outcome, chronology ambiguity, overlapping choices, lexical fallacies and uncertain geography stated as fact. Never resample an unchanged rejected candidate for a favorable verdict. Revise the specific defect, retain the rejection and run every affected gate again.

## October 30 calibration check

Both actual production reviewer models, using the revised instructions and solving blind, rejected the owner's disliked question: each assigned context 2, interest 0, fair challenge 0, and choice quality 1 (3/8), while retaining factual evidence score 100. [Recorded review](qa/2026-10-30-audience/trivia-editorial-regression.json). This is a regression case derived from owner feedback, not an independent hold-out experiment.

Two writer-v6 samples passed automated gates on their first attempts, but editorial inspection still found weaknesses: the Mark sample used vague visual alternatives, and the Acts sample assumed familiarity with Rhoda and used the fragment “ran in.” These samples are development drafts, not replacements ready for production. The 41 relevant accuracy, batch, and curriculum tests passed; syntax and whitespace checks passed.

Further design work should examine whether the verbatim-answer rule is over-constraining action questions. It currently protects exact source support but can force awkward fragments into answer choices. Any future allowance for paraphrased answers needs explicit evidence checks and a versioned acceptance-policy change; it should not be smuggled into a prompt rewrite.
