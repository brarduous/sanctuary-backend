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

function slugify(text) {
    return (text || '')
        .toString()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

async function generateUniqueSlug(tableName, baseText) {
    const base = slugify(baseText);
    if (!base) return null;
    let candidate = base;
    let counter = 2;
    while (true) {
        const { data, error } = await supabase
            .from(tableName)
            .select('id')
            .eq('slug', candidate)
            .limit(1);
        if (error) {
            // If we cannot check, fallback to base
            return candidate;
        }
        if (!data || data.length === 0) return candidate;
        candidate = `${base}-${counter}`.slice(0, 120);
        counter++;
    }
}

// Function to generate image using DALL-E 3
async function generateImage(prompt) {
    try {
        console.log('Generating image with prompt:', prompt.substring(0, 50) + '...');
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1792x1024",
            response_format: "url", // We get a URL, then download it
        });
        console.log('Image generated:', response.data[0].url);
        return response.data[0].url;
    } catch (error) {
        console.error("Error generating image:", error);
        return null;
    }
}

// Function to upload image from URL to Supabase Storage
async function uploadImageToSupabase(imageUrl, bucketName, path) {
    try {
        // 1. Download image as ArrayBuffer
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // 2. Upload to Supabase
        const { data, error } = await supabase
            .storage
            .from(bucketName)
            .upload(path, buffer, {
                contentType: 'image/png',
                upsert: true
            });

        if (error) throw error;

        // 3. Get Public URL
        const { data: publicData } = supabase
            .storage
            .from(bucketName)
            .getPublicUrl(path);

        return publicData.publicUrl;
    } catch (error) {
        console.error(`Error uploading image to Supabase (${path}):`, error);
        return null;
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
    // Ensure unique slug for taxonomy
    insertData.slug = await generateUniqueSlug(tableName, name);

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
                publish_date: outlook.publish_date,
                slug: await generateUniqueSlug('scriptural_outlooks', outlook.article_title),
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

// Function to fetch the top 10 news stories (logic remains the same)
async function fetchTopNewsStories(limit = 10) {
  console.log('Fetching top news stories...');
    const rssFeedUrls = [
        'https://www.cbsnews.com/latest/rss/main',
        'https://moxie.foxnews.com/google-publisher/latest.xml',
    ];
    
    const newsStories = [];
    const parser = new xml2js.Parser();
    
    // First, fetch all feeds and store their items
    const feedItems = [];
    for (const rssFeedUrl of rssFeedUrls) {
        try {
            console.log(`Fetching articles from: ${rssFeedUrl}`);
            const response = await axios.get(rssFeedUrl);
            const xml = response.data;

            const result = await parser.parseStringPromise(xml);
            
            const items = result.rss.channel[0].item;
            console.log(`Fetched ${items.length} articles from RSS feed: ${rssFeedUrl}`);
            if (!items || items.length === 0) {
                console.warn(`No articles found in RSS feed: ${rssFeedUrl}`);
                feedItems.push([]);
            } else {
                feedItems.push(items);
            }
        } catch (err) {
            console.error(`Error fetching and parsing RSS feed ${rssFeedUrl}:`, err);
            feedItems.push([]); // Add empty array for failed feeds
        }
    }
    
    // Round-robin through feeds to get one article from each until limit is reached
    let currentIndex = 0;
    const feedIndices = feedItems.map(() => 0); // Track current position in each feed
    
    while (newsStories.length < limit) {
        let allFeedsExhausted = true;
        
        // Try to get one article from each feed in round-robin fashion
        for (let i = 0; i < feedItems.length && newsStories.length < limit; i++) {
            const feedIndex = (currentIndex + i) % feedItems.length;
            const items = feedItems[feedIndex];
            const itemIndex = feedIndices[feedIndex];
            
            if (itemIndex < items.length) {
                allFeedsExhausted = false;
                const item = items[itemIndex];
                feedIndices[feedIndex]++;
                
                const title = item.title[0];
                const link = item.link[0];

                // Skip obvious video links early to avoid extra work
                if ((link || '').toLowerCase().includes('/video/')) {
                    console.log(`Skipping video article (link contains /video/): ${title}`);
                    continue;
                }

                // Check if URL exists in DB to avoid expensive Puppeteer call
                const { data: existingArticle } = await supabase
                    .from('scriptural_outlooks')
                    .select('id')
                    .eq('article_url', link)
                    .single();
                
                if (existingArticle) {
                    console.log(`Skipping existing article (URL match): ${title}`);
                    continue;
                }

                console.log(`Processing article: ${title} - ${link}`);
                const description = item.description? item.description[0] : '';
                const publish_date = item.pubDate ? item.pubDate[0] : null; // RSS pubDate
                let thumbnail_url = item['media:thumbnail'] ? item['media:thumbnail'][0].$.url : null;
                
                // Note: Puppeteer setup remains the same as previously defined
                const browser = await puppeteer.launch();
                const page = await browser.newPage();
                // Set a user agent to mimic a real browser to avoid being blocked
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                await page.goto(link, {waitUntil: 'domcontentloaded', timeout: 30000});
               
                const final_url = await page.url();
                await browser.close();

                // Skip if the resolved URL is a video page
                if ((final_url || '').toLowerCase().includes('/video/')) {
                    console.log(`Skipping video article (final URL contains /video/): ${title}`);
                    continue;
                }

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
                    
                    const article = { title: title, url: final_url, thumbnail_url:thumbnail_url, body: articleBody, description: description, publish_date };
                    newsStories.push(article);
                }catch(err){
                  console.error(`Error fetching or parsing article at ${link}:`, err);
                  continue;
                }
            }
        }
        
        // If all feeds are exhausted, break out of the loop
        if (allFeedsExhausted) {
            break;
        }
        
        currentIndex = (currentIndex + 1) % feedItems.length;
    }
    
    console.log(`Total articles fetched: ${newsStories.length}`);
    return newsStories;
}
// Daily News Synopsis moved to cron/dailyNewsSynopsis.js

// The updated AI prompt for generating the scriptural outlook
const scriptural_outlook_prompt = (existingCategories, existingTopics) => `
# ROLE & GOAL
You are a helpful theological pastoral advisor for a Christian app. Your primary task is to read a news article and generate an insightful and unflinchingly honest outlook on it through the lens of scripture. Your goal is to provide a spiritual perspective to help the user understand how to view the news through the lens of scripture and christian virtues. But through the lens of scripture, this should be a gauge of the news stories' scriptural temperature. How does the article stack up against biblical truth?

# INSTRUCTIONS
You will be provided with the title and body of a news article, and a list of existing categories and topics.
1.  **Categorization/Topic Selection**: Identify 1 to 3 categories and 1 to 5 topics that accurately describe the article. Use categories and topics from the existing lists provided if and only if they fit well. The category should be broad (e.g., "Politics", "Health", "Religion") while topics should be more specific, and the subject (person, place or thing) of the article (e.g., "Donald Trump", "COVID-19", "New York").
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
    - **name**: The canonical category name.
    - **description**: A brief description **only** if this is a genuinely *new* category.
- **topics**: An array of 1 to 5 objects.
    - **name**: The canonical topic name.
    - **description**: A brief description **only** if this is a genuinely *new* topic.
- **synopsis**: An overview of the key points of the article.
- **outlook**: The Christian takeaway.
- **scriptureReference**: A single, relevant scripture reference.
- **reflectionQuestions**: A list of 1-3 questions.
- **closingPrayer**: A short, topical prayer.

--- USER INPUT ---
Article Title: [INSERT_ARTICLE_TITLE]
Article Body: [INSERT_ARTICLE_BODY]
`;

// Prompt for Taxonomy Breakdown and Image Generation
const taxonomy_breakdown_prompt = `
# ROLE
You are a theological artist and analyst for a Christian News app.

# TASK
1.  **Analyze**: Consider the provided Topic or Category name and the synopses of recent articles associated with it.
2.  **Breakdown**: Provide a "Current Scriptural Breakdown": How does this specific topic/category relate to current events (based on the provided synopses) and biblical truth right now? (2-3 sentences).
3.  **Image Prompt**: Create a prompt for an image generation model (DALL-E) that represents this topic, influenced by the themes in the recent articles. If the image subject is a person, ensure the prompt captures their likeness accurately.
    * **Style**: photorealistic Journalistic photograph, fit to be used as a news article image.  
    * **Constraint**: no text should be added to the image whatsoever.

# JSON OUTPUT STRUCTURE
{
  "scriptural_breakdown": "string",
  "image_prompt": "string"
}
`;

// generateDailyNewsSynopsis moved to cron/dailyNewsSynopsis.js

// Function to process thresholds for taxonomies
async function processTaxonomyThresholds(categoryIds, topicIds) {
    console.log('Processing taxonomy thresholds...');
    const bucketName = 'Sanctuary News Images'; // Ensure this bucket exists in Supabase Storage

    // Helper to process a single type (category or topic)
    const processItems = async (ids, type) => {
        const table = type === 'category' ? 'categories' : 'topics';
        const relationTable = type === 'category' ? 'outlook_categories' : 'outlook_topics';
        const idColumn = type === 'category' ? 'category_id' : 'topic_id';

        for (const id of ids) {
            // 1. Count articles for this ID
            const { count, error } = await supabase
                .from(relationTable)
                .select('*', { count: 'exact', head: true })
                .eq(idColumn, id);
            
            if (error) {
                console.error(`Error counting ${type} ${id}:`, error);
                continue;
            }

            console.log(`${type} ${id} has count: ${count}`);

            // 2. Threshold Check > 5
            if (count > 5) {
                // Fetch the name and updated_at for the prompt
                const { data: item } = await supabase.from(table).select('name, updated_at, image_url').eq('id', id).single();
                if (!item) continue;

                // Check if updated within the last week
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                
                if (item.image_url && item.updated_at && new Date(item.updated_at) > oneWeekAgo) {
                    console.log(`Taxonomy ${type} ${item.name} updated recently (within 7 days). Skipping asset generation.`);
                    continue;
                }

                console.log(`Threshold met for ${type}: ${item.name}. Generating spiritual assets...`);

                // Fetch latest 5 articles' synopses
                const { data: recentArticles, error: articlesError } = await supabase
                    .from(relationTable)
                    .select(`
                        outlook_id,
                        scriptural_outlooks (
                            ai_outlook
                        )
                    `)
                    .eq(idColumn, id)
                    .order('id', { ascending: false })
                    .limit(5);

                if (articlesError) {
                    console.error(`Error fetching recent articles for ${type} ${id}:`, articlesError);
                    continue;
                }

                const synopses = recentArticles
                    .map(r => r.scriptural_outlooks?.ai_outlook?.synopsis)
                    .filter(s => s)
                    .join('\n\n');

                // 3. Generate Breakdown & Image Prompt
                const aiResponse = await callOpenAIAndProcessResult(
                    `Topic/Category Name: ${item.name}\n\nRecent Article Synopses:\n${synopses}\n` + taxonomy_breakdown_prompt, 
                    `Topic/Category Name: ${item.name}\n\nRecent Article Synopses:\n${synopses}`, 
                    'gpt-4.1-2025-04-14', 
                    2000, 
                    'json_object'
                );

                if (aiResponse && aiResponse.scriptural_breakdown && aiResponse.image_prompt) {
                    // 4. Generate Image
                    const imageUrl = await generateImage(aiResponse.image_prompt);
                    
                    if (imageUrl) {
                        // 5. Upload to Supabase
                        const storagePath = `taxonomy/${type}/${id}_${Date.now()}.png`;
                        const publicUrl = await uploadImageToSupabase(imageUrl, bucketName, storagePath);

                        if (publicUrl) {
                            // 6. Update Database Record
                            const { error: updateError } = await supabase
                                .from(table)
                                .update({
                                    scriptural_breakdown: aiResponse.scriptural_breakdown,
                                    image_url: publicUrl,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', id);
                            
                            if (updateError) {
                                console.error(`Error updating ${type} ${id}:`, updateError);
                            } else {
                                console.log(`Successfully updated ${type} ${item.name} with new assets.`);
                            }
                        }
                    }
                }
            }
        }
    };

    // Process sets
    if (categoryIds.size > 0) await processItems(categoryIds, 'category');
    if (topicIds.size > 0) await processItems(topicIds, 'topic');
}

async function generateAndSaveScripturalOutlook() {
  console.log('Starting scriptural outlook generation cron job...');

  const articles = await fetchTopNewsStories();
  if (articles.length === 0) {
    console.error('Failed to get any news articles. Exiting.');
    return;
  }
    // Daily news synopsis generation moved to separate cron job.
  
  // Fetch all existing categories and topics for the AI prompt
  const existingTaxonomies = await fetchExistingTaxonomies();
  const outlookPrompt = scriptural_outlook_prompt(existingTaxonomies.categories, existingTaxonomies.topics);

  // Sets to track which IDs we touched this run
  const touchedCategoryIds = new Set();
  const touchedTopicIds = new Set();

  // Iterate through each of the top articles
  for (const article of articles) {
    // Check if article already exists in database
    const { data: existingArticle, error: checkError } = await supabase
        .from('scriptural_outlooks')
        .select('id')
        .eq('article_url', article.url)
        .single();

    if (checkError && checkError.code !== 'PGRST116') {
        console.error(`Error checking for existing article ${article.url}:`, checkError);
    }

    if (existingArticle) {
        console.log(`Article already exists in database, skipping: ${article.title}`);
        continue;
    }

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
            publish_date: article.publish_date,
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
                    touchedCategoryIds.add(categoryId); // Track ID
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
                    touchedTopicIds.add(topicId); // Track ID
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

  // After all articles are processed, check thresholds for touched taxonomies
  await processTaxonomyThresholds(touchedCategoryIds, touchedTopicIds);
  console.log('Cron job completed.');
}

// You can export this function to be used by your cron job scheduler
module.exports = {
  generateAndSaveScripturalOutlook
};

// If you want to run this script directly (for testing), uncomment the line below
generateAndSaveScripturalOutlook();