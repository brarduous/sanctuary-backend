// cron/dailyNewsSynopsis.js
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const daily_news_synopsis_prompt = `
# ROLE & GOAL
You are a journalistic writer. You provide clear, concise, and unbiased summaries of news events. Your goal is to create a comprehensive review of the most important news from the day. 
This review should consider the emotional and societal impact of the events, as well as their factual content.
The summary should be engaging and informative, and should read like a script for a podcast episode or a news video segment.

# INSTRUCTIONS
You will be provided with the titles and bodies of several news articles for today. Respond ONLY with a valid JSON object using the following schema and no surrounding commentary.

--- JSON RESPONSE SCHEMA ---
{
  "summary": "string - concise overview of key events and mood. This is a summary of the news articles for today, so make sure the reference it in terms of today's day of the week, date, etc., and only where applicable.",
  "scripture": "string - a single relevant scripture including reference and full verse text. please ensure the scripture is not repetitive of past synopses",
  "prayer": "string - a short topical prayer related to the day"
}

# NOTES
- The scripture should be directly quoted with its reference (e.g., "Philippians 4:6-7 - Do not be anxious..."), accurate to a common translation.
- Keep the prayer brief, pastoral, and focused on themes from the day's summary.
- Do not mention the date or day of the week in the summary. at most, refer to "today" or "this week".
- If referencing a public figure or event, ensure accuracy and neutrality. e.g. You once referred to President Trump as Former President Trump. Maintain this standard.`;

async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
  const chatCompletion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
    response_format: { type: responseFormatType },
  });
  const generatedContent = chatCompletion.choices[0].message.content;
  if (responseFormatType === 'json_object') {
    try {
      return JSON.parse(generatedContent);
    } catch (e) {
      // Fall back to raw text if parsing fails
      return { summary: generatedContent, scripture: null, prayer: null };
    }
  }
  return generatedContent;
}

async function generateDailyNewsSynopsisFromLast24h() {
  console.log('Generating daily news synopsis from today so far');
  // Calculate timestamp for today so far
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sinceISOString = since.toISOString();

  // Fetch articles created in today so far
  const { data: outlooks, error } = await supabase
    .from('scriptural_outlooks')
    .select('article_title, article_body, ai_outlook, created_at')
    .gte('created_at', sinceISOString)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching articles from today so far:', error);
    return;
  }
  if (!outlooks || outlooks.length === 0) {
    console.log('No articles found from today so far. Skipping synopsis.');
    return;
  }

  const combinedContent = outlooks.map((o, index) => {
    const description = o.ai_outlook?.synopsis || o.article_body;
    return `Article ${index + 1} Title: ${o.article_title}\nArticle ${index + 1} Description: ${description}\n\n`;
  }).join('');

  try {
    const aiResponse = await callOpenAIAndProcessResult(
      daily_news_synopsis_prompt,
      combinedContent,
      'gpt-4.1-2025-04-14',
      5000,
      'json_object'
    );

    if (aiResponse && (aiResponse.summary || aiResponse.scripture || aiResponse.prayer)) {
      const payload = {
        synopsis: aiResponse.summary || null,
        scripture: aiResponse.scripture || null,
        prayer: aiResponse.prayer || null,
        created_at: new Date().toISOString(),
      };

      const { data, error: insertError } = await supabase
        .from('daily_news_synopses')
        .insert([payload])
        .select();

      if (insertError) {
        console.error('Error saving daily news synopsis:', insertError);
      } else {
        console.log('Successfully saved daily news synopsis:', data?.[0]);
      }
    } else {
      console.error('AI response did not contain synopsis content.');
    }
  } catch (err) {
    console.error('Error generating daily news synopsis:', err);
  }
}

module.exports = { generateDailyNewsSynopsisFromLast24h };

if (require.main === module) {
  generateDailyNewsSynopsisFromLast24h();
}
