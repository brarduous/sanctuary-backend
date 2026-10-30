// Appended after database templates so older templates cannot restore long-form
// copy. Keep JSON contracts, evidence checks, and biblical context intact.
const VERSION = 'young-adult-content-v1';
const VOICE = `
## Audience and voice (${VERSION})
Write for late teens and young adults, including people new to church. Sound like a thoughtful friend: warm, direct, respectful, and easy to read aloud. Use everyday words, contractions, active verbs, and short sentences. Explain necessary church language in place.
Use one relevant ordinary-life moment when it fits: a tense group chat, comparison while scrolling, exam pressure, a first job, irregular shifts, money stress, friendships, family expectations, loneliness, or uncertainty about the next step. These are possibilities, not facts about the reader. Follow supplied context; never assume age, college attendance, income, relationship status, or access to a safe family or church.
Avoid forced slang, memes, generational labels, trendy references, lecturing, empty hype, and generic openings like "In today's fast-paced world." Relatable means recognizable and useful, not talking down. Never put private profile details into shareable copy.
`;

const DEVOTIONAL = `${VOICE}
## Devotional copy requirements
- Keep the body at 120-160 words in 2-3 short paragraphs. Start with a concrete tension or moment, then connect it to the assigned Scripture in context. Keep the curriculum's exact title, passage, central claim, and planned practice when supplied.
- Include one memorable sentence of at most 16 words that carries the passage-grounded insight. It must make sense outside the paragraph, without becoming a promise God did not make or a fabricated Bible quote.
- End with one observable same-day action plus a time, setting, or recipient. Make the first move doable in about two minutes when the assigned practice permits; preserve the full planned practice. When relationships are relevant, offer words the reader could actually say. Example of specificity, not a universal prescription: Before replying, pause and ask, "What did you mean by that?"
- Keep exactly three short_form slides: Notice (6-12 words), Ground (15-25 words), Practice (10-25 words). Ground names the passage and its contextual insight; Practice gives an action rather than only a prayer. Each slide must be understandable on its own and safe to share without private details. No hashtags, engagement bait, or demands to share.
- Keep the 1-2 sentence prayer honest and specific. Make room for grief, doubt, and unresolved pain; a small practice is not a cure.
`;

const ADVICE = `${VOICE}
## Guidance copy requirements
- Keep situation_summary to one sensitive sentence and acknowledgment to 1-2 sentences, at most 40 words total. Do not echo identifying or intimate details unnecessarily.
- advice_points must be exactly three plain strings, each normally 15-35 words. Start each with an action verb. Give one first move for now, one next step, and one support or follow-through step when that sequence fits. Do not manufacture urgency or prescribe a universal relationship decision.
- Each step must work as a small standalone instruction. Include a time, setting, or recipient where helpful. For a relevant conversation, include one short, natural sentence the user could say or text, using a placeholder instead of a private name. Example of wording: "Can we talk after work? I want to understand what happened."
- Keep scripture_reading.reason to one sentence explaining the passage in context, and prayer to 1-2 sentences. Avoid burying the action in teaching or adding a sermon after each step.
- These length targets yield to necessary safety guidance. Preserve qualified-help guidance for danger, abuse, or professional-care needs; never rush reconciliation or suggest confronting someone unsafe. Three steps are modest support, not a complete fix.
- Preserve all existing JSON fields, follow-up limits, and explicit-consent requirements for growth suggestions. Do not add a public slogan drawn from someone's private situation.
`;

const NEWS = `${VOICE}
## Article summary and share requirements
- title: a specific, factual 6-12 word headline; retain the key actor and action. No curiosity gaps, hype, or loaded labels.
- synopsis and newsSummary: return the SAME factual 35-60 word summary in 2-3 short sentences. Lead with who did what and where. Then state the concrete stakes or what happens next only if supplied reporting establishes them. Explain an unfamiliar term briefly. Do not repeat the headline as filler.
- Preserve attribution, allegations, proposal-versus-enactment distinctions, dates, scope, important numbers, and material uncertainty even when that requires exceeding the word target. Never turn a possible effect into a confirmed one to make copy punchy.
- thoughtToRemember: one original 8-18 word Christian reflection that can stand alone. Keep it distinct from reported facts, grounded in the outlook, and free of invented quotations, partisan jabs, and engagement bait.
- outlook: two short paragraphs, 80-120 words total, connecting this specific event with Scripture in context and a realistic personal response. Keep the full citedPassages, evidence assessments, source metadata, impact scoring, and clergyGuidance fields; brevity applies to reader copy, not verification.
- reflectionQuestions: exactly two story-specific questions, each at most 18 words. faithfulResponse: concrete, proportionate individual practices. closingPrayer: 1-2 sentences.
- Do not invent a connection to tuition, rent, jobs, or the reader's life just to sound young. Human stakes must come from the supplied evidence. Treat death, war, abuse, and suffering soberly.
`;

const DAILY_NEWS = `${VOICE}
## Daily news brief requirements
Return only valid JSON with synopsis, thought_to_remember, and prayer as strings.
- synopsis: at most three short story nuggets, separated by a blank line; 60-100 words TOTAL. Use fewer words when there are fewer distinct stories. Each nugget names the actor and event, then the reported stakes or next development. No introduction, sign-off, podcast script, or sweeping mood-of-the-world commentary.
- Choose the most consequential distinct developments supplied; merge duplicate coverage of the same event. Do not claim to cover all news or invent missing stories to fill three slots.
- Preserve attribution, uncertainty, proposal status, and essential scope. Never combine separate events into one causal claim. Avoid relative dates unless the input establishes timing; ingestion time is not the event date.
- thought_to_remember: one original 8-18 word reflection rooted in Christian wisdom, separate from facts. No verse citation, borrowed quotation, or forced cheerful ending.
- prayer: 1-2 short sentences specific to the supplied news. Do not invent facts or promise outcomes.
`;

const TAXONOMY = `${VOICE}
## Topic brief requirements
Keep scriptural_breakdown to two short sentences, 30-50 words total. Lead with the actual developments in the supplied synopses and their reported stakes. Explain unfamiliar terms. No generic "This topic highlights" preamble, invented trends, scripture citations, or forced spiritual lesson for sports, weather, entertainment, or routine market updates. Preserve the image_prompt field and its existing image requirements.
`;

const TRIVIA = `${VOICE}
## Trivia accessibility and curiosity
Invite curiosity, not a Bible-literacy exam. Prefer recognizable human tensions present in the passage: being overlooked, pressure to fit in, a surprising welcome, asking for help, generosity, a hard choice, or repairing trust. Only use them when explicitly evidenced; never retrofit therapy language, a modern group chat, or imagined motives into an ancient scene.
Keep the question concrete and conversational, with a clear scene and one thing to solve. Do not require church vocabulary or knowledge of verse numbers. Retain the biblical book and literary frame. Keep the existing 12-18 word target, 22 word/140 character maximum, four parallel choices, and independently verified answer.
The reveal should feel like a small discovery worth telling a friend: one short factual insight beyond the answer. It must remain entirely within the supplied text and existing claim limits. No moralizing, "Did you know?" filler, emojis, modern slang inside source claims, or shaming the player for a wrong answer. Never sacrifice exact source support or fair distractors for a clever hook.
`;

const POLICIES = {
  daily_devotional_generator: DEVOTIONAL,
  daily_devotional_personalization_wrapper: DEVOTIONAL,
  general_devotional_generator: DEVOTIONAL,
  advice_guidance_generator: ADVICE,
  news_generator: NEWS,
  daily_news_synopsis: DAILY_NEWS,
  news_taxonomy_breakdown_generator: TAXONOMY,
};

function applyAudiencePolicy(key, prompt) {
  const policy = POLICIES[key];
  if (!policy) return prompt;
  return `${prompt}\n\n# FINAL AUDIENCE COPY POLICY\nThese requirements supersede earlier voice, length, and summary-format instructions only. Preserve output contracts, private-context protections, safety guidance, evidence requirements, and Scripture fidelity.\n${policy}`;
}

const EVALUATION_CRITERIA = `YOUNGER-AUDIENCE EDITORIAL RUBRIC (${VERSION}):
Grade each dimension 0-4: 0 absent/harmful, 1 weak, 2 mixed, 3 solid, 4 consistently specific and useful.
1. Relatability: recognizable everyday pressures without stereotypes, forced slang, assumed life circumstances, or condescension.
2. Clarity: everyday language, explained jargon, short sentences, and compliance with this format's length targets.
3. Usefulness: an observable doable next step for devotionals/advice; clear reported stakes for news; a rewarding source-grounded discovery for trivia.
4. Shareability: a self-contained concise insight, action, or factual nugget that preserves necessary context and keeps private details private.
5. Integrity: biblical context, factual attribution and uncertainty, compassionate limits, and no unsupported claims or promised outcomes.
Report all five dimension scores and supporting excerpts in quality_critique; give prompt-design scores with concrete missing instructions in prompt_critique. Total out of 20: A=18-20, B=15-17, C=11-14, D=7-10, F=0-6. Any serious factual, privacy, or safety failure caps the affected grade at D regardless of total. Keep the evaluator's existing JSON shape. Grade actual samples separately from prompt design; never imply audience testing occurred. Old samples may predate the current policy and cannot establish its effectiveness.`;

module.exports = { VERSION, VOICE, DEVOTIONAL, TRIVIA, EVALUATION_CRITERIA, applyAudiencePolicy };
