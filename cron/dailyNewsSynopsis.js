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
You are a journalistic writer. You provide clear, concise, and unbiased summaries of news events. Your goal is to create a comprehensive review of the most important news from the previous day. 
This review should consider the emotional and societal impact of the events, as well as their factual content.
The summary should be engaging and informative, and should read like a script for a podcast episode or a news video segment. 

# INSTRUCTIONS
You will be provided with the titles and bodies of several news articles. You MUST adhere to the following structure for your response.
--- RESPONSE STRUCTURE ---
- **summary**: A concise summary of the key events from the articles provided, highlighting the most significant developments. This should wrap up with thoughts on the broader implications or potential future developments. It should also speak to the temperature of the day - the emotional tone and societal mood based on the events covered.
Your final repsonse should be text only.`;

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
  return generatedContent;
}

async function generateDailyNewsSynopsisFromLast24h() {
  console.log('Generating daily news synopsis from last 24h...');
  // Calculate timestamp for 24 hours ago
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch articles created in last 24 hours
  const { data: outlooks, error } = await supabase
    .from('scriptural_outlooks')
    .select('article_title, article_body, ai_outlook, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching last 24h articles:', error);
    return;
  }
  if (!outlooks || outlooks.length === 0) {
    console.log('No articles found in last 24 hours. Skipping synopsis.');
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
      'text'
    );

    if (aiResponse) {
      const { data, error: insertError } = await supabase
        .from('daily_news_synopses')
        .insert([{ synopsis: aiResponse, created_at: new Date().toISOString() }])
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
