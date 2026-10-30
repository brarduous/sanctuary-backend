# Write a question someone would enjoy sharing

> October 30 continuation: the owner now wants **Trivia**, with three daily questions in Easy → Medium → Hard order and three spoiler-free result squares. The [excellence benchmarks](TRIVIA_EXCELLENCE_BENCHMARKS.md), [reference-library design](TRIVIA_REFERENCE_LIBRARY_PLAN.md), and [execution plan](TRIVIA_EXECUTION_PLAN.md) define the next work. The existing prompt changes are prototypes; the benchmark and difficulty calibration are not yet frozen, and no daily three has been published.

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

## Initial editorial draft

The initial writer-v6 draft incorporated this workflow. An experimental writer-v7 daily-set prototype now lives on `feature/daily-trivia-three`; it has not been deployed. `discoveryEditorial.js` supplies shared editorial calibration to the writer and both independent reviewers. Craft v2 retains its JSON shape, 6/8 minimum, and no-zero rule; its descriptions now reward concise sufficient context and explicitly reject predictable outcomes without a distinctive discovery. No database gate, evidence threshold, or historical approval is changed. Prompt hashes preserve the exact instructions used for future attempts.

New draft evaluations are development artifacts. They do not replace scheduled production questions or establish audience preference by themselves.

## October 30 calibration check

Both actual production reviewer models, using the revised instructions and solving blind, rejected the owner's disliked question: each assigned context 2, interest 0, fair challenge 0, and choice quality 1 (3/8), while retaining factual evidence score 100. [Recorded review](qa/2026-10-30-audience/trivia-editorial-regression.json). This is a regression case derived from owner feedback, not an independent hold-out experiment.

Two writer-v6 samples passed automated gates on their first attempts, but editorial inspection still found weaknesses: the Mark sample used vague visual alternatives, and the Acts sample assumed familiarity with Rhoda and used the fragment “ran in.” These samples are development drafts, not replacements ready for production. The 41 relevant accuracy, batch, and curriculum tests passed; syntax and whitespace checks passed.

Further design work should examine whether the verbatim-answer rule is over-constraining action questions. It currently protects exact source support but can force awkward fragments into answer choices. Any future allowance for paraphrased answers needs explicit evidence checks and a versioned acceptance-policy change; it should not be smuggled into a prompt rewrite.
