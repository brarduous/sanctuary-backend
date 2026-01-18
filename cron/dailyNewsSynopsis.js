// cron/dailyNewsSynopsis.js
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const {getDailyNewsSynopsisPrompt} = require('../prompts');
const { logEvent } = require('../utils/helpers');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
  const chatCompletion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: responseFormatType },
  });
  const generatedContent = chatCompletion.choices[0].message.content;
  generatedContent.tokens = chatCompletion.usage.total_tokens;
  console.log('AI Generated Content:', generatedContent);
  if (responseFormatType === 'json_object') {
    try {
      return JSON.parse(generatedContent);
    } catch (e) {
      // Fall back to raw text if parsing fails
      return { summary: generatedContent, scripture: null, prayer: null, tokens: chatCompletion.usage.total_tokens };
    }
  }
  return generatedContent;
}

async function generateDailyNewsSynopsisFromLast24h() {
  const startTime = Date.now();
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
    logEvent('error', 'backend', null, 'fetch_daily_news_synopsis', 'Failed to fetch articles from today so far', { error: error.message }, Date.now() - startTime);
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
    const systemPrompt = await getDailyNewsSynopsisPrompt();
    const aiResponse = await callOpenAIAndProcessResult(
      systemPrompt,
      combinedContent,
      'gpt-5-nano',
      5000,
      'json_object'
    );

    if (aiResponse && (aiResponse.synopsis || aiResponse.scripture || aiResponse.prayer)) {
      const payload = {
        synopsis: aiResponse.synopsis || null,
        scripture: aiResponse.scripture || null,
        prayer: aiResponse.prayer || null,
        created_at: new Date().toISOString(),
      };
      console.log('Payload to be saved:', payload);
      const { data, error: insertError } = await supabase
        .from('daily_news_synopses')
        .insert([payload])
        .select();

      if (insertError) {
        console.error('Error saving daily news synopsis:', insertError);
        logEvent('error', 'backend', null, 'save_daily_news_synopsis', 'Failed to save daily news synopsis', { error: insertError.message }, Date.now() - startTime);
      } else {
        logEvent('ai', 'backend', null, 'save_daily_news_synopsis', 'Successfully saved daily news synopsis', {tokens: aiResponse.tokens}, Date.now() - startTime);
        console.log('Successfully saved daily news synopsis:', data?.[0]);
      }
    } else {
      logEvent('error', 'backend', null, 'generate_daily_news_synopsis', 'AI response missing synopsis content', {}, Date.now() - startTime);
      console.error('AI response did not contain synopsis content.');
    }
  } catch (err) {
    logEvent('error', 'backend', null, 'generate_daily_news_synopsis', 'Error generating daily news synopsis', { error: err.message }, Date.now() - startTime); 
    console.error('Error generating daily news synopsis:', err);
  }
}

module.exports = { generateDailyNewsSynopsisFromLast24h };

if (require.main === module) {
  generateDailyNewsSynopsisFromLast24h();
}
