// scripts/generate-general-content.js
require('dotenv').config(); // Make sure this points to your .env file
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- CONFIGURATION ---
// PASTE 1-2 PERFECT EXAMPLES FROM YOUR PDF HERE.
// This is "Few-Shot Prompting". It forces the AI to mimic this exact tone and format.
const STYLE_EXAMPLES = `
EXAMPLE 1 (Tone: Pastoral, Encouraging):
Title: Help for Our Healing
Scripture: James 5:13-20
Content: God cares about our physical well-being.  After all, He created our body to be a temple for His Spirit.

Ungodly choices can lead to illness (John 5:14). So when we’re afflicted, it’s wise to ask God to search our heart and reveal anything He wants us to address (Psalms 139:23-24). Most of the time, though, health problems are simply part of our human condition—a symptom of mankind’s fallen state rather than evidence of personal sin. The truth is, disease and sickness affect just about everyone at some point. So what response does God desire from us?

Our heavenly Father wants us to be aware of His presence and to stay in communication with Him (1 Thessalonians 5:17), leaning on Him as we receive medical treatment. Developing a pattern of prayerfulness is the best way to prepare for the unexpected.

God’s Word also calls us to intercede for one another. Its instructions include calling the elders of the church to pray and anoint the afflicted person with oil in Jesus’ name (James 5:14).

Our Father is able to heal, but He sometimes allows the condition to remain. When requesting restored health, we should ask with faith in God’s ability and confidence in His perfect will.
Prayer: Lord, help me to trust You in times of illness. Remind me that You are always present, and teach me to lean on You more each day. Amen.

EXAMPLE 2 (Tone: Practical, Biblical):
Title: Seeing Yourself the Way God Sees You
Scripture: Genesis 1:26
Content: Many people struggle with poor self-image because they focus on their flaws instead of remembering how God sees them. The truth is that He created you in His image and likeness, which means you have great value and purpose. You are not an accident or a mistake—you are a masterpiece designed by the Creator Himself.

When you see yourself through God’s eyes, you can walk in confidence, knowing that you are deeply loved and fully accepted. The enemy tries to fill your mind with fear, shame, and insecurity, but God wants to renew your thoughts with His truth. You are righteous in Christ and equipped with everything you need to fulfill His plan for your life.

Instead of focusing on your shortcomings, meditate on what God says about you in His Word. Speak it out loud every day until it becomes your reality.
Prayer: Lord, help me see myself through Your eyes. Replace my fear and insecurity with confidence in Your love and remind me daily that I am righteous in Christ, amen.
`;

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

    // 2. Construct the Prompt
    // We ask for 7 days relative to the batch (Day 1, Day 2...)
    const prompt = `
      Role: You are the Lead Editor for 'Sanctuary'.
      Task: Write 7 Daily Devotionals for the theme: "${theme.theme_title}".
      Focus Scripture Area: ${theme.scripture_focus}.
      
      CRITICAL STYLE GUIDE:
      ${STYLE_EXAMPLES}
      
      REQUIREMENTS:
      - Write exactly 7 entries.
      - Tone: Orthodox, compassionate, conversational, non-political, focused on spiritual formation. Use the style examples as your guide.
      - Length: Matches the examples provided (approx 250-300 words).
      
      OUTPUT FORMAT (JSON Array):
      [
        {
          "day_offset": 0, // 0 = Monday, 1 = Tuesday...
          "title": "Title String",
          "scripture_reference": "Book Chapter:Verse",
          "scripture_text": "Full text of the verse (KJV or ESV)",
          "content": "The devotional body text...",
          "prayer": "A 2-sentence prayer...",
          "topics": ["Tag1", "Tag2"]
        }
      ]
    `;

    // 3. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano", // Use your best model for quality
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const entries = result.entries || result.days || result; // Handle potential JSON key variance

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
          topics: entry.topics
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