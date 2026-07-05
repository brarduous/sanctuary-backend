// cron/generateGeneralDevotionals.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');
const { getGeneralDevotionalBatchPrompt } = require('../prompts');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });
const GENERAL_DEVOTIONAL_MODEL = process.env.GENERAL_DEVOTIONAL_MODEL || 'gpt-4o-mini';
const USE_WEEKLY_BATCH_GENERATION = process.env.GENERAL_DEVOTIONAL_BATCH_MODE === 'true';

const toDateString = (date) => date.toISOString().split('T')[0];

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
};

const getGenerationStartDate = async (minimumRunwayDays = 3) => {
  const today = new Date();
  const todayString = toDateString(today);
  const runwayTargetString = toDateString(addDays(today, minimumRunwayDays));

  const { data: latest, error } = await supabase
    .from('general_devotionals')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (latest?.date && latest.date >= runwayTargetString) {
    console.log(`[General Devotionals] Runway is healthy through ${latest.date}; skipping generation.`);
    return null;
  }

  if (latest?.date && latest.date >= todayString) {
    return addDays(new Date(`${latest.date}T00:00:00.000Z`), 1);
  }

  return new Date(`${todayString}T00:00:00.000Z`);
};

const parseEntries = (result) => {
  const entries = result.entries || result.days || result.devotionals || result.daily_devotionals || result;
  if (!Array.isArray(entries)) {
    throw new Error('AI did not return a devotional array.');
  }
  return entries;
};

const parseJsonContent = (content, label) => {
  try {
    return JSON.parse(content);
  } catch (error) {
    const preview = typeof content === 'string' ? content.slice(0, 500) : '';
    throw new Error(`${label} returned invalid JSON: ${error.message}. Preview: ${preview}`);
  }
};

const buildSingleDayPrompt = (theme, dayOffset) => `
Role: You are the Lead Editor for Sanctuary.
Task: Write one Daily Devotional for day ${dayOffset + 1} of a 7-day sequence.
Theme: "${theme.theme_title}".
Focus Scripture Area: ${theme.scripture_focus}.

Use the focus scripture area as an anchor. Choose a short scripture verse or brief excerpt.

REQUIREMENTS:
- Tone: Orthodox, compassionate, conversational, non-political, focused on spiritual formation.
- Full devotional content should be approximately 120-160 words.
- scripture_text must be a short excerpt under 160 characters.
- prayer must be 1-2 sentences.
- short_form.slides must contain exactly 3 slides, each under 35 words.

Return compact valid JSON only with this exact shape:
{
  "day_offset": ${dayOffset},
  "title": "Title String",
  "scripture_reference": "Book Chapter:Verse",
  "scripture_text": "Short verse excerpt",
  "content": "The devotional body text",
  "prayer": "Prayer text",
  "topics": ["Tag1", "Tag2"],
  "short_form": {
    "format": "instagram_story_3_slide",
    "slides": [
      { "slide": 1, "text": "Under 30 words" },
      { "slide": 2, "text": "Under 30 words" },
      { "slide": 3, "text": "Under 30 words" }
    ]
  }
}
`;

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

const generateSingleDayEntry = async (theme, dayOffset) => {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({
        model: GENERAL_DEVOTIONAL_MODEL,
        messages: [{ role: 'system', content: buildSingleDayPrompt(theme, dayOffset) }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 4000,
      }, { timeout: 60_000 });

      const result = parseJsonContent(completion.choices[0].message.content, `Single-day devotional ${dayOffset + 1}`);
      const entry = result.entry || result.devotional || result;
      return {
        ...normalizeEntry(entry, dayOffset),
        tokens: completion.usage?.total_tokens,
      };
    } catch (error) {
      lastError = error;
      console.warn(`[General Devotionals] Single-day ${dayOffset + 1} attempt ${attempt} failed:`, error.message);
    }
  }

  throw lastError;
};

const generateEntries = async (theme, prompt) => {
  if (!USE_WEEKLY_BATCH_GENERATION) {
    const entries = [];
    let tokens = 0;

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const entry = await generateSingleDayEntry(theme, dayOffset);
      tokens += entry.tokens || 0;
      delete entry.tokens;
      entries.push(entry);
    }

    return { entries, tokens, fallback: true };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: GENERAL_DEVOTIONAL_MODEL,
      messages: [{ role: 'system', content: prompt }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 12000,
    }, { timeout: 60_000 });

    console.log('[General Devotionals] AI batch response received. Processing...');
    const result = parseJsonContent(completion.choices[0].message.content, 'Weekly devotional batch');
    return {
      entries: parseEntries(result),
      tokens: completion.usage?.total_tokens,
      fallback: false,
    };
  } catch (error) {
    console.warn('[General Devotionals] Batch generation failed. Falling back to single-day generation.', error.message);
    const entries = [];
    let tokens = 0;

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const entry = await generateSingleDayEntry(theme, dayOffset);
      tokens += entry.tokens || 0;
      delete entry.tokens;
      entries.push(entry);
    }

    return { entries, tokens, fallback: true };
  }
};

const generateWeeklyBatch = async ({ force = false, startDate = null } = {}) => {
  const startTime = Date.now();

  try {
    const resolvedStartDate = startDate || (force ? new Date() : await getGenerationStartDate());

    if (!resolvedStartDate) {
      return { generated: false, reason: 'runway_healthy' };
    }

    const { data: theme, error: themeError } = await supabase
      .from('devotional_themes')
      .select('*')
      .eq('is_used', false)
      .order('week_number', { ascending: true })
      .limit(1)
      .single();

    if (themeError || !theme) {
      console.log('[General Devotionals] No unused themes found. Generate a new syllabus.');
      return { generated: false, reason: 'no_unused_theme' };
    }

    console.log(
      `[General Devotionals] Generating week ${theme.week_number}: "${theme.theme_title}" (${theme.scripture_focus})`
    );

    const prompt = await getGeneralDevotionalBatchPrompt(theme);

    const { entries, tokens, fallback } = await generateEntries(theme, prompt);

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
            topics: entry.topics,
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

    const summary = {
      generated: true,
      weekNumber: theme.week_number,
      themeTitle: theme.theme_title,
      startDate: toDateString(resolvedStartDate),
      count: entries.length,
      fallback,
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

if (require.main === module) {
  generateWeeklyBatch({ force: process.argv.includes('--force') })
    .then((result) => {
      console.log('[General Devotionals] Result:', result);
    })
    .catch(() => {
      process.exitCode = 1;
    });
}

module.exports = {
  generateWeeklyBatch,
};
