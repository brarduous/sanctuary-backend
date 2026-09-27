# Devotional Curriculum Evaluation and Prompt Action Items

Date: September 27, 2026  
Status: Editorial and implementation recommendation  
Scope: `devotional_syllabus_generator`, `general_devotional_generator`, the single-day fallback prompt, and `daily_devotional_generator`

## Executive decision

Keep themed weeks, but stop treating a theme as a sentence to restate seven times. A week should be a **seven-day formation journey** in which each day has a distinct question, biblical text, human situation, spiritual movement, and practice.

The current approach should not continue unchanged. The theme itself is not the primary problem; the problem is that the curriculum contains too little day-level intent and the production path normally generates each day in isolation. This reliably produces synonymous titles, repeated claims, interchangeable applications, and occasional misuse of passages to support the weekly idea.

Titles should expose the day's distinctive value. A reader should be able to scan all seven titles and understand the progression without seeing the weekly theme label. Repeating the theme word in every title is not evidence of coherence.

## Evidence from the current curriculum

The review covered 196 published general devotionals through September 27, 2026, 202 completed personalized devotionals, the 52 stored curriculum themes, and generated content already scheduled through October 25.

Recent weeks show the pattern clearly:

- **Christian Liberty:** “Embracing Our Freedom,” “Living in the Freedom of Christ,” and two uses of “Embracing True Freedom.”
- **The Lord's Supper:** four uses of “In Remembrance of Him” and two uses of “The Bread of Life.”
- **Evangelism:** two “Called to Go” titles and two “Sharing the Good News” titles.
- **Christian Identity:** two “Identity in Christ” titles, followed by other titles that continue to restate identity language.
- **Integrity:** three uses of “The Path of Integrity”; most days repeat that integrity means aligning actions and values.
- **Compassion:** three uses of “A Heart of Compassion”; the Good Samaritan is repeatedly imported into passages that are not the Good Samaritan text.
- **Stewardship:** five titles center on God's ownership or sovereignty, with little visible day-to-day progression.

The title repetition is a symptom. Even unique titles frequently contain synonymous abstractions—*embracing, living, walking, heart, path, gift, strength,* and *calling*—that conceal how one day differs from the next.

## Root causes

### 1. Production usually bypasses the weekly planning instruction

`GENERAL_DEVOTIONAL_BATCH_MODE` defaults to false. In this mode, seven devotionals are generated through seven independent calls. The weekly batch prompt says to plan distinct movements such as notice, trust, lament, receive, practice, share, and rest, but the normal single-day path never receives that plan.

The single-day generator knows only:

- the broad weekly theme;
- the focus Scripture area;
- the numeric day within the week; and
- Scripture references already used.

It does not know previous titles, claims, human situations, practices, metaphors, or pastoral movements. Preventing duplicate references therefore does not prevent duplicate devotionals.

### 2. The syllabus schema is too thin

Each curriculum row contains only `week_number`, `theme_title`, and `scripture_focus`. Broad themes such as *Integrity*, *Compassion*, or *Patience* cannot by themselves define seven meaningfully different outcomes.

The syllabus prompt asks for balance and the “whole counsel of God” but does not define a coverage model, progression, audience needs, doctrinal boundaries, liturgical timing, or what makes neighboring weeks distinct. It cannot reliably verify its own claim of balance.

### 3. Coherence is confused with repetition

The prompts require every day to develop the same theme but do not clearly distinguish:

- a shared weekly destination;
- a distinct daily contribution; and
- prohibited restatement of an idea already covered.

Models consequently demonstrate thematic compliance by repeating the theme noun, its synonyms, and the same application.

### 4. Titles have no differentiation contract

“Clear, specific title” is insufficient. There is no requirement that titles be unique within the week, reveal the day's particular tension or practice, avoid the weekly theme word, or differ from recent titles.

### 5. Validation checks shape, not editorial quality

Runtime validation currently checks required fields, seven offsets, and distinct Scripture references. It does not reject:

- duplicate or near-duplicate titles;
- repeated central claims;
- repeated practices;
- contextually unsupported interpretations;
- vague actions such as “reflect,” “embrace,” or “remember”; or
- seven days that lack a discernible arc.

### 6. Seasonal and annual structure are unstable

“Advent: Prophecy Fulfilled” is fixed at week 48, but the 52-week cycle advances by usage and can start or reset independently of calendar dates. A seasonal week can therefore be delivered outside its season. Reusing the same 52 rows annually also repeats the entire curriculum without versioning or a planned multi-year Scripture cycle.

## Recommended curriculum model

Use a two-level structure:

1. **Annual curriculum map:** establishes coverage, seasonal dates, theological balance, canonical breadth, and progression across the year.
2. **Weekly formation plan:** establishes the seven distinct days before any devotional prose is written.

The weekly theme should answer: **What transformation is this week seeking?** Each day should answer: **What unique step does today contribute?**

A useful seven-day arc is flexible but explicit:

1. **Encounter:** see what the anchor passage reveals about God.
2. **Expose:** recognize a human tension, false refuge, or resistance.
3. **Lament or confess:** bring the honest difficulty to God.
4. **Receive:** attend to grace, promise, identity, or provision.
5. **Practice:** embody the truth in an ordinary decision.
6. **With others:** serve, reconcile, encourage, or pray with someone.
7. **Integrate:** review, rest, worship, or make a continuing commitment.

Not every theme needs these exact labels. The nonnegotiable requirement is seven different contributions to one coherent destination.

## Required curriculum data

Expand each week from a topic row into a plan with at least:

```json
{
  "curriculum_version": "2027-v1",
  "week_number": 1,
  "date_window": { "starts_on": "2027-01-04", "ends_on": "2027-01-10" },
  "season": "ordinary_time",
  "theme_title": "Trusting God When the Way Is Unclear",
  "formation_goal": "Move from demanding certainty to taking one faithful next step with God.",
  "anchor_passage": "Proverbs 3:5-6",
  "pastoral_need": "Decision fatigue and the desire to control outcomes",
  "theological_claim": "God's trustworthy wisdom, not our complete understanding, grounds faithful action.",
  "guardrails": ["Do not equate trust with passivity", "Do not promise a clear or painless outcome"],
  "days": [
    {
      "day": 1,
      "movement": "encounter",
      "daily_angle": "The character of the One we trust",
      "human_situation": "Facing a decision without enough certainty",
      "scripture_reference": "Proverbs 3:5-6",
      "practice_type": "attention",
      "practice_brief": "Name what you know about God's character before listing possible outcomes",
      "title_direction": "Trust Begins With Who God Is",
      "share_mode": "none"
    }
  ]
}
```

Store the seven-day plan or pass it intact to every generation call. Do not ask the prose generator to invent the curriculum and write polished content simultaneously.

## Prompt action items

### P0 — Correct the execution architecture

- [ ] Add a required weekly planning call that produces all seven day briefs before prose generation.
- [ ] Persist the plan with a curriculum version and week identifier, or pass the complete plan into every daily generation call.
- [ ] If generating days separately, provide the selected day brief plus compact summaries of all six other day briefs and all already-generated titles, claims, practices, and references.
- [ ] Do not rely on the existing single-day fallback as a quality-equivalent path. Either make the planned single-day path the primary architecture or enable batch generation and retain the plan during fallback.
- [ ] Separate `anchor_passage` from `scripture_focus` commentary. A Scripture reference and an editorial description should not share one unstructured field.

### P0 — Replace the syllabus prompt

The revised `devotional_syllabus_generator` should require:

- a dated and versioned annual plan rather than an endlessly recycled sequence;
- explicit Advent, Christmas, Lent, Holy Week, Easter, and Pentecost placement when the chosen tradition supports them;
- a declared ecumenical posture and flags for topics requiring denominational review;
- balanced biblical genres, Testaments, doctrines, practices, life situations, and emotional registers;
- a formation goal, pastoral need, theological claim, guardrails, and seven day briefs for every week;
- distance checks against adjacent and recent weeks; and
- a self-audit matrix demonstrating coverage instead of merely claiming “whole counsel of God.”

Suggested core instruction:

> Design a dated 52-week Christian formation curriculum, not a list of 52 religious topics. Every week must pursue one clear formation goal through seven non-interchangeable daily steps. A day is non-interchangeable when removing it leaves a visible gap in the week's progression. Do not use seven synonyms or seven supporting verses to restate one thesis.

The output should include a `coverage_audit` summarizing canonical range, doctrine, Christian practices, relationships, vocation, suffering, justice and mercy, mission, celebration, lament, and church seasons.

### P0 — Add a weekly planner prompt

Create a dedicated prompt between the annual syllabus and devotional writer. It should:

- interpret the week's anchor passage before choosing supporting texts;
- assign a distinct movement, daily angle, human situation, practice type, and share mode to each day;
- require title directions that remain understandable without the weekly theme label;
- prohibit two days from making the same central claim;
- prohibit repeated practice verbs unless the actions are materially different;
- use supporting passages for what they actually say rather than recruiting them as slogans for the theme;
- identify interpretive risks for each selected passage; and
- return planning data only, not polished devotional prose.

Add this test to the prompt:

> Read only the seven titles, human situations, and practices. If any two days appear to deliver the same benefit, revise the plan before returning it.

### P0 — Strengthen the general devotional prompt

For each daily brief, require the writer to:

- follow that day's assigned contribution without summarizing the entire weekly theme;
- lead with the day's human situation or biblical discovery, not the theme noun;
- explain the selected passage's actual contribution in context;
- include one useful pastoral distinction, correction, or insight;
- end with one observable practice containing an action, setting or recipient, and time boundary;
- make social action natural rather than append “share this with a friend”; and
- avoid claims, metaphors, opening patterns, titles, and practices already used elsewhere in the week.

Suggested title contract:

> Write a 4–9 word title that reveals today's distinctive tension, discovery, or action. It must make sense without the weekly theme shown beside it. Do not begin with “Embracing,” “Walking in,” “The Heart of,” “The Path of,” “Living in,” or “The Gift of.” Do not repeat the weekly theme word unless it is necessary for clarity. It must not be semantically equivalent to another title in this week or the recent-title list.

Suggested practice contract:

> End with one action that can be verified as completed today. Include what to do, when or where to do it, and—when relational—who is involved. “Reflect,” “consider,” “embrace,” “remember,” and “let this inspire you” do not count as actions unless paired with a visible behavior such as writing, speaking, scheduling, giving, asking, listening, or serving.

### P0 — Strengthen biblical-context safeguards

- [ ] Require a one-sentence internal interpretation note: speaker, audience, literary setting, and the passage's relevant claim.
- [ ] Instruct the model not to import a different biblical story unless it explicitly identifies the connection and the connection adds necessary value.
- [ ] Reject content that attributes language or concepts to the selected passage when they come from another passage.
- [ ] Add theological review for sensitive weeks such as suffering, spiritual warfare, family roles, purity, church leadership, mental distress, and divine guidance.

### P1 — Improve the personal devotional prompt

Personalization currently preserves the curriculum's exact title. That will work only after daily titles become specific. Until then, it reproduces generic curriculum language in every personalized devotional.

- [ ] Preserve the daily theological claim and passage, but allow a carefully constrained subtitle or application line when it makes value clearer.
- [ ] Pass the daily brief's `human_situation`, `practice_type`, and guardrails into personalization.
- [ ] Prevent profile inputs from being enumerated mechanically. Older devotionals repeatedly mention several unrelated concerns in one piece, producing an uncanny rather than pastoral voice.
- [ ] Select one relevant application context per day; ignore other profile concerns unless essential.
- [ ] Keep the concrete practice intact during personalization rather than replacing it with generic encouragement.

### P1 — Design for sharing rather than merely adding share language

Assign one of these modes during weekly planning:

- `none`: the day is appropriately private;
- `send`: a concise truth is suited to a particular person;
- `discuss`: one honest question invites conversation;
- `do_together`: two people can complete the practice;
- `serve`: the response directly benefits another person;
- `church`: the next step belongs in embodied Christian community.

At least two days per week should naturally move beyond solitary consumption, but not every day should contain a forced sharing request. Short-form slides should preserve the day's distinctive insight and practice, not reduce it back to the broad theme.

### P1 — Add automated editorial validation

Reject or regenerate a week when any of the following occurs:

- exact duplicate titles;
- high semantic similarity between titles or central claims;
- repeated opening templates on more than two days;
- fewer than six distinct practice types;
- fewer than five observable practices;
- more than two endings led only by reflection verbs;
- duplicate Scripture references within the week;
- reuse of a primary reference inside the configured recent-content window;
- a title that fails to communicate the distinct day angle;
- a contextual claim unsupported by the selected passage; or
- slide copy that exceeds limits or loses the devotional's distinctive value.

Use deterministic checks for lengths, duplicates, banned title openings, references, and action verbs. Use a separate model-based critic for semantic overlap, contextual faithfulness, pastoral voice, and practical value. The critic should see the entire week, not isolated entries.

### P1 — Version and schedule the curriculum

- [ ] Replace `is_used` as the primary scheduling model with curriculum version, planned date window, publication state, and generation state.
- [ ] Do not reset all themes automatically after week 52.
- [ ] Generate and review the next annual version before activation.
- [ ] Support fixed-date and movable church seasons explicitly.
- [ ] Maintain a rolling cross-year history of titles, passages, claims, and practices.

### P2 — Establish a human editorial loop

- [ ] Review the annual map before any prose is generated.
- [ ] Review four representative weekly plans: doctrinal, practical, suffering/lament, and seasonal.
- [ ] Sample at least one generated week per month for theological accuracy and pastoral usefulness.
- [ ] Record rejection reasons in structured fields so prompt changes respond to real failure patterns.
- [ ] Allow a pastor or theological editor to lock passages, claims, or practices before generation.

## Proposed quality rubric

Score every week and each devotional from 1–5.

### Weekly curriculum

1. **Arc:** the seven days visibly progress rather than repeat.
2. **Differentiation:** every day has a unique benefit, title, situation, and practice.
3. **Biblical integrity:** texts are interpreted in context and contribute distinct truths.
4. **Formation value:** the week moves from understanding toward embodied faith.
5. **Pastoral range:** the week includes honest tension and does not force easy resolution.
6. **Community movement:** relational or church-oriented responses arise naturally.

### Individual devotional

1. **Immediate value:** the title and opening make today's benefit clear.
2. **Pastoral trust:** the voice is wise, specific, humble, and theologically responsible.
3. **Practicality:** the reader can complete the practice today.
4. **Distinctiveness:** it could not be swapped with another day in the week.
5. **Share impulse:** it gives a reader a natural reason to involve another person.

## Release gates

Do not publish a generated week unless:

- all weekly rubric dimensions average at least 4.0/5;
- no individual devotional scores below 3 on biblical integrity or pastoral trust;
- all seven titles pass the scan test and no two are near-duplicates;
- at least five practices are observable and same-day;
- at least two practices naturally involve another person or embodied community;
- all seven passages pass contextual review;
- no recent-title or recent-passage rule is violated; and
- a human reviewer approves the first four weeks produced by any materially revised prompt.

## Recommended implementation order

1. **Stop unplanned isolated generation.** Introduce the weekly plan and pass it to every day.
2. **Patch title, practice, and biblical-context contracts.** These address the most visible quality failures.
3. **Add whole-week validation and regeneration.** Do not evaluate days independently.
4. **Redesign and version the annual syllabus.** Correct seasonal drift and improve coverage.
5. **Update personalization to consume the richer daily brief.** Preserve specificity instead of restating profile concerns.
6. **Pilot four weeks and compare against the current system.** Use blinded pastoral review plus reader comprehension, completion, save, and share behavior.

## Pilot success measures

For the first four revised weeks, target:

- 0 duplicate or semantically redundant titles;
- 0 unsupported Scripture-context claims;
- at least 80% of readers able to identify the day's intended action in a comprehension check;
- at least 80% of devotionals containing a concrete same-day practice;
- at least 50% of devotionals containing a natural relational or embodied dimension;
- improved completion, save, and share rates compared with matched current weeks; and
- blinded pastoral reviewers preferring the revised week on coherence, trust, and usefulness in at least 75% of comparisons.

Themed weeks should remain only if this redesigned process demonstrates that a seven-day arc improves formation and retention over independent daily devotionals. The pilot should include an unthemed or lightly themed comparison group so the curriculum decision is based on reader outcomes rather than editorial intuition alone.
