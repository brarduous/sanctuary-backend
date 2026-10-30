# Trivia: examples and standards of excellence

Status: professional writing references plus a reviewed original Biblical benchmark, October 30, 2026. Publisher examples remain study material; actual launch publication is recorded separately. The public feature name is **Trivia**.

## What we are trying to make

A player should enjoy the question, have a fair chance to use knowledge or make a connection, and leave with something worth telling a friend. Easy should welcome the player; medium should reward a connection; hard should reward deeper knowledge while remaining clear. Every level deserves a rewarding reveal.

Difficulty, accuracy, and enjoyment are different properties. Model scores are useful editing signals, not measurements of young adults' knowledge or audience appeal. The first live question demonstrated why those distinctions matter.

## Three starting anchors from a professional publisher

These short adaptations point to Water Cooler Trivia's published examples. They are study material; we should write original production questions and independently source the facts. **The working Sanctuary levels below are proposals, not measured difficulty.** The publisher labels the first two examples Easy and the third Hard; adapting to four choices, a timer, and a new audience can change that.

| Working level | Short adaptation and answer | Lesson to transfer |
| --- | --- | --- |
| Easy | In Sedona, which restaurant chain has turquoise arches? **McDonald's.** | Familiar recognition can carry an unusual detail. |
| Medium | Which wireless technology is named for a medieval Danish king? **Bluetooth.** | Connect an everyday object to unexpected history. |
| Hard | Which ten-point English Scrabble letter appears in every country bordering Malawi? **Z.** | Combine geographic knowledge with a second route to the answer. |

Source: [Water Cooler Trivia, Easy #1, Easy #75, Hard #14](https://www.watercoolertrivia.com/trivia-questions/fun-trivia-questions). This illustrates craft; it does not make every question in that collection suitable for our app. The hard example may be too slow for a twenty-second mobile round and needs an audience trial before becoming a timing standard.

## Additional anchors with different strengths

- **Measured easy anchor:** the publisher reports a California airport-code question answered correctly by 98% of at least 500 respondents. It combines an accessible LAX answer with a small naming-history detail. Its yoga-identification question reached 96%. These are results from that publisher's audience and format, not ours. [Published performance report](https://www.watercoolertrivia.com/blog/2020-in-review-1).
- **Useful hard counterexample:** the same report includes a specialist floral-structure terminology item at 3% correct. That is evidence of difficulty, not a standard of enjoyable difficulty for our daily game. We should avoid equating a low success rate with excellence. [Same report](https://www.watercoolertrivia.com/blog/2020-in-review-1).
- **Multiple-choice structure anchor:** NASA/JPL publishes a four-option question about which planet Magellan mapped. The alternatives are comparable planets and the reveal connects a named mission with a remarkable achievement. [JPL Space Trivia, September 26](https://www.jpl.nasa.gov/space-trivia-question/). The publisher provides no player success rate there, so a hard label would be our estimate.
- **Wording precision anchor, original adaptation:** “Which planet takes longer to rotate once than to orbit the Sun?” **Venus.** This wording avoids the ambiguous everyday meaning of “day.” [NASA's rotation/orbit facts](https://science.nasa.gov/venus/venus-facts/). This is our source-backed example, not a claim that NASA published this exact question or its difficulty.
- **Word-history verification anchor:** the Bluetooth SIG documents its name's connection to Harald Bluetooth. That primary source is better support for the factual reveal than another trivia page repeating the story. [Bluetooth SIG](https://www.bluetooth.com/about-us/bluetooth-origin/).

The versioned original benchmark `content/discoveries/editorial-benchmark-v6.json` contains nine positive anchors, three per band, and six negative cases. Its positives cover familiar scenes, objects, occupations, geography and relational distinctions. Lexical/archaeological claims remain negative or research-only until multi-source approval exists.

## Translate the lessons to Biblical trivia

1. Familiarity is welcome. Recognizing an actor or object from a memorable scene can be excellent easy trivia. A clue grounded in prior knowledge is legitimate; a generic healing-success outcome inferred without knowledge is a weak question.
2. The discovery can be in the scene, the answer, or their connection. Do not demand that the isolated answer word be astonishing.
3. A wrong option may come from another passage. Comparable real places, people, or objects can be credible alternatives without appearing in the saved excerpt. Use concordance/lexicon/geography lookups to establish comparability when needed.
4. All four options must answer the same question, at the same level of specificity. No broad category containing the key, aliases competing as separate people, fabricated places, or a second answer made true by surrounding context.
5. Hard should reward a fair distinction or connection. Do not manufacture it with awkward prose, unknown numbers, unannounced translation variants, or remote facts that contribute nothing interesting.
6. Review the entire three-question set for variety, genuinely rising difficulty, repeated answers, and leakage from one question or explanation into another.

## A stable editorial benchmark, not an endlessly moving score

Store each benchmark's ID, source, exact edition/location, authorship and reuse rights, proposed level, answer, rationale, expected acceptance decision, and whether any difficulty rate is actually observed. Preserve rejected examples alongside good ones.

Review the positives and negatives as a group before changing prompts. Keep a separate hold-out group unseen during prompt editing. Run the same candidate once per evaluator version; do not repeatedly resample a rejected review until it passes. If editorial judgment changes, version the rubric, explain the reason, and rerun the full benchmark.

Required negative cases include the original predictable healing outcome, an ambiguous David-versus-Goliath weapon question (a later sword action makes a broad stem ambiguous), invented lexical meanings, uncertain ancient-site identifications presented as certain, an obvious or overlapping choice, and a question that reveals a sibling answer.

## Audience calibration

Proposed initial first-attempt targets, to be tested rather than advertised: Easy 75–90%, Medium 50–70%, Hard 30–45% correct. Four choices already imply 25% random guessing; eliminating options over time changes that baseline. Record pre-elimination versus later answers, skips, timeouts, completion, and whether the reveal felt worth sharing. A small trial gives directional feedback, not statistically settled difficulty.

Aim for an initial 12–20 consenting intended-audience testers across different levels of church familiarity. Seek anonymous per-question clarity/enjoyment feedback and qualitative reasons, without collecting sensitive profile details. Do not recruit or message anyone without the owner's instruction. A targeted owner/editor review can start the process; real-reader recruitment remains a separate dependency.

## What actual reviews establish

The original question failed craft at 3/8 despite evidence confidence 100. The final benchmark preserves that regression and other factual/editorial failures. Positive Easy anchors include David rejecting armor, Noah’s dove and Daniel’s den; Medium anchors include Siloam, Lydia’s purple goods and Malta; Hard anchors include Hushai’s covert role, Judah’s substitution and Lydia’s origin versus meeting place. Full saved inputs, separate closed-book assessments and historical rejected proposals remain in the QA evaluations directory.

A later rolling-week check rejected the Lydia hospitality reveal because it exposed the purple-goods answer from another day. That is a useful distinction: individual quality does not imply a safe weekly bank. The revised reveal and precise riverside location must pass again before publication. Neither automated approval nor a held-out model check constitutes an independent reader study.
