// scripts/generate-syllabus.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const generateSyllabus = async () => {
  const prompt = `
    Act as a wise, unbiased theologian. 
    Create a 52-week devotional curriculum for laypeople.
    Goal: Cover a balanced range of topics including theological growth, practical living, dealing with hardship, and celebration.
    Avoid repetitive topics. Ensure the "Whole Counsel of God" is represented.
    
    Output JSON format:
    {
      "weeks": [
        { "week": 1, "theme": "New Beginnings", "focus": "Isaiah 43" },
        ...
      ]
    }
  `;

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
  
  if (error) console.error("Error saving syllabus:", error);
  else console.log("Success! 52 weeks of topics generated.");
};

generateSyllabus();