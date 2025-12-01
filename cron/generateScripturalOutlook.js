// backend/cron/generateScripturalOutlook.js

// Import necessary packages
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const OpenAI = require('openai'); // Use the v4 client
const puppeteer = require('puppeteer');

require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Supabase client for a Node.js environment
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// --- Helper Functions ---

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

// Function to fetch all existing topics and categories for the AI prompt
async function fetchExistingTaxonomies() {
    const { data: topics, error: topicsError } = await supabase
        .from('topics')
        .select('name');
    const { data: categories, error: categoriesError } = await supabase
        .from('categories')
        .select('name');

    if (topicsError) console.error('Error fetching existing topics:', topicsError);
    if (categoriesError) console.error('Error fetching existing categories:', categoriesError);

    return {
        topics: topics ? topics.map(t => t.name) : [],
        categories: categories ? categories.map(c => c.name) : [],
    };
}

// Function to handle upsert/retrieval of a single taxonomy item
async function getOrCreateTaxonomy(tableName, name, description) {
    // 1. Check if the taxonomy already exists
    let { data: existing, error: fetchError } = await supabase
        .from(tableName)
        .select('id')
        .eq('name', name)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 means 'No rows found', which is expected if new
        console.error(`Error checking existence in ${tableName} for ${name}:`, fetchError);
        return null;
    }

    if (existing) {
        return existing.id; // Return existing ID
    }

    // 2. If it doesn't exist, insert the new one
    const insertData = { name };
    if (description) {
        insertData.description = description;
    }

    const { data: newTaxonomy, error: insertError } = await supabase
        .from(tableName)
        .insert(insertData)
        .select('id')
        .single();

    if (insertError) {
        // Handle potential race condition (another process inserted it just now)
        if (insertError.code === '23505') { // 23505 is unique violation error code
             console.warn(`Race condition detected for ${tableName} ${name}, fetching existing ID.`);
             let { data: raced, error: racedFetchError } = await supabase
                .from(tableName)
                .select('id')
                .eq('name', name)
                .single();
             if (racedFetchError) {
                 console.error(`Error after race condition fetch in ${tableName}:`, racedFetchError);
                 return null;
             }
             return raced.id;
        }
        console.error(`Error inserting new ${tableName} ${name}:`, insertError);
        return null;
    }

    return newTaxonomy.id; // Return new ID
}

// Function to save the outlook to the database
async function saveScripturalOutlook(outlook) {
  console.log('Saving scriptural outlook to the database...');
    // We only upsert the core outlook data here, relationships are handled separately
    const { data, error } = await supabase
        .from('scriptural_outlooks')
        .insert([
            {
                article_url: outlook.article_url,
                article_title: outlook.article_title,
                article_body: outlook.article_body,
                article_thumbnail_url: outlook.article_thumbnail_url,
                ai_outlook: outlook.ai_outlook // Full AI content including message, prayer, etc.
            }
        ])
        .select('id')
        .single(); // Assuming article_url is unique or primary key

    if (error) {
        // If article_url is not unique, this will insert duplicates.
        // Assuming no conflict resolution here, but you should configure the table correctly.
        console.error('Error saving scriptural outlook:', error);
        return null;
    }
    return data;
}

// Function to fetch the top 15 news stories (logic remains the same)
async function fetchTopNewsStories(limit = 15) {
  console.log('Fetching top news stories...');
    const rssFeedUrl = 'https://www.cbsnews.com/latest/rss/main';

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
        let i=0;
        while(i<limit && i<items.length) 
          {
            let item = items[i];
            const title = item.title[0];
            const link = item.link[0];
            const description = item.description[0];
            let thumbnail_url = item['media:thumbnail'] ? item['media:thumbnail'][0].$.url : null;
            
            // Note: Puppeteer setup remains the same as previously defined
            const browser = await puppeteer.launch();
            const page = await browser.newPage();
            // Set a user agent to mimic a real browser to avoid being blocked
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await page.goto(link, {waitUntil: 'domcontentloaded', timeout: 30000});
           
            const final_url = await page.url();
            await browser.close();


            try{
            const response = await axios.get(final_url);
            console.log(`Fetched article content from: ${final_url}`);
            const html = await response.data;

            const $ = await cheerio.load(html);

            //get media image from meta tag if thumbnail_url is null
            if(!thumbnail_url){
              const metaImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
              if(metaImage){
                thumbnail_url = metaImage;
              }
              console.log(`Fetched thumbnail URL from meta tag: ${thumbnail_url}`);
            }
            
            // get all paragraphs and join them
            const paragraphs = $('p');
            const paragraphText = [];
            paragraphs.each(
              (i, el) => {
                paragraphText.push( $(el).text() );
              });
            const articleBody = paragraphText.join('\n\n');
            
            
            const article = { title: title, url: final_url, thumbnail_url:thumbnail_url, body: articleBody, description: description };
             newsStories.push(article);
             i++;
            }catch(err){
              console.error(`Error fetching or parsing article at ${link}:`);
              continue;
            }
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

// The updated AI prompt for generating the scriptural outlook
const scriptural_outlook_prompt = (existingCategories, existingTopics) => `
# ROLE & GOAL
You are a helpful theological pastoral advisor for a Christian app. Your primary task is to read a news article and generate an insightful and unflinchingly honest outlook on it through the lens of scripture. Your goal is to provide a spiritual perspective to help the user understand how to view the news through the lens of scripture and christian virtues. But through the lens of scripture, this should be a gauge of the news stories' scriptural temperature. How does the article stack up against biblical truth?

# INSTRUCTIONS
You will be provided with the title and body of a news article, and a list of existing categories and topics.
1.  **Categorization/Topic Selection**: Identify 1 to 3 categories and 1 to 5 topics that accurately describe the article.
2.  **Canonical Naming**: For each category or topic, check the provided lists. If the concept already exists (e.g., "President Trump" should map to "Trump"), use the *canonical existing name*. If the concept is truly new or significantly different, create a concise new name and provide a brief description.
3.  **Synopsis**: Provide a thorough summary of the key points of the article without spiritual analysis.  
4.  **Outlook**: Provide the Scriptural takeaway or how this news story stacks up against biblical truth. Use a critical approach, analyzing the intentions and impacts of the people and events described in the article through a biblical lens.
5. **Scripture Reference**: Provide a single, relevant scripture reference that ties into the main message, if applicable (e.g., "Proverbs 3:5-6"). Include, if possible, the full text of the scripture.
6. **Reflection Questions**: Provide 1 to 3 brief, thought-provoking questions for personal reflection based on the article and its scriptural implications.
7. **Closing Prayer**: Write a short, topical prayer related to the news event and biblical truth.

--- EXISTING TAXONOMY CONTEXT ---
Existing Categories: ${existingCategories.join(', ') || 'None'}
Existing Topics: ${existingTopics.join(', ') || 'None'}

--- JSON OUTPUT STRUCTURE ---
Your final response should be a JSON object that strictly follows this structure.

- **categories**: An array of 1 to 3 objects.
    - **name**: The canonical category name (use an existing name from the list if possible).
    - **description**: A brief description **only** if this is a genuinely *new* category not covered by the existing list, otherwise use null.
- **topics**: An array of 1 to 5 objects.
    - **name**: The canonical topic name (use an existing name from the list if possible, e.g., use "Trump" instead of "President Trump").
    - **description**: A brief description **only** if this is a genuinely *new* topic not covered by the existing list, otherwise use null.
- **synopsis**: An overview of the key points of the article without spiritual analysis 
- **outlook**: The Christian takeaway or how this news story stacks up against biblical truth.
- **scriptureReference**: A single, relevant scripture reference, if applicable (e.g., "Proverbs 3:5-6"). Include, if possible, the full text of the scripture.
- **reflectionQuestions**: A list of one to three brief, thought-provoking questions for personal reflection.
- **closingPrayer**: A short, topical prayer related to the news event and biblical truth.

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
  
  // Fetch all existing categories and topics for the AI prompt
  const existingTaxonomies = await fetchExistingTaxonomies();
  const outlookPrompt = scriptural_outlook_prompt(existingTaxonomies.categories, existingTaxonomies.topics);

  // Iterate through each of the top articles
  for (const article of articles) {
    const promptInput = `Article Title: ${article.title}\nArticle Body: ${article.body}\nArticle Description: ${article.description}\n\n`;
    try {
      // Call the AI function with the prompt and content for the current article
      const aiResponse = await callOpenAIAndProcessResult(outlookPrompt, promptInput, 'gpt-4.1-2025-04-14', 5000, 'json_object');
      
      if (aiResponse && typeof aiResponse === 'object') {
        
        // 1. Save the core outlook and get its ID
        const outlook = {
            article_url: article.url,
            article_title: article.title,
            article_body: article.body,
            article_thumbnail_url: article.thumbnail_url,
            ai_outlook: aiResponse // Full AI content
        };

        const savedOutlook = await saveScripturalOutlook(outlook);

        if (!savedOutlook) {
            console.error('Failed to save core scriptural outlook. Skipping taxonomy steps.');
            continue;
        }

        const outlookId = savedOutlook.id;

        // 2. Process Categories
        if (aiResponse.categories && Array.isArray(aiResponse.categories)) {
            const categoryRelations = [];
            for (const cat of aiResponse.categories) {
                const categoryId = await getOrCreateTaxonomy('categories', cat.name, cat.description);
                if (categoryId) {
                    categoryRelations.push({ outlook_id: outlookId, category_id: categoryId });
                }
            }
            if (categoryRelations.length > 0) {
                const { error: relationError } = await supabase
                    .from('outlook_categories')
                    .insert(categoryRelations);
                if (relationError) console.error('Error inserting category relations:', relationError);
            }
        }

        // 3. Process Topics
        if (aiResponse.topics && Array.isArray(aiResponse.topics)) {
            const topicRelations = [];
            for (const tpc of aiResponse.topics) {
                const topicId = await getOrCreateTaxonomy('topics', tpc.name, tpc.description);
                if (topicId) {
                    topicRelations.push({ outlook_id: outlookId, topic_id: topicId });
                }
            }
            if (topicRelations.length > 0) {
                const { error: relationError } = await supabase
                    .from('outlook_topics')
                    .insert(topicRelations);
                if (relationError) console.error('Error inserting topic relations:', relationError);
            }
        }

        console.log(`Successfully processed outlook and taxonomies for: ${article.title}`);
        
      } else {
        console.error('AI response did not contain expected JSON structure.');
      }
    } catch (error) {
      console.error('Error during AI content generation/saving:', error);
    }
  }
}

// You can export this function to be used by your cron job scheduler
module.exports = {
  generateAndSaveScripturalOutlook
};

// If you want to run this script directly (for testing), uncomment the line below
generateAndSaveScripturalOutlook();