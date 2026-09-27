// cron/generateGeneralDevotionals.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });
const GENERAL_DEVOTIONAL_MODEL = process.env.GENERAL_DEVOTIONAL_MODEL || 'gpt-5-mini';
const DEFAULT_RUNWAY_DAYS = Math.max(7, Number.parseInt(process.env.GENERAL_DEVOTIONAL_RUNWAY_DAYS, 10) || 28);
const DEFAULT_MAX_WEEKS_PER_RUN = Math.max(1, Number.parseInt(process.env.GENERAL_DEVOTIONAL_MAX_WEEKS_PER_RUN, 10) || 2);
const RECENT_CONTENT_DAYS = Math.max(28, Number.parseInt(process.env.GENERAL_DEVOTIONAL_RECENT_CONTENT_DAYS, 10) || 90);
const CURRICULUM_V2_START_DATE = process.env.GENERAL_DEVOTIONAL_CURRICULUM_V2_START_DATE || '2026-09-28';
const CURRICULUM_V2_START_THEME_WEEK = Number.parseInt(process.env.GENERAL_DEVOTIONAL_CURRICULUM_V2_START_THEME_WEEK, 10) || 31;
const CURRICULUM_V2_MARKER = 'curriculum-v2';
const BANNED_TITLE_OPENINGS = ['embracing', 'walking in', 'the heart of', 'the path of', 'living in', 'the gift of'];

const toDateString = (date) => date.toISOString().split('T')[0];

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
};

const getCurriculumStatus = async ({ now = new Date(), minimumRunwayDays = DEFAULT_RUNWAY_DAYS } = {}) => {
  const today = new Date(now);
  const todayString = toDateString(today);
  const runwayTargetString = toDateString(addDays(today, minimumRunwayDays));

  const [{ data: rows, error }, { count: unusedThemeCount, error: themeError }] = await Promise.all([
    supabase
    .from('general_devotionals')
    .select('date')
      .gte('date', todayString)
      .lte('date', runwayTargetString)
      .order('date', { ascending: true }),
    supabase.from('devotional_themes').select('week_number', { count: 'exact', head: true }).eq('is_used', false),
  ]);

  if (error) throw error;
  if (themeError) throw themeError;

  const availableDates = new Set((rows || []).map(row => row.date));
  const missingDates = [];
  let runwayThrough = null;
  for (let offset = 0; offset <= minimumRunwayDays; offset += 1) {
    const date = toDateString(addDays(today, offset));
    if (availableDates.has(date) && missingDates.length === 0) runwayThrough = date;
    else if (!availableDates.has(date)) missingDates.push(date);
  }

  return {
    today: todayString,
    targetDate: runwayTargetString,
    minimumRunwayDays,
    runwayThrough,
    healthy: missingDates.length === 0,
    nextMissingDate: missingDates[0] || null,
    missingDateCount: missingDates.length,
    unusedThemeCount: unusedThemeCount || 0,
  };
};

const getGenerationStartDate = async (minimumRunwayDays = DEFAULT_RUNWAY_DAYS) => {
  const status = await getCurriculumStatus({ minimumRunwayDays });

  if (status.healthy) {
    console.log(`[General Devotionals] Runway is healthy through ${status.runwayThrough}; skipping generation.`);
    return null;
  }

  return new Date(`${status.nextMissingDate}T00:00:00.000Z`);
};

const getCurriculumRemediationTarget = async ({ now = new Date(), minimumRunwayDays = DEFAULT_RUNWAY_DAYS } = {}) => {
  if (!CURRICULUM_V2_START_DATE || !CURRICULUM_V2_START_THEME_WEEK) return null;
  const remediationStart = new Date(`${CURRICULUM_V2_START_DATE}T00:00:00.000Z`);
  const target = addDays(now, minimumRunwayDays);
  for (let weekOffset = 0; addDays(remediationStart, weekOffset * 7) <= target; weekOffset += 1) {
    const weekStart = addDays(remediationStart, weekOffset * 7);
    const weekEnd = addDays(weekStart, 6);
    const themeWeekNumber = CURRICULUM_V2_START_THEME_WEEK + weekOffset;
    if (themeWeekNumber > 52) break;
    const { data, error } = await supabase
      .from('general_devotionals')
      .select('date,topics')
      .gte('date', toDateString(weekStart))
      .lte('date', toDateString(weekEnd));
    if (error) throw error;
    const fullyRemediated = (data || []).length === 7
      && data.every(row => Array.isArray(row.topics) && row.topics.includes(CURRICULUM_V2_MARKER));
    if (!fullyRemediated) return { startDate: weekStart, themeWeekNumber };
  }
  return null;
};

const parseJsonContent = (content, label) => {
  try {
    return JSON.parse(content);
  } catch (error) {
    const preview = typeof content === 'string' ? content.slice(0, 500) : '';
    throw new Error(`${label} returned invalid JSON: ${error.message}. Preview: ${preview}`);
  }
};

const normalizeComparable = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const countWords = value => (String(value || '').match(/\b[\w’'-]+\b/g) || []).length;
const semanticTokens = value => new Set(normalizeComparable(value).split(' ').filter(token => token.length > 2 && !['the', 'and', 'with', 'from', 'into', 'your', 'our', 'god'].includes(token)));
const semanticSimilarity = (left, right) => {
  const a = semanticTokens(left);
  const b = semanticTokens(right);
  const intersection = [...a].filter(token => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
};

const assertNoNearDuplicates = (values, label, threshold = 0.66) => {
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (semanticSimilarity(values[left], values[right]) >= threshold) {
        throw new Error(`${label} are too similar: "${values[left]}" and "${values[right]}".`);
      }
    }
  }
};

const buildWeeklyPlanPrompt = (theme, recentContent = []) => `
# SANCTUARY WEEKLY FORMATION PLANNER

## Mission
Design a seven-day Christian formation journey, not seven paraphrases of one religious topic. Every day must make a non-interchangeable contribution. Removing any day should leave a visible gap in the week's progression.

## Weekly source
- Theme: ${theme.theme_title}
- Anchor and editorial focus: ${theme.scripture_focus}
- Existing formation goal: ${theme.formation_goal || 'Not yet specified; define it now.'}
- Existing pastoral need: ${theme.pastoral_need || 'Not yet specified; define it now.'}
- Existing theological claim: ${theme.theological_claim || 'Not yet specified; define it now.'}
- Existing guardrails: ${Array.isArray(theme.guardrails) ? theme.guardrails.join('; ') : 'None supplied.'}

## Recent-content exclusions
Do not repeat or closely paraphrase these recent titles and primary passages:
${recentContent.length ? recentContent.map(item => `- ${item.title} — ${item.scripture_reference}`).join('\n') : '- None supplied'}

## Planning requirements
- State one precise formation_goal, one theological_claim, one pastoral_need, and 2-4 guardrails.
- Create exactly seven days with distinct movements, daily angles, human situations, central claims, practice types, and title directions.
- Use an intentional arc such as encounter, expose, lament/confess, receive, practice, with others, and integrate/rest. Adapt labels when the theme requires it, but use at least six distinct movements.
- Select seven different Scripture references. Each passage must genuinely support its day's central claim in context.
- Include a short interpretation_note for each passage naming its speaker/author, audience or setting, and relevant claim. Do not import language from another biblical passage as though it came from the selected text.
- Each practice_brief must specify a visible same-day behavior, plus a time/setting or recipient. Reflection alone is not a practice unless it produces a written, spoken, scheduled, given, asked, heard, or served response.
- Assign share_mode as one of: none, send, discuss, do_together, serve, church. Use a relational mode on at least two days, but never force sharing.
- Titles must be 4-9 words, make sense without the theme label, and reveal the day's distinctive tension, discovery, or action.
- Do not begin titles with: ${BANNED_TITLE_OPENINGS.join(', ')}.
- Do not repeat the weekly theme word merely to signal coherence.

Before returning, read only the seven title directions, human situations, central claims, and practices. If any two days deliver the same benefit, revise them.

Return valid JSON only:
{
  "formation_goal": "Specific change sought this week",
  "theological_claim": "Truth about God and faithful response",
  "pastoral_need": "Concrete human need",
  "guardrails": ["Guardrail"],
  "days": [
    {
      "day_offset": 0,
      "movement": "encounter",
      "daily_angle": "Unique contribution",
      "human_situation": "Recognizable situation",
      "central_claim": "Passage-grounded claim",
      "scripture_reference": "Book Chapter:Verse",
      "interpretation_note": "Speaker/author, audience/setting, and relevant contextual claim",
      "practice_type": "attention",
      "practice_brief": "Visible action with time/setting or recipient",
      "title_direction": "Distinct Four to Nine Word Title",
      "share_mode": "none"
    }
  ]
}
`;

const normalizePlan = plan => ({
  formation_goal: String(plan.formation_goal || '').trim(),
  theological_claim: String(plan.theological_claim || '').trim(),
  pastoral_need: String(plan.pastoral_need || '').trim(),
  guardrails: Array.isArray(plan.guardrails) ? plan.guardrails.map(String).filter(Boolean) : [],
  days: Array.isArray(plan.days) ? plan.days.map((day, index) => ({
    day_offset: Number(day.day_offset ?? index),
    movement: String(day.movement || '').trim(),
    daily_angle: String(day.daily_angle || '').trim(),
    human_situation: String(day.human_situation || '').trim(),
    central_claim: String(day.central_claim || '').trim(),
    scripture_reference: String(day.scripture_reference || '').trim(),
    interpretation_note: String(day.interpretation_note || '').trim(),
    practice_type: String(day.practice_type || '').trim(),
    practice_brief: String(day.practice_brief || '').trim(),
    title_direction: String(day.title_direction || '').trim(),
    share_mode: String(day.share_mode || 'none').trim(),
  })) : [],
});

const validateWeeklyPlan = rawPlan => {
  const plan = normalizePlan(rawPlan);
  if (!plan.formation_goal || !plan.theological_claim || !plan.pastoral_need || plan.days.length !== 7) {
    throw new Error('Weekly plan must include its formation goal, theological claim, pastoral need, and exactly 7 days.');
  }
  const required = ['movement', 'daily_angle', 'human_situation', 'central_claim', 'scripture_reference', 'interpretation_note', 'practice_type', 'practice_brief', 'title_direction'];
  for (const day of plan.days) {
    if (required.some(key => !day[key])) throw new Error(`Weekly plan day ${day.day_offset + 1} is incomplete.`);
    if (!['none', 'send', 'discuss', 'do_together', 'serve', 'church'].includes(day.share_mode)) {
      throw new Error(`Weekly plan day ${day.day_offset + 1} has invalid share_mode.`);
    }
    const titleWords = countWords(day.title_direction);
    if (titleWords < 4 || titleWords > 9) throw new Error(`Weekly plan title must contain 4-9 words: ${day.title_direction}`);
    if (!/\b(write|speak|say|tell|text|call|send|schedule|give|ask|listen|serve|name|list|set|offer|apologize|thank|invite|read|pray|share|place|remove|visit)\b/i.test(day.practice_brief)) {
      throw new Error(`Weekly plan day ${day.day_offset + 1} needs an observable practice.`);
    }
  }
  const offsets = plan.days.map(day => day.day_offset).sort((a, b) => a - b);
  if (offsets.some((offset, index) => offset !== index)) throw new Error('Weekly plan must contain day offsets 0-6 exactly once.');
  for (const [field, label] of [['scripture_reference', 'Scripture references'], ['title_direction', 'title directions'], ['central_claim', 'central claims']]) {
    const values = plan.days.map(day => normalizeComparable(day[field]));
    if (new Set(values).size !== values.length) throw new Error(`${label} must be distinct within the weekly plan.`);
  }
  if (new Set(plan.days.map(day => normalizeComparable(day.movement))).size < 6) {
    throw new Error('Weekly plan must use at least six distinct pastoral movements.');
  }
  if (plan.days.filter(day => day.share_mode !== 'none').length < 2) {
    throw new Error('Weekly plan must include at least two natural relational or embodied practices.');
  }
  const banned = plan.days.find(day => BANNED_TITLE_OPENINGS.some(opening => normalizeComparable(day.title_direction).startsWith(opening)));
  if (banned) throw new Error(`Weekly plan title uses a banned generic opening: ${banned.title_direction}`);
  assertNoNearDuplicates(plan.days.map(day => day.title_direction), 'Weekly plan titles');
  assertNoNearDuplicates(plan.days.map(day => day.central_claim), 'Weekly plan central claims', 0.8);
  return plan;
};

const buildSingleDayPrompt = (theme, plan, dayOffset, generatedEntries = [], recentContent = []) => {
  const day = plan.days.find(item => item.day_offset === dayOffset);
  const otherDays = plan.days.filter(item => item.day_offset !== dayOffset);
  return `
# SANCTUARY DAILY DEVOTIONAL PLAYBOOK

## Mission
Create one brief, biblically grounded practice that helps a reader encounter God,
understand Scripture in context, and carry one faithful response into ordinary life.

## Assignment
- Day: ${dayOffset + 1} of a 7-day sequence
- Weekly theme: "${theme.theme_title}"
- Weekly formation goal: ${plan.formation_goal}
- Weekly theological claim: ${plan.theological_claim}
- Today's movement: ${day.movement}
- Today's unique angle: ${day.daily_angle}
- Human situation: ${day.human_situation}
- Required central claim: ${day.central_claim}
- Required Scripture: ${day.scripture_reference}
- Interpretation note: ${day.interpretation_note}
- Required practice type: ${day.practice_type}
- Required practice: ${day.practice_brief}
- Title direction: ${day.title_direction}
- Share mode: ${day.share_mode}

The selected Scripture reference and today's contribution are fixed. Do not choose another passage, summarize the whole weekly theme, or borrow another day's contribution.

Other days in this week, provided to prevent overlap:
${otherDays.map(item => `- Day ${item.day_offset + 1}: ${item.title_direction}; ${item.central_claim}; ${item.practice_brief}`).join('\n')}

Already generated this week:
${generatedEntries.length ? generatedEntries.map(item => `- ${item.title}; ${item.scripture_reference}`).join('\n') : '- None'}

Recent titles that must not be reused or closely paraphrased:
${recentContent.length ? recentContent.map(item => `- ${item.title}`).join('\n') : '- None'}

## Formation sequence
Write the content as a seamless 120-160 word reflection that does all five moves:
1. Arrive: open with one calm, concrete sentence that helps the reader become present.
2. Read in context: explain what the passage says in its literary or historical setting; do not proof-text.
3. Reflect honestly: name a recognizable desire, fear, pressure, or habit without diagnosing the reader.
4. Respond: show how God's character and the passage invite trust, repentance, hope, courage, or love of neighbor.
5. Practice: end with the required observable practice. State what to do and its time/setting or recipient. “Reflect,” “consider,” “embrace,” and “remember” do not count unless they produce a visible response.

## Pastoral and theological guardrails
- Sound like a wise Christian companion: orthodox, compassionate, conversational, humble, and non-political.
- Keep God, Scripture, and spiritual formation central. Do not reduce the passage to self-help or promise that faith removes distress.
- Present God as loving and trustworthy. Do not use shame, fear, divine punishment, or a broken habit streak as motivation.
- Make room for lament, suffering, sacrifice, and uncertainty; do not force a cheerful resolution.
- Never claim that prayer or a devotional replaces medical, mental-health, crisis, or pastoral care.
- Use accessible language and avoid insider jargon, culture-war framing, clickbait, and invented historical claims.
- Sound like a trusted pastoral guide by offering one useful distinction or insight, not generic motivation.
- Use only the interpretation supported by today's passage. Do not attribute another passage's language or story to it.

## Short-form story playbook
- Slide 1 — Notice: a clear 6-12 word hook naming the spiritual tension or promise.
- Slide 2 — Ground: the Scripture truth in context, stated accurately and accessibly.
- Slide 3 — Practice: one specific response or prayer for today.
- Each slide must stand alone, remain aligned with the full devotional, and stay under 35 words.

## Quality check before returning
- The required passage genuinely supports the message in its own context.
- The body completes all five formation moves and ends with a doable practice.
- The prayer addresses God and reflects the passage without pretending certainty about outcomes.
- The 4-9 word title exposes today's distinctive value without a banned generic opening and is not equivalent to another title.

## Output contract
- scripture_text must be a short excerpt under 160 characters.
- prayer must be 1-2 sentences.
- Return compact valid JSON only. Do not add commentary or Markdown fences.

Use this exact shape:
{
  "day_offset": ${dayOffset},
  "title": "Title String",
  "scripture_reference": "${day.scripture_reference}",
  "scripture_text": "Short verse excerpt",
  "content": "The devotional body text",
  "prayer": "Prayer text",
  "topics": ["Tag1", "Tag2"],
  "short_form": {
    "format": "instagram_story_3_slide",
    "slides": [
      { "slide": 1, "text": "6-12 word hook" },
      { "slide": 2, "text": "Scripture truth in context, under 35 words" },
      { "slide": 3, "text": "Specific practice or prayer, under 35 words" }
    ]
  }
}
`;
};

const normalizeEntry = (entry, dayOffset) => {
  const fallbackTitle = `Daily Reflection ${dayOffset + 1}`;
  const content = String(entry.content || '').trim();
  const shortForm = entry.short_form && typeof entry.short_form === 'object'
    ? entry.short_form
    : {
        format: 'instagram_story_3_slide',
        slides: [
          { slide: 1, text: String(entry.title || fallbackTitle) },
          { slide: 2, text: content.split('. ').slice(0, 2).join('. ').slice(0, 180) },
          { slide: 3, text: String(entry.prayer || 'Lord, help us walk faithfully today.') },
        ],
      };

  return {
    day_offset: Number(entry.day_offset ?? dayOffset),
    title: String(entry.title || fallbackTitle).trim(),
    scripture_reference: String(entry.scripture_reference || '').trim(),
    scripture_text: String(entry.scripture_text || '').trim().slice(0, 240),
    content,
    prayer: String(entry.prayer || '').trim(),
    topics: Array.isArray(entry.topics) ? entry.topics : [],
    short_form: {
      format: shortForm.format || 'instagram_story_3_slide',
      slides: Array.isArray(shortForm.slides) ? shortForm.slides.slice(0, 3) : [],
    },
  };
};

const validateEntryQuality = entry => {
  if (!entry.title || !entry.scripture_reference || !entry.scripture_text || !entry.content || !entry.prayer) {
    throw new Error(`Day ${entry.day_offset + 1} is missing required devotional or scripture content.`);
  }
  if (BANNED_TITLE_OPENINGS.some(opening => normalizeComparable(entry.title).startsWith(opening))) {
    throw new Error(`Weekly generation title uses a banned generic opening: ${entry.title}`);
  }
  const titleWords = countWords(entry.title);
  if (titleWords < 4 || titleWords > 9) throw new Error(`Day ${entry.day_offset + 1} title must contain 4-9 words.`);
  const wordCount = countWords(entry.content);
  if (wordCount < 100 || wordCount > 190) {
    throw new Error(`Day ${entry.day_offset + 1} must contain 100-190 words; received ${wordCount}.`);
  }
  if (entry.short_form.slides.length !== 3) {
    throw new Error(`Day ${entry.day_offset + 1} must contain exactly three short-form slides.`);
  }
  return entry;
};

const validateWeeklyEntries = (entries) => {
  if (!Array.isArray(entries) || entries.length !== 7) {
    throw new Error(`Weekly generation must return exactly 7 devotionals; received ${entries?.length || 0}.`);
  }

  const normalized = entries.map((entry, index) => normalizeEntry(entry, index));
  const offsets = normalized.map(entry => entry.day_offset).sort((a, b) => a - b);
  const expectedOffsets = [0, 1, 2, 3, 4, 5, 6];
  if (offsets.some((offset, index) => offset !== expectedOffsets[index])) {
    throw new Error(`Weekly generation returned invalid or duplicate day offsets: ${offsets.join(', ')}.`);
  }

  normalized.forEach(validateEntryQuality);

  const references = normalized.map(entry => entry.scripture_reference.toLowerCase().replace(/\s+/g, ' ').trim());
  if (new Set(references).size !== references.length) {
    throw new Error('Weekly generation must use a distinct scripture reference for each day.');
  }

  const titles = normalized.map(entry => normalizeComparable(entry.title));
  if (new Set(titles).size !== titles.length) {
    throw new Error('Weekly generation must use distinct titles for every day.');
  }
  assertNoNearDuplicates(normalized.map(entry => entry.title), 'Weekly devotional titles');
  return normalized;
};

const generateWeeklyPlan = async (theme, recentContent = []) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({
        model: GENERAL_DEVOTIONAL_MODEL,
        messages: [{ role: 'system', content: buildWeeklyPlanPrompt(theme, recentContent) }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 7000,
      }, { timeout: 60_000 });
      const result = parseJsonContent(completion.choices[0].message.content, 'Weekly formation plan');
      return { plan: validateWeeklyPlan(result.plan || result), tokens: completion.usage?.total_tokens || 0 };
    } catch (error) {
      lastError = error;
      console.warn(`[General Devotionals] Weekly plan attempt ${attempt} failed:`, error.message);
    }
  }
  throw lastError;
};

const generateSingleDayEntry = async (theme, plan, dayOffset, generatedEntries = [], recentContent = []) => {
  let lastError = null;
  const plannedDay = plan.days.find(day => day.day_offset === dayOffset);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({
        model: GENERAL_DEVOTIONAL_MODEL,
        messages: [{ role: 'system', content: buildSingleDayPrompt(theme, plan, dayOffset, generatedEntries, recentContent) }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 4000,
      }, { timeout: 60_000 });
      const result = parseJsonContent(completion.choices[0].message.content, `Single-day devotional ${dayOffset + 1}`);
      const normalized = normalizeEntry(result.entry || result.devotional || result, dayOffset);
      if (normalizeComparable(normalized.scripture_reference) !== normalizeComparable(plannedDay.scripture_reference)) {
        throw new Error(`Day ${dayOffset + 1} changed planned Scripture ${plannedDay.scripture_reference} to ${normalized.scripture_reference}.`);
      }
      if (generatedEntries.some(entry => normalizeComparable(entry.title) === normalizeComparable(normalized.title))) {
        throw new Error(`Day ${dayOffset + 1} repeated title ${normalized.title}.`);
      }
      validateEntryQuality(normalized);
      return { entry: normalized, tokens: completion.usage?.total_tokens || 0 };
    } catch (error) {
      lastError = error;
      console.warn(`[General Devotionals] Day ${dayOffset + 1} attempt ${attempt} failed:`, error.message);
    }
  }
  throw lastError;
};

const generateEntries = async (theme, recentContent = []) => {
  const planned = await generateWeeklyPlan(theme, recentContent);
  const entries = [];
  let tokens = planned.tokens;
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const generated = await generateSingleDayEntry(theme, planned.plan, dayOffset, entries, recentContent);
    tokens += generated.tokens;
    entries.push(generated.entry);
  }
  return { entries, plan: planned.plan, tokens, fallback: false };
};

const loadRecentContent = async startDate => {
  const before = toDateString(addDays(startDate, -1));
  const since = toDateString(addDays(startDate, -RECENT_CONTENT_DAYS));
  const { data, error } = await supabase
    .from('general_devotionals')
    .select('date,title,scripture_reference')
    .gte('date', since)
    .lte('date', before)
    .order('date', { ascending: false });
  if (error) throw error;
  return data || [];
};

const getNextTheme = async (themeWeekNumber = null) => {
  let query = supabase.from('devotional_themes').select('*').order('week_number', { ascending: true });
  query = themeWeekNumber == null
    ? query.eq('is_used', false).limit(1)
    : query.eq('week_number', themeWeekNumber).limit(1);
  let { data: theme, error } = await query.maybeSingle();
  if (error) throw error;
  if (theme || themeWeekNumber != null) return theme;

  // A complete 52-week curriculum is reusable annually. Reset only after every
  // theme has been consumed, then begin the next curriculum cycle at week 1.
  const { error: resetError } = await supabase
    .from('devotional_themes')
    .update({ is_used: false })
    .eq('is_used', true);
  if (resetError) throw resetError;

  ({ data: theme, error } = await supabase
    .from('devotional_themes')
    .select('*')
    .eq('is_used', false)
    .order('week_number', { ascending: true })
    .limit(1)
    .maybeSingle());
  if (error) throw error;
  if (theme) console.log('[General Devotionals] Started a new 52-week curriculum cycle.');
  return theme;
};

const generateWeeklyBatch = async ({ force = false, startDate = null, themeWeekNumber = null } = {}) => {
  const startTime = Date.now();

  try {
    const resolvedStartDate = startDate || (force ? new Date() : await getGenerationStartDate());

    if (!resolvedStartDate) {
      return { generated: false, reason: 'runway_healthy' };
    }

    const theme = await getNextTheme(themeWeekNumber);
    if (!theme) {
      throw new Error(themeWeekNumber == null
        ? 'The devotional curriculum has no themes.'
        : `Devotional theme week ${themeWeekNumber} was not found.`);
    }

    console.log(
      `[General Devotionals] Generating week ${theme.week_number}: "${theme.theme_title}" (${theme.scripture_focus})`
    );

    const recentContent = await loadRecentContent(resolvedStartDate);
    const generated = await generateEntries(theme, recentContent);
    const entries = validateWeeklyEntries(generated.entries);
    const { tokens, fallback } = generated;

    const { error: planError } = await supabase
      .from('devotional_week_plans')
      .upsert({
        start_date: toDateString(resolvedStartDate),
        end_date: toDateString(addDays(resolvedStartDate, 6)),
        theme_week_number: theme.week_number,
        theme_title: theme.theme_title,
        formation_goal: generated.plan.formation_goal,
        plan: generated.plan,
        prompt_version: 'weekly-formation-v2',
        model: GENERAL_DEVOTIONAL_MODEL,
        status: 'generated',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'start_date' });
    if (planError && planError.code !== 'PGRST205' && planError.code !== '42P01') throw planError;
    if (planError) console.warn('[General Devotionals] Plan audit table is not migrated yet; continuing without persistence.');

    for (const entry of entries) {
      const targetDate = addDays(resolvedStartDate, Number(entry.day_offset || 0));
      const dateString = toDateString(targetDate);

      console.log(`[General Devotionals] Upserting ${dateString}: ${entry.title}`);

      const { error: insertError } = await supabase
        .from('general_devotionals')
        .upsert(
          {
            date: dateString,
            title: entry.title,
            scripture_reference: entry.scripture_reference,
            scripture_text: entry.scripture_text,
            content: entry.content,
            prayer: entry.prayer,
            topics: [...new Set([...(entry.topics || []), theme.theme_title, CURRICULUM_V2_MARKER])],
            short_form: entry.short_form || null,
          },
          { onConflict: 'date' }
        );

      if (insertError) {
        throw new Error(`Error inserting ${dateString}: ${insertError.message}`);
      }
    }

    const { error: themeUpdateError } = await supabase
      .from('devotional_themes')
      .update({ is_used: true })
      .eq('week_number', theme.week_number);

    if (themeUpdateError) throw themeUpdateError;

    if (!planError) {
      const { error: publishPlanError } = await supabase
        .from('devotional_week_plans')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('start_date', toDateString(resolvedStartDate));
      if (publishPlanError) throw publishPlanError;
    }

    const summary = {
      generated: true,
      weekNumber: theme.week_number,
      themeTitle: theme.theme_title,
      startDate: toDateString(resolvedStartDate),
      count: entries.length,
      fallback,
      formationGoal: generated.plan.formation_goal,
    };

    console.log('[General Devotionals] Success.', summary);
    logEvent(
      'ai',
      'backend',
      null,
      'generate_general_devotionals',
      'Successfully generated weekly batch of devotionals',
      { tokens, ...summary },
      Date.now() - startTime
    );

    return summary;
  } catch (err) {
    console.error('[General Devotionals] Script failed:', err);
    logEvent(
      'error',
      'backend',
      null,
      'generate_general_devotionals',
      'Failed to generate weekly batch of devotionals',
      { error: err.message },
      Date.now() - startTime
    );
    throw err;
  }
};

const ensureDevotionalRunway = async ({
  minimumRunwayDays = DEFAULT_RUNWAY_DAYS,
  maxWeeksPerRun = DEFAULT_MAX_WEEKS_PER_RUN,
} = {}) => {
  const generatedWeeks = [];

  for (let week = 0; week < maxWeeksPerRun; week += 1) {
    const remediation = await getCurriculumRemediationTarget({ minimumRunwayDays });
    if (remediation) {
      generatedWeeks.push(await generateWeeklyBatch(remediation));
      continue;
    }
    const startDate = await getGenerationStartDate(minimumRunwayDays);
    if (!startDate) break;
    generatedWeeks.push(await generateWeeklyBatch({ startDate }));
  }

  const status = await getCurriculumStatus({ minimumRunwayDays });
  return {
    generated: generatedWeeks.length > 0,
    generatedWeekCount: generatedWeeks.length,
    generatedWeeks,
    status,
  };
};

if (require.main === module) {
  const command = process.argv.includes('--force')
    ? generateWeeklyBatch({ force: true })
    : ensureDevotionalRunway();
  command
    .then((result) => {
      console.log('[General Devotionals] Result:', result);
    })
    .catch(() => {
      process.exitCode = 1;
    });
}

module.exports = {
  buildSingleDayPrompt,
  buildWeeklyPlanPrompt,
  ensureDevotionalRunway,
  generateEntries,
  generateWeeklyBatch,
  getCurriculumStatus,
  getCurriculumRemediationTarget,
  validateWeeklyPlan,
  validateWeeklyEntries,
};
