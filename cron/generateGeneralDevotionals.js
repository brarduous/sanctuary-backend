// scripts/generate-general-content.js
require('dotenv').config(); // Make sure this points to your .env file
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');
const { getGeneralDevotionalBatchPrompt } = require('../prompts');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const generateWeeklyBatch = async () => {
  const startTime = Date.now();
  try {
    // 1. Fetch the next unused theme from your syllabus
    const { data: theme, error: themeError } = await supabase
      .from('devotional_themes')
      .select('*')
      .eq('is_used', false)
      .order('week_number', { ascending: true })
      .limit(1)
      .single();

    if (themeError || !theme) {
      console.log("⚠️ No unused themes found! Time to generate a new yearly syllabus.");
      return;
    }

    console.log(`\n📅 Generating Week ${theme.week_number}: "${theme.theme_title}" (${theme.scripture_focus})`);

    // 2. Construct the Prompt from Supabase template
    const prompt = await getGeneralDevotionalBatchPrompt(theme);

    // 3. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano", // Use your best model for quality
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });

    console.log("🤖 AI response received. Processing...", completion.choices[0].message);
    const result = JSON.parse(completion.choices[0].message.content);
    console.log("✅ AI response parsed successfully.", result);

    const entries = result.entries || result.days || result.devotionals || result.daily_devotionals || result; // Handle potential JSON key variance

    if (!Array.isArray(entries)) throw new Error("AI did not return an array.");

    // 4. Calculate Dates & Insert into DB
    // We assume this script runs on Sunday night or Monday morning to generate THIS week's content.
    // Or you can set 'startDate' to whatever the next Monday is.
    const today = new Date();
    
    for (const entry of entries) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + entry.day_offset);
      const dateString = targetDate.toISOString().split('T')[0];

      console.log(`   -> Processing ${dateString}: ${entry.title}`);

      const { error: insertError } = await supabase
        .from('general_devotionals')
        .upsert({
          date: dateString,
          title: entry.title,
          scripture_reference: entry.scripture_reference,
          scripture_text: entry.scripture_text,
          content: entry.content,
          prayer: entry.prayer,
          topics: entry.topics,
          short_form: entry.short_form || null
        }, { onConflict: 'date' });

      if (insertError) console.error(`   ❌ Error inserting ${dateString}:`, insertError.message);
    }

    // 5. Mark Theme as Used
    await supabase
      .from('devotional_themes')
      .update({ is_used: true })
      .eq('week_number', theme.week_number);

    console.log(`✅ Success! Week ${theme.week_number} content generated and saved.`);
    logEvent('ai', 'backend', null, 'generate_general_devotionals', 'Successfully generated weekly batch of devotionals', {tokens: completion.usage.total_tokens}, Date.now() - startTime);
  } catch (err) {
    console.error("💥 Script failed:", err);
    logEvent('error', 'backend', null, 'generate_general_devotionals', 'Failed to generate weekly batch of devotionals', { error: err.message }, Date.now() - startTime);
  }
};

// Execute
generateWeeklyBatch();
