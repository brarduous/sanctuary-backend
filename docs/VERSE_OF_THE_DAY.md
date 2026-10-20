# Verse of the Day Selection

Choose a short, memorable featured verse during weekly planning. Develop the devotional with its context and explicitly cited supporting passages, preserving its existing length, pastoral depth, formation arc, and concrete practice.

## October 2026 research

Reviewed October 20, 2026. These are observed samples, not the services’ published selection policies.

| Service | Sample | Observed selections |
| --- | --- | --- |
| [Bible Gateway](https://www.biblegateway.com/learn/bible-verses/verse-of-the-day-october/) | October 1–31 calendar | 21 single verses and 10 adjacent two-verse selections |
| YouVersion Bible App | [October 1–6](https://www.bible.com/verse-of-the-day?day=279), [7–13](https://www.bible.com/verse-of-the-day?day=286), [14–20](https://www.bible.com/verse-of-the-day?day=293) | All 20 October selections are single verses |
| [DailyVerses](https://dailyverses.net/2026/10) | October 1–20 | All 20 published selections are single verses |

The common pattern is a single verse, with short pairs also established at Bible Gateway. YouVersion places its featured quotation beside links to the full reading, related video, and devotional plans. Depth can come after the featured verse.

## Sanctuary selection rules

- Normally feature one complete verse. At least five days per week must use single verses; at most two days may use two short adjacent verses from one chapter.
- Target 10–30 words, with a hard maximum of 40 words and 300 characters in the planned quotation. These are Sanctuary editorial limits informed by the sample.
- Choose another reference when the complete quotation is too long. Never crop, paraphrase, omit clauses, stitch fragments together, or use ellipses to fit.
- Preserve biblical breadth, contextual meaning, lament, hope, instruction, repentance, and challenge.
- Keep weekly anchors broad when useful. Each day may include up to two contextual supporting readings, cited explicitly in the reflection without expanding the featured reference.

For example, Psalm 23:1 can be the featured verse while Psalm 23:1–6 informs the devotional’s fuller setting.

## Implementation and rollout

The weekly planner validates reference shape, quotation length, and the single-verse majority before writing. The daily writer preserves that quotation, and final weekly validation repeats the checks. Failed attempts receive the validation reason. The old 240-character clipping is removed. Supporting readings stay in week-plan JSON and the devotional body, so clients need no schema change.

Personalization preserves the featured reference in server code. New week plans use `weekly-formation-v3-short-verse`. The mobile card renders the entire reference from its local Bible; some web surfaces display `scripture_text`. Narrowing the reference is therefore essential. Automated checks do not independently verify quotation fidelity, interpretation, or length in every translation; editorial review should check these.

`scripts/refreshScheduledDevotionals.js` refreshes already-scheduled future dates while retaining existing week boundaries and themes. It prepares and validates the entire window before writes, preserves row IDs, verifies revision archives and readback, and retains published day briefs in partially elapsed weeks. It requires `DEVOTIONAL_REFRESH_CONFIRM` set to the current New York date. Production rollout preserves today and prior history.
