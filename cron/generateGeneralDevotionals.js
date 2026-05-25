// cron/generateGeneralDevotionals.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');
const { getGeneralDevotionalBatchPrompt } = require('../prompts');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'system', content: prompt }],
      response_format: { type: 'json_object' },
    });

    console.log('[General Devotionals] AI response received. Processing...');
    const result = JSON.parse(completion.choices[0].message.content);
    const entries = parseEntries(result);

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
    };

    console.log('[General Devotionals] Success.', summary);
    logEvent(
      'ai',
      'backend',
      null,
      'generate_general_devotionals',
      'Successfully generated weekly batch of devotionals',
      { tokens: completion.usage?.total_tokens, ...summary },
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
