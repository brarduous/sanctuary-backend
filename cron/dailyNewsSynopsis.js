// cron/dailyNewsSynopsis.js
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const {getDailyNewsSynopsisPrompt} = require('../prompts');
const { articleBriefInput, parseNewsBriefResponse } = require('../utils/newsBrief');
const {reviewNewsReaderCopy}=require('../utils/newsReaderReview');
const { logEvent } = require('../utils/helpers');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
  const assessment={type:'object',additionalProperties:false,required:['verdict','focus','reason','scriptureReference'],properties:{verdict:{type:'string',enum:['aligned','concerns','mixed','unclear']},focus:{type:'string'},reason:{type:'string'},scriptureReference:{type:'string'}}};
  const schema={type:'object',additionalProperties:false,required:['synopsis','details','stories','thought_to_remember','prayer'],properties:{synopsis:{type:'string'},details:{type:'string'},thought_to_remember:{type:'string'},prayer:{type:'string'},stories:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,required:['headline','summary','christianAssessment'],properties:{headline:{type:'string'},summary:{type:'string'},christianAssessment:assessment}}}}};
  const chatCompletion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: responseFormatType==='json_object' ? {type:'json_schema',json_schema:{name:'sanctuary_daily_news_brief',strict:true,schema}}:{type:responseFormatType},
  });
  const generatedContent = chatCompletion.choices[0].message.content;
  console.log('AI Generated Content:', generatedContent);
  if (responseFormatType === 'json_object') {
    return parseNewsBriefResponse(generatedContent, chatCompletion.usage?.total_tokens);
  }
  return generatedContent;
}

async function generateDailyNewsSynopsisFromLast24h() {
  const startTime = Date.now();
  console.log('Generating daily news synopsis from today so far');
  // A rolling day includes only released canonical articles, never hidden drafts.
  const since = new Date(Date.now()-24*60*60*1000);
  const sinceISOString = since.toISOString();

  // Fetch articles created in today so far
  const { data: outlooks, error } = await supabase
    .from('scriptural_outlooks')
    .select('id, article_title, article_body, ai_outlook, created_at, publish_date')
    .eq('publication_status','published')
    .is('superseded_by_outlook_id',null)
    .gte('created_at', sinceISOString)
    .order('created_at', { ascending: false }).limit(24);

  if (error) {
    console.error('Error fetching articles from today so far:', error);
    await logEvent('error', 'backend', null, 'fetch_daily_news_synopsis', 'Failed to fetch articles from today so far', { error: error.message }, Date.now() - startTime);
    throw error;
  }
  if (!outlooks || outlooks.length === 0) {
    console.log('No articles found from today so far. Skipping synopsis.');
    return;
  }

  const combinedContent = outlooks.map(articleBriefInput).join('\n\n');

  try {
    const systemPrompt = await getDailyNewsSynopsisPrompt();
    let aiResponse,readerReview,feedback='';
    for(let attempt=0;attempt<2;attempt++){
      try{
        aiResponse=await callOpenAIAndProcessResult(systemPrompt,combinedContent+(feedback ? '\nRequired corrections to the previous draft (editing feedback, not news facts): '+feedback:''),'gpt-5-mini',5000,'json_object');
        readerReview=await reviewNewsReaderCopy(openai,{source:combinedContent,copy:aiResponse,daily:true});
        if(readerReview.accepted)break;feedback=readerReview.issues.join('; ');
      }catch(error){feedback=error.message;readerReview={accepted:false};}
    }
    if(!readerReview?.accepted)throw new Error('Daily brief failed automatic source/Scripture/audience checks: '+feedback);
    if (aiResponse && (aiResponse.synopsis || aiResponse.scripture || aiResponse.thought_to_remember || aiResponse.prayer)) {
      const payload = {
        synopsis: aiResponse.synopsis || null,
        details: aiResponse.details,
        stories: aiResponse.stories,
        scripture: aiResponse.thought_to_remember || aiResponse.scripture || null,
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
        await logEvent('error', 'backend', null, 'save_daily_news_synopsis', 'Failed to save daily news synopsis', { error: insertError.message }, Date.now() - startTime);
        throw insertError;
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
    throw err;
  }
}

module.exports = { generateDailyNewsSynopsisFromLast24h };

if (require.main === module) {
  generateDailyNewsSynopsisFromLast24h().catch(error=>{console.error(error.message);process.exitCode=1;});
}
