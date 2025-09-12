// backend/cron/generateScripturalOutlook.js

// Import necessary packages
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');

// Initialize Supabase client for a Node.js environment
// Replace with your Supabase URL and service role key
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// --- Backend API Functions ---

// Placeholder for your AI generation function
async function generateContent(endpoint, data) {
    // This function should call your AI provider (e.g., OpenAI, Gemini)
    // using the Node.js client library.
    // For this example, we'll return a mock response.
    console.log(`Calling AI endpoint: ${endpoint} with data:`, data);
    return { 
        ai_outlook: JSON.stringify({
            mainMessage: "In a world of constant change and uncertainty, this story reminds us that our true hope is not found in temporary circumstances or human solutions, but in the unwavering promises of God.",
            scriptureReference: "Hebrews 6:19",
            reflectionQuestions: [
                "Where are you placing your hope and trust in a world that is always in flux?",
                "How can the promises of scripture provide a firm anchor for your soul in times of uncertainty?"
            ],
            closingPrayer: "Lord, help us to anchor our souls in You, our steadfast and faithful hope. Amen."
        })
    };
}

// Function to save the outlook to the database
async function saveScripturalOutlook(outlook) {
    const { data, error } = await supabase
        .from('scriptural_outlooks')
        .insert([outlook]);

    if (error) {
        console.error('Error saving scriptural outlook:', error);
        return null;
    }
    return data[0];
}

// --- Main Cron Job Function ---

// Updated to fetch the top 3 news stories
async function fetchTopNewsStories(limit = 3) {
    const rssFeedUrl = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

    try {
        const response = await axios.get(rssFeedUrl);
        const xml = response.data;

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xml);
        
        const items = result.rss.channel[0].item;
        
        if (!items || items.length === 0) {
            console.error('No articles found in RSS feed.');
            return [];
        }

        const newsStories = items.slice(0, limit).map(item => {
            const title = item.title[0];
            const link = item.link[0];
            
            const response = axios.get(link, { maxRedirects: 5 });
            const html = response.data;
            const $ = cheerio.load(html);

            // get all paragraphs and join them
            const paragraphs = $('p').map((i, el) => $(el).text()).get();
            const articleBody = paragraphs.join('\n\n');

            return { title, url: link, body: articleBody };
        });

        return newsStories;
    } catch (err) {
        console.error('Error fetching and parsing RSS feed:', err);
        return [];
    }
}

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

async function generateAndSaveScripturalOutlook() {
  console.log('Starting scriptural outlook generation cron job...');

  const articles = await fetchTopNewsStories();
  if (articles.length === 0) {
    console.error('Failed to get any news articles. Exiting.');
    return;
  }
  
  // Iterate through each of the top articles
  for (const article of articles) {
    const promptInput = `Article Title: ${article.title}\nArticle Body: ${article.body}`;

    try {
      // Call the AI function with the prompt and content for the current article
      const aiResponse = await generateContent('/generate-outlook', { prompt: promptInput });
      
      if (aiResponse && aiResponse.ai_outlook) {
        const outlook = {
          article_url: article.url,
          article_title: article.title,
          article_body: article.body,
          ai_outlook: JSON.parse(aiResponse.ai_outlook) // Assuming AI returns a JSON string
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