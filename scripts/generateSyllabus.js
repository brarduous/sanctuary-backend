// scripts/generate-syllabus.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');
const { fetchPrompt } = require('../prompts');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const generateSyllabus = async () => {
  const startTime = Date.now();
  const prompt = await fetchPrompt('devotional_syllabus_generator');

  console.log("Generating yearly syllabus...");
  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [{ role: "system", content: prompt }],
    response_format: { type: "json_object" }
  });

  const data = JSON.parse(completion.choices[0].message.content);

  // Insert into DB
  const rows = data.weeks.map(w => ({
    week_number: w.week,
    theme_title: w.theme,
    scripture_focus: w.focus
  }));

  const { error } = await supabase.from('devotional_themes').upsert(rows);
  
  if (error) {
    console.error("Error saving syllabus:", error);
    logEvent('error', 'backend', null, 'generate_syllabus', 'Failed to save syllabus', { error: error.message }, Date.now() - startTime);
  } else {
    console.log("Success! 52 weeks of topics generated.");
    logEvent('ai', 'backend', null, 'generate_syllabus', 'Successfully generated syllabus', {tokens: completion.usage.total_tokens}, Date.now() - startTime);
  }
};

generateSyllabus();