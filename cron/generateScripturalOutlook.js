// backend/cron/generateScripturalOutlook.js

// Import necessary packages
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const OpenAI = require('openai'); // Use the v4 client
const { GoogleGenAI } = require('@google/genai');
const puppeteer = require('puppeteer');
const { logEvent } = require('../utils/helpers');

require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const gemini = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
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
            max_completion_tokens: maxTokens,
            response_format: { type: responseFormatType },
        });

        let generatedContent = chatCompletion.choices[0].message.content;
        generatedContent.tokens = chatCompletion.usage.total_tokens;
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

// Function to generate image using Gemini
async function generateImage(prompt) {
    const startTime = Date.now();
    try {
        console.log('Generating image with prompt:', prompt.substring(0, 50) + '...');
        const response = await gemini.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [
                {
                    role: 'user',
                    parts: [{ text: prompt }],
                }
            ],
        });

        const parts = response?.candidates?.[0]?.content?.parts || response?.content?.parts || [];
        let imageUrl = null;
        let imageBase64 = null;
        let imageMimeType = null;

        for (const part of parts) {
            if (part?.inlineData?.data) {
                imageBase64 = part.inlineData.data;
                imageMimeType = part.inlineData.mimeType || 'image/png';
                break;
            }
            if (part?.fileData?.fileUri) {
                imageUrl = part.fileData.fileUri;
                imageMimeType = part.fileData.mimeType || null;
                break;
            }
        }

        if (!imageUrl && !imageBase64) {
            throw new Error('Gemini response did not include image data.');
        }

        console.log('Image generated:', imageUrl ? imageUrl : 'inline data');
        logEvent(
            'ai',
            'backend',
            null,
            'generate_scriptural_outlook',
            'Successfully generated image',
            { tokens: response?.usageMetadata?.totalTokenCount },
            Date.now() - startTime
        );
        return { url: imageUrl, base64: imageBase64, mimeType: imageMimeType };
    } catch (error) {
        console.error("Error generating image:", error);
        logEvent('error', 'backend', null, 'generate_scriptural_outlook', 'Error generating image', { error: error.message }, Date.now() - startTime);  
        return null;
    }
}

// Function to upload image from URL or base64 to Supabase Storage
async function uploadImageToSupabase(imageInput, bucketName, path) {
    try {
        let buffer = null;
        let contentType = 'image/png';

        if (typeof imageInput === 'string') {
            const response = await axios.get(imageInput, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data, 'binary');
            contentType = response.headers?.['content-type'] || contentType;
        } else if (imageInput && imageInput.base64) {
            buffer = Buffer.from(imageInput.base64, 'base64');
            contentType = imageInput.mimeType || contentType;
        } else if (imageInput && imageInput.url) {
            const response = await axios.get(imageInput.url, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data, 'binary');
            contentType = response.headers?.['content-type'] || imageInput.mimeType || contentType;
        }

        if (!buffer) {
            throw new Error('No image data provided for upload.');
        }

        // 2. Upload to Supabase
        const { data, error } = await supabase
            .storage
            .from(bucketName)
            .upload(path, buffer, {
                contentType: contentType,
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
        .upsert([
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

// Function to fetch the top 6 news stories (logic remains the same)
async function fetchTopNewsStories(limit = 24) {
  console.log('Fetching top news stories...');
  const startTime = Date.now();
    const rssFeedUrls = [
        'https://feeds.npr.org/1001/rss.xml',
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
    logEvent('info', 'backend', null, 'fetch_top_news_stories', `Fetched ${newsStories.length} articles`, {}, Date.now() - startTime);
    return newsStories;
}
// Daily News Synopsis moved to cron/dailyNewsSynopsis.js

// Function to fetch the scriptural outlook prompt from Supabase
async function getScripturalOutlookPrompt() {
    const { data, error } = await supabase
        .from('system_prompts')
        .select('content')
        .eq('key', 'news_generator')
        .single();

    if (error) {
        console.error('Error fetching news_generator prompt from system_prompts:', error);
        throw new Error('Failed to fetch system prompt');
    }

    if (!data || !data.content) {
        throw new Error('news_generator prompt not found in system_prompts table');
    }

    return data.content;
}

// Prompt for Taxonomy Breakdown and Image Generation
const taxonomy_breakdown_prompt = `
# ROLE
You are a theological artist and analyst for a Christian News app.

# TASK
1.  **Analyze**: Consider the provided Topic or Category name and the synopses of recent articles associated with it.
2.  **Breakdown**: Provide a "Current Scriptural Breakdown": How does this specific topic/category relate to current events (based on the provided synopses) and biblical truth right now? (2-3 sentences).
3.  **Image Prompt**: Create a prompt for an image generation model (DALL-E) that represents this topic, influenced by the themes in the recent articles. If the image subject is a person, ensure the prompt captures their likeness accurately.
    * **Style**: photorealistic Journalistic photograph, fit to be used as a news article image. If using a real person, feel free to change the style to more of a satirical approach where they can be more like a political cartoon.  
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
                .eq(idColumn, id)
                //and created_at within last 30 days
                .gte('created_at', new Date(Date.now() - 15*24*60*60*1000).toISOString());
            
            if (error) {
                console.error(`Error counting ${type} ${id}:`, error);
                continue;
            }

            console.log(`${type} ${id} has count: ${count}`);

            // 2. Threshold Check > 10
            if (count > 10) {
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
                    'gpt-5-mini', 
                    2000, 
                    'json_object'
                );

                if (aiResponse && aiResponse.scriptural_breakdown && aiResponse.image_prompt) {
                    // 4. Generate Image
                    const imageResult = await generateImage(aiResponse.image_prompt);
                    
                    if (imageResult) {
                        // 5. Upload to Supabase
                        const storagePath = `taxonomy/${type}/${id}_${Date.now()}.png`;
                        const publicUrl = await uploadImageToSupabase(imageResult, bucketName, storagePath);

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
    const startTime = Date.now();
  const articles = await fetchTopNewsStories();
  if (articles.length === 0) {
    console.error('Failed to get any news articles. Exiting.');
    return;
  }
    // Daily news synopsis generation moved to separate cron job.
  
  // Fetch all existing categories and topics for the AI prompt
  const existingTaxonomies = await fetchExistingTaxonomies();
  
  // Fetch the prompt from Supabase
  const outlookPrompt = await getScripturalOutlookPrompt();

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
existingTaxonomies.categories, existingTaxonomies.topics
    const promptInput = `Article Title: ${article.title}\nArticle Body: ${article.body}\nArticle Description: ${article.description}\nExisting Topics: ${existingTaxonomies.categories}\nExisting Topics: ${existingTaxonomies.topics}`;
    try {
      // Call the AI function with the prompt and content for the current article
      const aiResponse = await callOpenAIAndProcessResult(outlookPrompt, promptInput, 'gpt-5-mini', 5000, 'json_object');
      
      if (aiResponse && typeof aiResponse === 'object') {
        
        // 1. Save the core outlook and get its ID
        const outlook = {
            article_title: aiResponse.title,
            article_url: article.url,
            article_body: article.body,
            article_thumbnail_url: article.thumbnail_url,
            publish_date: article.publish_date,
            ai_outlook: aiResponse // Full AI content
        };
        console.log('AI response processed for article:', article.title, aiResponse);
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
        logEvent('ai', 'backend', null, 'generate_scriptural_outlook', `Processed article: ${article.title}`, { tokens: aiResponse.tokens }, Date.now() - startTime);
        
      } else {
        console.error('AI response did not contain expected JSON structure.');
      }
    } catch (error) {
      console.error('Error during AI content generation/saving:', error);
      logEvent('error', 'backend', null, 'generate_scriptural_outlook', 'Error during AI content generation/saving', { error: error.message }, Date.now() - startTime);
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