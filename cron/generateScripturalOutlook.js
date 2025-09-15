// backend/cron/generateScripturalOutlook.js

// Import necessary packages
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const OpenAI = require('openai'); // Use the v4 client
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Supabase client for a Node.js environment
// Replace with your Supabase URL and service role key
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// --- Backend API Functions ---

// Placeholder for your AI generation function
async function generateContent(systemPrompt, userPrompt) {
    const generatedResponse = callOpenAIAndProcessResult(systemPrompt, userPrompt, 'gpt-4.1-2025-04-14', 5000, 'json_object');
    // - **mainMessage**: A brief paragraph summarizing the spiritual takeaway or how this news story relates to a biblical principle.
    // - **scriptureReference**: A single, relevant scripture reference (e.g., "Proverbs 3:5-6"). Do not include the full text of the scripture.
    // - **reflectionQuestions**: A list of two to three brief, thought-provoking questions for personal reflection.
    // - **closingPrayer**: A short, topical prayer related to the news event and the biblical principle you highlighted.

  return generatedResponse;
}
// --- Helper function for making OpenAI API calls and parsing JSON ---
async function callOpenAIAndProcessResult(systemPrompt, userPrompt, model, maxTokens, responseFormatType = "text") {
    try {
       
        console.log(`Calling OpenAI model: ${model}`);
        const chatCompletion = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: maxTokens,
            temperature: 0.7, // Adjust creativity
            response_format: { type: responseFormatType },
        });

        let generatedContent = chatCompletion.choices[0].message.content;

        if (responseFormatType === "json_object") {
            try {
                return JSON.parse(generatedContent);
            } catch (jsonError) {
                console.warn("Failed to parse AI response as JSON. Returning raw text.", jsonError);
                return generatedContent; // Return raw text if parsing fails
            }
        }
        return generatedContent; // Return raw text for 'text' format
    } catch (error) {
        console.error("Error during OpenAI API call:", error);
        throw error;
    }
}
// Function to save the outlook to the database
async function saveScripturalOutlook(outlook) {
  console.log('Saving scriptural outlook to the database...', outlook);
    const { data, error } = await supabase
        .from('scriptural_outlooks')
        .upsert([outlook], { onConflict: 'article_url' })
       
        .select();

    if (error) {
        console.error('Error saving scriptural outlook:', error);
        return null;
    }
    return data[0];
}

// --- Main Cron Job Function ---

// Updated to fetch the top 3 news stories
async function fetchTopNewsStories(limit = 5) {
  console.log('Fetching top news stories...');
    const rssFeedUrl = 'https://abcnews.go.com/abcnews/usheadlines';

    try {
        const response = await axios.get(rssFeedUrl);
        const xml = response.data;

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xml);
        
        const items = await result.rss.channel[0].item;
        console.log(`Fetched ${items.length} articles from RSS feed.`);
        if (!items || items.length === 0) {
            console.error('No articles found in RSS feed.');
            return [];
        }

        const newsStories =  []; 
        const articles = await items.slice(0, limit);
        for(let i=0; i<limit; i++) 
          {
            let item = items[i];
            const title = item.title[0];
            const link = item.link[0];
            const description = item.description[0];
            const thumbnail_url = item['media:thumbnail'] ? item['media:thumbnail'][0].$.url : null;
            const response = await axios.get(link, { maxRedirects: 5 });
            const html = await response.data;

            const $ = await cheerio.load(html);

            //console.log($('title').text());
            //console.log($('meta[name="description"]').attr('content'));
            // get all paragraphs and join them
            const paragraphs = $('p');
            const paragraphText = [];
            paragraphs.each(
              (i, el) => {
                paragraphText.push( $(el).text() );
              });
            const articleBody = paragraphText.join('\n\n');
            
            
            const article = { title: title, url: link, thumbnail_url:thumbnail_url, body: articleBody, description: description };
             newsStories.push(article);
        };
        return await newsStories;
    } catch (err) {
        console.error('Error fetching and parsing RSS feed:', err);
        return [];
    }
}
// Daily News Synopsis Prompt
const daily_news_synopsis_prompt = `
# ROLE & GOAL
You are a helpful theological assistant for a Christian app. Your primary task is to read a set of news articles, and generate a synopsis for AI to digest. This will be fed back into the AI to generate a daily or weekly summaries of the news through a biblical lens. This goal is summaritive, not analytical or opinionated.
# INSTRUCTIONS
You will be provided with the titles and bodies of several news articles. You MUST adhere to the following structure for your response.
--- RESPONSE STRUCTURE ---
- **summary**: A brief summary that's easy to digest by AI.
Your final repsonse should be text only.`;

// The AI prompt for generating the scriptural outlook
const scriptural_outlook_prompt = `
# ROLE & GOAL
You are a helpful theological assistant for a Christian app. Your primary task is to read a news article and generate a brief, insightful, and inspiring outlook on it through the lens of scripture. Your goal is to provide a spiritual perspective, not to get into political or social commentary.

# INSTRUCTIONS
You will be provided with the title and body of a news article. You MUST adhere to the following structure for your response.

--- RESPONSE STRUCTURE ---
- **mainMessage**: A brief paragraph summarizing the spiritual takeaway or how this news story relates to a biblical principle.
- **scriptureReference**: A single, relevant scripture reference (e.g., "Proverbs 3:5-6"). Do not include the full text of the scripture.
- **reflectionQuestions**: A list of two to three brief, thought-provoking questions for personal reflection.
- **closingPrayer**: A short, topical prayer related to the news event and the biblical principle you highlighted.

Your final response should be a JSON object that strictly follows this structure.

--- USER INPUT ---
Article Title: [INSERT_ARTICLE_TITLE]
Article Body: [INSERT_ARTICLE_BODY]
`;
async function generateDailyNewsSynopsis(articles) {
  console.log('Generating daily news synopsis...');
  const combinedContent = articles.map((article, index) => {
    return `Article ${index + 1} Title: ${article.title}\nArticle ${index + 1} Body: ${article.body}\nArticle ${index + 1} Description: ${article.description}\n\n`;
  }).join('');
  try {
    const aiResponse = await callOpenAIAndProcessResult(daily_news_synopsis_prompt, combinedContent, 'gpt-4.1-2025-04-14', 5000, 'text');
    //save response to supabase daily_news_synopses table with synopsis field
    if (aiResponse) {
      const { data, error } = await supabase
        .from('daily_news_synopses')
        .insert([{ synopsis: aiResponse }])
        .select();
      if (error) {
        console.error('Error saving daily news synopsis:', error);
      } else {
        console.log('Successfully saved daily news synopsis:', data[0]);
      }
    } else {
      console.error('AI response did not contain synopsis content.');
    }
  } catch (error) {
    console.error('Error generating daily news synopsis:', error);
    
  }
}
async function generateAndSaveScripturalOutlook() {
  console.log('Starting scriptural outlook generation cron job...');

  const articles = await fetchTopNewsStories();
  if (articles.length === 0) {
    console.error('Failed to get any news articles. Exiting.');
    return;
  }
  generateDailyNewsSynopsis(articles);
  // Iterate through each of the top articles
  for (const article of articles) {
    const promptInput = `Article Title: ${article.title}\nArticle Body: ${article.body}\nArticle Description: ${article.description}\n\n`;
    try {
      // Call the AI function with the prompt and content for the current article
      const aiResponse = await generateContent(scriptural_outlook_prompt, promptInput);
      if (aiResponse) {
        const outlook = {
          article_url: article.url,
          article_title: article.title,
          article_body: article.body,
          article_thumbnail_url: article.thumbnail_url,
          ai_outlook: aiResponse 
        };
        
        const savedData = await saveScripturalOutlook(outlook);
        
        if (savedData) {
          console.log('Successfully saved scriptural outlook:', savedData);
        } else {
          console.error('Failed to save scriptural outlook to the database.');
        }
      } else {
        console.error('AI response did not contain outlook content.');
      }
    } catch (error) {
      console.error('Error during AI content generation:', error);
    }
  }
}

// You can export this function to be used by your cron job scheduler
module.exports = {
  generateAndSaveScripturalOutlook
};

// If you want to run this script directly (for testing), uncomment the line below
generateAndSaveScripturalOutlook();