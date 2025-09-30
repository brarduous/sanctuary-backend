// index.js
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // Use the v4 client
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { sample_sermons } = require('./vars');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Supabase Client Initialization ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// --- OpenAI Client Initialization ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- AI Prompts (from your openai.tsx) ---
// Define these prompts here as they are used by the backend.
// sermon_prompt: From openai.tsx
const sermon_prompt = `
# ROLE & GOAL
You are a helpful theological assistant for the "Sanctuary" app, an AI-powered Christian Life engagement Coach. Your primary task is to generate a complete sermon tailored to the specific preferences of a Christian leader, who may be a pastor, minister, or layperson. The sermon should be a tool to help them in their ministry and in guiding their congregation on their Christian journey.

# INSTRUCTIONS
You will be provided with a starting point (like a scripture or topic) and a set of detailed user preferences below. You MUST adhere to all preferences to generate a cohesive and highly tailored sermon.

--- USER PREFERENCES & STYLE DEFINITIONS ---

### 1. Starting Point
- **Input:** [INSERT SCRIPTURE OR TOPIC HERE]

### 2. Preaching Style
- **preachingStyle:** [INSERT PREACHING STYLE HERE]
- **Style Definitions (for your reference):**
    - **Expository:** The sermon's main points, structure, and sub-points must be drawn directly from the provided scripture passage. Your goal is to explain the text's original meaning and then apply it methodically.
    - **Topical:** The sermon should be built around the provided topic. Bring together multiple scriptures from different parts of the Bible to build a comprehensive message on that subject.
    - **Textual:** Derive the main sermon points directly from a short text (typically 1-2 verses). The development and explanation of those points can then be supported by logic, illustrations, and other scriptures.
    - **Principle:** Identify the timeless, universal biblical principles from the provided scripture or topic. Build the sermon around explaining these principles and showing the audience how to apply them directly to modern life.

### 3. Oratorical Style
- **oratoricalStyle:** [INSERT ORATORICAL STYLE HERE]
- **Instruction:** You MUST use the sermon types from ### Sample Sermons ### as your primary style guide. For the "Selected Style" requested above, first locate the corresponding section in the instructions. Read the "Style Analysis" and then carefully study the "Full Sermon Example." Your generated sermon must emulate the tone, structure, rhetorical devices, and principles demonstrated in that example.
- **Style Definitions (for your reference):**
    - **The Persuader (e.g., Charles Spurgeon):** Employ rich, descriptive language, practical illustrations from everyday life, and a passionate, persuasive, and direct tone.
    - **The Prophet (e.g., Dr. Martin Luther King, Jr.):** Use powerful rhetoric, parallelism, and repetition. Build the sermon towards a climactic and hopeful vision of redemption and justice.
    - **The Evangelist (e.g., Billy Graham):** Keep the message simple, clear, and direct. Ground the sermon in scriptural authority and focus on the core gospel message with a call to action.
    - **The Scholar (e.g., R.C. Sproul):** Present a logical, systematic, and deeply theological sermon. The focus should be on helping the audience achieve a thorough and robust understanding of the topic.

### 4. Denomination
- **denomination:** [INSERT DENOMINATION HERE]
- **Instruction:** Subtly adapt the sermon to the specified denomination. Consider its theological leanings, common vocabulary, and points of emphasis without creating a caricature. For example, a sermon for a Pentecostal church might have a different emphasis on the Holy Spirit than one for a Reformed church.

### 5. Sermon Length
- **sermonLength:** [INSERT SERMON LENGTH PREFERENCE HERE]
- **Word Count Targets (for sermon_body):**
    - **Short:** Aim for a word count between 1800 and 2500 words.
    - **Standard:** Aim for a word count between 2500 and 4200 words.
    - **Long:** Aim for a word count between 4200 and 5500 words.

### 6. Illustration
- **Include Illustration:** [INSERT TRUE/FALSE HERE]

### 7. Church Name
- **churchName:** [INSERT CHURCH NAME HERE]
- **Instruction:** Use the church name sparingly, only where it naturally fits into the sermon. Avoid overuse to maintain a focus on the message rather than the church itself.

### Samples Sermons ###
${sample_sermons}


--- OUTPUT REQUIREMENTS ---

The sermon must be structured as a JSON object. Ensure the output is ONLY the JSON object and nothing else.

The JSON object must contain the following keys:
- "scripture": The primary scripture passage(s) for the sermon. Can be null if the input is topic-based.
- "title": A compelling title that reflects the sermon's style and content.
- "illustration": A relevant story or illustration. If the 'Include Illustration' preference is false, this key's value must be null.
- "sermon_outline": A unnumbered list outlining the main points of the sermon. Bullets or numbers will be added in html
- "key_takeaways": A list of 3-5 key messages or application points for the congregation.
- "sermon_body": The main text of the sermon. The word count MUST align with the "Sermon Length" preference specified above. The body should be well-structured and use Markdown for formatting (e.g., # Heading, **bolding**, *italics*).

Before finalizing, perform a final check to ensure all user preferences—especially Preaching Style, Oratorical Style, and Sermon Length—have been meticulously followed and that the sermon_body word count is within the requested range.
`;

// bible_study_prompt: From openai.tsx
const bible_study_prompt=`
# ROLE & GOAL
You are a helpful theological assistant and curriculum writer. Your task is to generate a comprehensive, in-depth Bible study lesson in the style of a formal lesson commentary. You will do this by applying the principles of a specific "Bible Study Blueprint" to a detailed JSON output structure.

# INSTRUCTIONS
1.  Identify the 'Bible Study Type' from the User Input.
2.  Internalize the principles of the corresponding "Bible Study Blueprint" provided below.
3.  Use that blueprint to populate the fields of the "JSON Output Structure." The blueprint should guide the content, tone, and focus of each field. For example, a "Survey" study will have very different 'lesson_aims' and 'commentary' than a "Word Study," even though the JSON keys are the same.

--- USER INPUT ---

1.  **Bible Study Type:** [INSERT BIBLE STUDY TYPE HERE]
2.  **Topic:** [INSERT BIBLE BOOK, TOPIC, PERSON, OR WORD HERE]
3.  **Include Illustration:** [INSERT TRUE/FALSE HERE]
4.  **Number of Lessons:** [INSERT NUMBER OF LESSONS HERE]

--- BIBLE STUDY BLUEPRINTS (FOR AI REFERENCE) ---

### **1. Expositional Method Blueprint**
* **Core Principle:** Study individual Bible books verse-by-verse to reveal the flow of the author’s thoughts.
* **Focus:** Use observation, interpretation, and application for a deep understanding of verses in their context.
* **How to Apply to JSON:**
    * **'commentary'**: This will be a detailed, verse-by-verse explanation of the 'backgroundScripture'.
    * **'lesson_aims'**: Focus on understanding and applying the specific passage.
    * **'lessonOutline'**: Should follow the sequence of the scripture precisely.

### **2. Survey Method Blueprint**
* **Core Principle:** Study Bible books as a whole to understand general information.
* **Focus:** Investigate the author, historical background, writing style, and major themes.
* **How to Apply to JSON:**
    * **'commentary'**: Focus on the big picture. Instead of verse-by-verse, discuss the book's structure, purpose, and overarching themes.
    * **'introduction.background'**: This section will be especially detailed, covering the historical and cultural context of the entire book.
    * **'lesson_aims'**: Focus on high-level understanding (e.g., "Summarize the major divisions of Genesis").

### **3. Topical Method Blueprint**
* **Core Principle:** Organize what the entire Bible says about a specific topic.
* **Focus:** Gather verses from across the Old and New Testaments to build a comprehensive understanding.
* **How to Apply to JSON:**
    * **'backgroundScripture'**: This may be a list of several key passages about the topic.
    * **'commentary'**: Organize this section by sub-themes of the main topic, not by a single scripture passage.
    * **'lessonOutline'**: The outline will be based on the logical flow of the topic, not a biblical text.

### **4. Biographical Method Blueprint**
* **Core Principle:** Develop a character sketch of a specific person in the Bible.
* **Focus:** Examine their strengths, weaknesses, faith, and God's work in their life.
* **How to Apply to JSON:**
    * **'commentary'**: Structure this as a narrative, following key stages or events in the person's life.
    * **'lesson_aims'**: Focus on drawing life lessons from the individual's experiences.
    * **'application_sidebar'**: This is a perfect place to connect a character trait of the biblical person to a modern-day challenge or virtue.

### **5. Word Study Method Blueprint**
* **Core Principle:** Understand the meaning of specific, important biblical words.
* **Focus:** Explore the original Hebrew or Greek meaning and examine how the word is used in different contexts.
* **How to Apply to JSON:**
    * **'commentary'**: This section will be a deep dive into the definition, etymology, and usage of the specific word.
    * **'key_verse'**: Select a verse that provides the clearest example of the word's meaning.
    * 'discussion_starters': Frame questions around the implications of the word's true meaning.

### **6. Devotional Method Blueprint**
* **Core Principle:** Less technical study for personal inspiration and deepening one's relationship with God.
* **Focus:** Pondering and reflecting on the application of God’s words to daily life.
* **How to Apply to JSON:**
    * **'commentary'**: The tone should be more inspirational and reflective. Focus less on technical details and more on personal encouragement.
    * **'lesson_aims'**: Goals should be about personal growth, prayer, and spiritual discipline.
    * **'discussion_starters' and 'application_sidebar'**: These should be highly practical and focused on daily life.

--- JSON OUTPUT STRUCTURE ---

Generate a JSON object for a parent bible study, with indivdual complete Bible study lessons. Please ensure the output is ONLY the JSON object and nothing else. The object must contain the following keys:

-   'title': The main title for the lesson, from the user input.
-   'subtitle': A brief subtitle that captures the essence of the lesson.
-   'study_method': The Bible Study Type, which will determine the structure and focus of the lesson.
-   'illustration': An imagined visual that can be used as a prompt for an illustration or image related to the lesson. This can be null if no illustration is needed.
-   'studies': An array of individual Bible study lessons, based on the "Number of Lessons" captured, each structured according to the chosen Bible Study Type. Each lesson should include:
    -   'lesson_number': A sequential number for the lesson.
    -   'title': The title of the lesson, which should be descriptive and engaging.
    -   'scripture': The primary scripture reference for the lesson.
    -   'key_verse': A single, memorable verse from the scripture that fits the study's focus.
    -   'lesson_aims': An array of 3-4 strings, with each string being a clear, objective-based learning goal tailored to the chosen Blueprint.
    -   'study_outline': A detailed, hierarchical outline of the lesson's commentary section in array format.
    -   'introduction': A JSON object with two keys:
        -   'hook': A short, engaging introduction that connects the lesson's theme to a common experience.
        -   'background': A paragraph providing the context for the scripture or topic.
    -   'commentary': The main body of the lesson (1500-2000 words), structured according to the chosen Blueprint. Use Markdown for formatting.
    -   'discussion_starters': An array of talking points to be used like questions for reflection or conversation starters for congregated studies.
    -   'application_sidebar': A JSON object with a 'title' and 'body' for a modern-day story or analogy. This may be hard to nail down. Leave null if not applicable.
    -   'conclusion': A JSON object with three keys:
        -   'summary': A brief paragraph summarizing the lesson's main takeaway.
        -   'prayer': A short, closing prayer related to the lesson.
        -   'thoughtToRemember': A single, memorable sentence to conclude the lesson.
`;

const daily_prayer_prompt = `
# ROLE & GOAL
You are a compassionate Christian prayer assistant. Your goal is to generate a daily prayer tailored to a user's provided focus and improvement areas.

# INSTRUCTIONS
Craft a prayer that is uplifting, encouraging, and aligns with Christian principles. Incorporate the user's focus and improvement areas naturally into the prayer.

--- USER INPUT ---
Focus Areas: [INSERT FOCUS AREAS HERE]
Improvement Areas: [INSERT IMPROVEMENT AREAS HERE]

--- OUTPUT REQUIREMENTS ---
Provide a single block of prayer text.
`;

const advice_guidance_prompt = `
# ROLE & GOAL
You are a wise and supportive Christian advice and guidance counselor. Your goal is to provide thoughtful, biblically-informed advice for a user's specific life situation.

# INSTRUCTIONS
Analyze the provided situation and offer practical, empathetic, and spiritually grounded advice. Frame your advice in actionable points.

--- USER INPUT ---
Situation: [INSERT SITUATION HERE]

--- OUTPUT REQUIREMENTS ---
Provide the advice as a JSON object with two keys:
- "situation_summary": A brief summary of the user's situation.
- "advice_points": An array of actionable advice points (strings).
`;

// Add this to your index.js file alongside other prompts
const daily_devotional_prompt = `
# ROLE & GOAL
You are a deeply spiritual and helpful Christian devotional writer for the "Sanctuary" app. Your primary goal is to generate a daily devotional that is personal, uplifting, encouraging, and biblically sound. The devotional must be unique and not repeat themes or scriptures from previous devotionals. Use the recent devotionals passed through to this prompt to ensure uniqueness. Focus on improvement areas and focus areas on a high level, and make the devotional more general and every day. This should be a way for the user to find daily ways to interact with their world that will help them in their desired growth areas. If the recent devotionals show that the growth areas have been adequatly covered, move on to more general daily devotional.


# INSTRUCTIONS
You will be provided with a user's focus and improvement areas, along with a summary of their most recent devotionals to ensure new and fresh content.

1.  **Select a Scripture:** Choose a single scripture passage that is highly relevant to the user's focus areas and is not present in the provided recent devotionals. The scripture should be referenced at the very beginning of the devotional.
2.  **Title:** Create a compelling title that reflects the devotional's theme and scripture.
3.  **Devotional Content:** Write the main body of the devotional in a compassionate and encouraging tone.
    * Explain the chosen scripture in a way that is easy to understand.
    * Connect the scripture's message directly to the user's focus or improvement areas.
    * Use Markdown for formatting, including bolding (**bold**), italics (*italics*), and paragraph breaks.
    * Ensure the devotional has a clear flow, from explaining the scripture to its practical application.
4.  **Compose a Prayer:** Include with the devotional object a "Daily Prayer" that summarizes the devotional's message and is personal and specific to the user's needs.

--- USER INPUT & CONTEXT ---

-   **Focus Areas:** [INSERT FOCUS AREAS HERE]
-   **Improvement Areas:** [INSERT IMPROVEMENT AREAS HERE]
-   **Recent Devotionals (for context to avoid repetition):** [INSERT JSON ARRAY OF RECENT DEVOTIONALS HERE]

--- OUTPUT REQUIREMENTS ---

Your response must be a single JSON object. Ensure the output is ONLY the JSON object and nothing else.

The JSON object must contain the following two keys:
-   **"title"**: A string containing the title of the devotional.
-   **"scripture"**: A string containing the scripture reference. Example: "2 Chronicles 20:2-3 (AMPC)".
-   **"content"**: A string containing the complete devotional text, formatted with Markdown. This should include only the main body.
-   **"daily_prayer"**: A string containing the prayer text.
`;

// Example of the JSON output:
/*
{
    "title": "Seeking God as Our Vital Need",
  "scripture": "2 Chronicles 20:2-3 (AMPC)",
  "content": "**A Call to Seek God**\n\nWhen King Jehoshaphat was faced with a great multitude coming against him, he didn't rely on his own strength. He was afraid, but his fear drove him to do something profound: he set himself to seek the Lord, and he proclaimed a fast throughout all Judah. This act was a powerful demonstration of his humility and a clear signal of his complete dependence on God.\n\nToday, you are working on *[user's focus area]*. It's easy to get overwhelmed and try to solve things on our own. But like Jehoshaphat, we are called to seek God with determination, treating it as our 'vital need.' This doesn't just mean a quick prayer; it's a dedicated effort to turn away from distractions and lean into His presence.\n\nGod promises that when we seek Him with all our hearts, we will find Him. Let this devotional be a reminder to seek God not only in moments of desperation but consistently, as a lifestyle. By doing so, you can find guidance and peace, preventing the need to become desperate in the first place.\n\n*"
  "daily_prayer": "Lord, I come before You today with a heart that seeks Your presence. Help me to turn away from my distractions and focus on You as my vital need. Guide me and fill me with Your peace and wisdom. May I always remember that in seeking You, I find everything I truly need. In Jesus' name, Amen."
}
*/

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

// --- API Endpoints ---
//Endpoint to get news articles from scriptural_outlooks table of database
app.get('/scriptural-outlooks', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('scriptural_outlooks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10); // Get the latest 10 articles
        if (error) {
            console.error('Error fetching scriptural outlooks:', error);
            return res.status(500).json({ error: 'Failed to fetch scriptural outlooks.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Unhandled error in /scriptural-outlooks:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});
// Endpoint to initiate Daily Devotional generation
app.post('/generate-devotional', async (req, res) => {
    try {
        const { userId, focusAreas, improvementAreas, recentDevotionals } = req.body;
        const generationDate = new Date().toISOString().split('T')[0];
        console.log('generate-devotional', userId, focusAreas, improvementAreas, recentDevotionals);
        console.log('generate-devotional, and prayer');
        // 1. Create a placeholder in the database immediately
        const { data: newDevotional, error: insertError } = await supabase
            .from('daily_devotionals')
            .insert({
                user_id: userId,
                // Assuming 'content' or another field is the primary AI output placeholder
                content: 'Generating devotional...',
                status: 'pending', // IMPORTANT: This assumes you have a 'status' column
                // scripture: null, // Placeholder if scripture is a separate output from AI
                created_at: new Date().toISOString(), // Ensure created_at is set
                updated_at: new Date().toISOString(), // Ensure updated_at is set
            })
            .select('devotional_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder devotional:', insertError);
            return res.status(500).json({ error: 'Failed to initiate devotional generation.' });
        }
        // 1-a. Create a placeholder for prayer in the daily_prayer table
        const { data: newPrayer, error: insertPrayerError } = await supabase
            .from('daily_prayers')
            .insert({
                user_id: userId,
                generated_prayer: 'Generating prayer...',
                status: 'pending', // Assuming you have a status column
                date: generationDate,
                went_through_guided_prayer: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('prayer_id')
            .single();
        if (insertPrayerError) {
            console.error('Error creating placeholder prayer:', insertPrayerError);
            return res.status(500).json({ error: 'Failed to initiate prayer generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Devotional generation initiated.',
            devotionalId: newDevotional.devotional_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background (after sending response)
        const userPrompt = `
        Focus areas: ${focusAreas.join(', ')}.
        Improvement areas: ${improvementAreas.join(', ')}.
        Recent devotionals: ${JSON.stringify(recentDevotionals)}
        `;

        try {
            const generatedContent = await callOpenAIAndProcessResult(
                daily_devotional_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14', // Model for devotional
                5000, // Max tokens
                "text" // Devotional expected as plain text
            );

            //parse generatedContent to json
            const parsedContent = JSON.parse(generatedContent);
            const { title, scripture, content, daily_prayer } = parsedContent;
            // Assuming the AI directly outputs the devotional text for the 'content' column
            const { error: updateError } = await supabase
                .from('daily_devotionals')
                .update({
                    title: title,
                    content: content,
                    scripture: scripture,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                    // If AI also generates scripture, you'd parse and include it here
                })
                .eq('devotional_id', newDevotional.devotional_id);
            
            if (updateError) {
                console.error(`Error updating devotional record ${newDevotional.devotional_id}:`, updateError);
                // Update status to 'failed' if update fails
                await supabase.from('daily_devotionals').update({ status: 'failed' }).eq('devotional_id', newDevotional.devotional_id);
            } else {
                console.log(`Devotional record ${newDevotional.devotional_id} successfully generated and updated.`);
            }
            // Now update the prayer record with the generated prayer
            const { error: updatePrayerError } = await supabase

                .from('daily_prayers')
                .update({
                    generated_prayer: daily_prayer,
                    updated_at: new Date().toISOString(),
                })
                .eq('prayer_id', newPrayer.prayer_id);
            if (updatePrayerError) {
                console.error(`Error updating prayer record for devotional ${newDevotional.devotional_id}:`, updatePrayerError);
                await supabase.from('daily_prayers').update({ prayer_text: 'Failed to generate prayer.' }).eq('prayer_id', newPrayer.prayer_id);
            } else {
                console.log(`Prayer record for devotional ${newDevotional.devotional_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for devotional ${newDevotional.devotional_id}:`, aiError);
            await supabase.from('daily_devotionals').update({ status: 'failed' }).eq('devotional_id', newDevotional.devotional_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-devotional:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Endpoint to initiate Sermon generation by Topic
app.post('/generate-sermon-by-topic', async (req, res) => {
    try {
        const { userId, topic, userProfile } = req.body;
        console.log(userId, topic, userProfile);
        // 1. Create a placeholder in the database immediately
        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                title: `Generating Sermon: ${topic}`,
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('sermon_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder sermon:', insertError);
            return res.status(500).json({ error: 'Failed to initiate sermon generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = 'Topic: ' + topic + '\nInclude Illustration: true\nGenerate the sermon based on this topic. You may select a relevant scripture passage to include in the "scripture" field of the JSON, or leave it null if no single passage is central.' + (userProfile && userProfile.sermon_preferences ? '\nUser Preferences: ' + JSON.stringify(userProfile.sermon_preferences) : '');

        try {
            const generatedSermon = await callOpenAIAndProcessResult(
                sermon_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14', // Model for sermon
                4000, // Max tokens
                "json_object", // Sermon expected as JSON
                            
            );

            // Update the record with parsed content
            const { error: updateError } = await supabase
                .from('sermons')
                .update({
                    title: generatedSermon.title || `Sermon on ${topic}`,
                    scripture: generatedSermon.scripture || null,
                    illustration: generatedSermon.illustration || null,
                    sermon_outline: generatedSermon.sermon_outline || null, // Assuming this is text, or stringified JSON
                    key_takeaways: generatedSermon.key_takeaways || null, // Assuming this is text, or stringified JSON
                    sermon_body: generatedSermon.sermon_body || null,
                    status: 'completed',
                    user_id: userId, // Associate sermon with user
                    updated_at: new Date().toISOString(),
                })
                .eq('sermon_id', newSermon.sermon_id);

            if (updateError) {
                console.error(`Error updating sermon record ${newSermon.sermon_id}:`, updateError);
                await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            } else {
                console.log(`Sermon record ${newSermon.sermon_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for sermon ${newSermon.sermon_id}:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-sermon-by-topic:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Endpoint to initiate Sermon generation by Scripture
app.post('/generate-sermon-by-scripture', async (req, res) => {
    try {
        const { userId, scripture, userProfile } = req.body;

        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                title: `Generating Sermon for ${scripture}`,
                date_preached: new Date().toISOString().split('T')[0],
                sermon_outline: 'Generating outline...',
                sermon_body: 'Generating content...',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('sermon_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder sermon:', insertError);
            return res.status(500).json({ error: 'Failed to initiate sermon generation.' });
        }

        res.status(202).json({
            message: 'Sermon generation initiated.',
            sermonId: newSermon.sermon_id,
            status: 'pending'
        });

        const userPrompt = 'Scripture: ' + scripture + '\nInclude Illustration: true\nGenerate the sermon based on this scripture. ' + (userProfile && userProfile.sermon_preferences ? '\nUser Preferences: ' + JSON.stringify(userProfile.sermon_preferences) : '');

        try {
            const generatedSermon = await callOpenAIAndProcessResult(
                sermon_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000,
                "json_object"
            );

            const { error: updateError } = await supabase
                .from('sermons')
                .update({
                    title: generatedSermon.title || `Sermon for ${scripture}`,
                    scripture: generatedSermon.scripture || null,
                    illustration: generatedSermon.illustration || null,
                    sermon_outline: generatedSermon.sermon_outline || null,
                    key_takeaways: generatedSermon.key_takeaways || null,
                    sermon_body: generatedSermon.sermon_body || null,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('sermon_id', newSermon.sermon_id);

            if (updateError) {
                console.error(`Error updating sermon record ${newSermon.sermon_id}:`, updateError);
                await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
            } else {
                console.log(`Sermon record ${newSermon.sermon_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for sermon ${newSermon.sermon_id}:`, aiError);
            await supabase.from('sermons').update({ status: 'failed' }).eq('sermon_id', newSermon.sermon_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-sermon-by-scripture:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// Endpoint to initiate Bible Study generation
app.post('/generate-bible-study', async (req, res) => {
    try {
        const { userId, topic, length, method } = req.body;

        // 1. Create a placeholder in the `bible_studies` table immediately
        const { data: newStudy, error: insertStudyError } = await supabase
            .from('bible_studies')
            .insert({
                user_id: userId,
                title: `Generating Bible Study: ${topic}`,
                subtitle: 'Content being generated...', // Placeholder
                study_method: method, // Initial method
                illustration: 'Generating illustration prompt...', // Placeholder
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('study_id')
            .single();

        if (insertStudyError) {
            console.error('Error creating placeholder Bible study:', insertStudyError);
            return res.status(500).json({ error: 'Failed to initiate Bible study generation.' });
        }

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Bible Study generation initiated.',
            studyId: newStudy.study_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background
        const userPrompt = 'Topic: ' + topic + '\n Number of Lessons:' + length + '\n Bible Study Type: ' + method + '\n Include Illustration: true\n ';

        try {
            const generatedStudy = await callOpenAIAndProcessResult(
                bible_study_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                5000,
                "json_object"
            );

            // Update the parent bible_studies record with top-level data
            const { error: updateStudyError } = await supabase
                .from('bible_studies')
                .update({
                    title: generatedStudy.title || `Bible Study on ${topic}`,
                    subtitle: generatedStudy.subtitle || null,
                    illustration: generatedStudy.illustration || null,
                    study_method: generatedStudy.study_method || method,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('study_id', newStudy.study_id);

            if (updateStudyError) {
                console.error(`Error updating bible_studies record ${newStudy.study_id}:`, updateStudyError);
                await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
                return; // Stop here if parent update fails
            }

            // Insert individual lessons into bible_study_lessons table
            if (generatedStudy.studies && Array.isArray(generatedStudy.studies)) {
                for (const lesson of generatedStudy.studies) {
                    const { error: insertLessonError } = await supabase
                        .from('bible_study_lessons')
                        .insert({
                            study_id: newStudy.study_id, // Link to parent study
                            lesson_number: lesson.lesson_number,
                            title: lesson.title,
                            scripture: lesson.scripture || null,
                            key_verse: lesson.key_verse || null,
                            lesson_aims: lesson.lesson_aims || null,
                            study_outline: lesson.study_outline || null,
                            introduction: lesson.introduction || null,
                            commentary: lesson.commentary || null,
                            discussion_starters: lesson.discussion_starters || null,
                            application_sidebar: lesson.application_sidebar || null,
                            conclusion: lesson.conclusion || null,
                            reflection_questions: lesson.reflection_questions || null, // Assuming this is also present in AI output
                            user_id: userId, // Associate lesson with user
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        });
                    if (insertLessonError) {
                        console.error(`Error inserting bible_study_lesson for study ${newStudy.study_id}:`, insertLessonError);
                        // Consider rolling back parent study status to failed or partial
                    }
                }
                console.log(`Bible study ${newStudy.study_id} and its lessons successfully generated and updated.`);
            } else {
                console.warn(`No 'studies' array found in generated Bible study for ID ${newStudy.study_id}.`);
            }

        } catch (aiError) {
            console.error(`AI generation failed for Bible study ${newStudy.study_id}:`, aiError);
            await supabase.from('bible_studies').update({ status: 'failed' }).eq('study_id', newStudy.study_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-bible-study:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Endpoint: Generate Daily Prayer
app.post('/generate-prayer', async (req, res) => {
    try {
        const { userId, focusAreas, improvementAreas } = req.body;
        const prayerDate = new Date().toISOString().split('T')[0];

        // 1. Create placeholder
        const { data: newPrayer, error: insertError } = await supabase
            .from('daily_prayers')
            .insert({
                user_id: userId,
                date: prayerDate,
                generated_prayer: 'Generating prayer...',
                went_through_guided_prayer: false, // Default
                status: 'pending', // IMPORTANT: Assumes 'status' column exists
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('prayer_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder prayer:', insertError);
            return res.status(500).json({ error: 'Failed to initiate prayer generation.' });
        }

        res.status(202).json({
            message: 'Prayer generation initiated.',
            prayerId: newPrayer.prayer_id,
            status: 'pending'
        });

        // 3. Start AI generation in background
        const userPrompt = `Focus Areas: ${focusAreas.join(', ')}\nImprovement Areas: ${improvementAreas.join(', ')}`;
        try {
            const generatedPrayer = await callOpenAIAndProcessResult(
                daily_prayer_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, // Max tokens for prayer
                "text"
            );

            const { error: updateError } = await supabase
                .from('daily_prayers')
                .update({
                    generated_prayer: generatedPrayer,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('prayer_id', newPrayer.prayer_id);

            if (updateError) {
                console.error(`Error updating prayer record ${newPrayer.prayer_id}:`, updateError);
                await supabase.from('daily_prayers').update({ status: 'failed' }).eq('prayer_id', newPrayer.prayer_id);
            } else {
                console.log(`Prayer record ${newPrayer.prayer_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for prayer ${newPrayer.prayer_id}:`, aiError);
            await supabase.from('daily_prayers').update({ status: 'failed' }).eq('prayer_id', newPrayer.prayer_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-prayer:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Endpoint: Generate Advice/Guidance
app.post('/generate-advice', async (req, res) => {
    try {
        const { userId, situation } = req.body;

        // 1. Create placeholder
        const { data: newAdvice, error: insertError } = await supabase
            .from('advice_guidance')
            .insert({
                user_id: userId,
                situation: situation,
                advice_points: 'Generating advice...', // Placeholder
                status: 'pending', // IMPORTANT: Assumes 'status' column exists
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('advice_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder advice:', insertError);
            return res.status(500).json({ error: 'Failed to initiate advice generation.' });
        }

        res.status(202).json({
            message: 'Advice generation initiated.',
            adviceId: newAdvice.advice_id,
            status: 'pending'
        });

        // 3. Start AI generation in background
        const userPrompt = `Situation: ${situation}`;
        try {
            const generatedAdvice = await callOpenAIAndProcessResult(
                advice_guidance_prompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, // Max tokens for advice
                "json_object"
            );

            // The AI output is a JSON with 'situation_summary' and 'advice_points'
            const { error: updateError } = await supabase
                .from('advice_guidance')
                .update({
                    situation: generatedAdvice.situation_summary || situation, // Update situation with AI summary
                    advice_points: JSON.stringify(generatedAdvice.advice_points || []), // Store array as JSON string or JSONB if column is JSONB
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('advice_id', newAdvice.advice_id);

            if (updateError) {
                console.error(`Error updating advice record ${newAdvice.advice_id}:`, updateError);
                await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
            } else {
                console.log(`Advice record ${newAdvice.advice_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            console.error(`AI generation failed for advice ${newAdvice.advice_id}:`, aiError);
            await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
        }

    } catch (error) {
        console.error('Unhandled error in /generate-advice:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});


// --- Fetching Endpoints (for frontend to check status and retrieve completed content) ---
// These endpoints directly query Supabase.

app.get('/sermons/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('sermons')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching sermons:', error);
        return res.status(500).json({ error: 'Failed to fetch sermons.' });
    }
    res.json(data);
});

app.get('/sermon/:sermonId', async (req, res) => {
    const { sermonId } = req.params;
    const { data, error } = await supabase
        .from('sermons')
        .select('*')
        .eq('sermon_id', sermonId)
        .single();

    if (error) {
        console.error('Error fetching sermon:', error);
        return res.status(500).json({ error: 'Failed to fetch sermon.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Sermon not found.' });
    }
    res.json(data);
});


app.get('/devotionals/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('daily_devotionals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }); // Assuming created_at for ordering
    if (error) {
        console.error('Error fetching devotionals:', error);
        return res.status(500).json({ error: 'Failed to fetch devotionals.' });
    }
    res.json(data);
});

app.get('/bible-studies/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('bible_studies')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching bible studies:', error);
        return res.status(500).json({ error: 'Failed to fetch bible studies.' });
    }
    res.json(data);
});

// New Fetching Endpoint: Get Daily Prayers for a user
app.get('/prayers/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('daily_prayers')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false }); // Order by date

    if (error) {
        console.error('Error fetching daily prayers:', error);
        return res.status(500).json({ error: 'Failed to fetch daily prayers.' });
    }
    res.json(data);
});

// New Fetching Endpoint: Get Advice/Guidance for a user
app.get('/advice/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching advice:', error);
        return res.status(500).json({ error: 'Failed to fetch advice.' });
    }
    res.json(data);
});
//New Fetching Endpoint: Get Advice/Guidance by adviceId
app.get('/advice/:userId/:adviceId', async (req, res) => {
    
    const { adviceId, userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .eq('advice_id', adviceId)
        .single();
    if (error) {
        console.error('Error fetching advice by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch advice by ID.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Advice not found.' });
    }
    res.json(data);
});
// Get user_profile by userId
app.get('/user-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
    if (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json({ error: 'Failed to fetch user profile.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'User profile not found.' });
    }
    res.json(data);
});
//save or update user_profile by userId
app.post('/user-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const profileData = req.body; 
    const { data, error } = await supabase
        .from('user_profiles')
        .upsert(profileData)
        .eq('user_id', userId);
    if (error) {
        console.error('Error saving or updating user profile:', error);
        return res.status(500).json({ error: 'Failed to save or update user profile.' });
    }
    res.json(data);
});
    
// Example Node.js/Express route for a Supabase backend
app.post('/log-activity', async (req, res) => {
  const { userId, activityType, activityId } = req.body;

  if (!userId || !activityType || !activityId) {
    return res.status(400).send('Missing user ID or activity type.');
  }

  // Check if a record for this user and activity type already exists for today
  const { data: existingEntry, error: fetchError } = await supabase
    .from('user_activities')
    .select('id')
    .eq('user_id', userId)
    .eq('activity_type', activityType)
    .eq('activity_date', new Date().toISOString().split('T')[0]); // Use just the date

  if (fetchError) {
    console.error('Error checking for existing activity:', fetchError);
    return res.status(500).send('Database error.');
  }

  if (existingEntry.length > 0) {
    // Activity already logged for today, do nothing
    return res.status(200).send('Activity already logged for today.');
  }

  // Log the new activity
  const { data, error } = await supabase
    .from('user_activities')
    .insert([
      {
        user_id: userId,
        activity_type: activityType,
        activity_date: new Date().toISOString().split('T')[0],
        activity_id: activityId,
      },
    ]);

  if (error) {
    console.error('Error logging user activity:', error);
    return res.status(500).send('Failed to log activity.');
  }

  res.status(200).json({ message: 'Activity logged successfully.' });
});

// New API route to calculate and return the user's streak
app.get('/streak/:userId/:activityType', async (req, res) => {
  const { userId, activityType } = req.params;

  if (!userId || !activityType) {
    return res.status(400).send('Missing user ID or activity type.');
  }

  try {
    const { data: activities, error } = await supabase
      .from('user_activities')
      .select('activity_date')
      .eq('user_id', userId)
      .eq('activity_type', activityType)
      .order('activity_date', { ascending: false }); // Get most recent activities first

    if (error) {
      console.error('Error fetching activities for streak:', error);
      return res.status(500).send('Database error.');
    }

    if (!activities || activities.length === 0) {
      return res.status(200).json({ streak: 0 }); // No activities found, streak is 0
    }

    // Streak calculation logic
    let streak = 0;
    let today = new Date();
    today.setHours(0, 0, 0, 0); // Set time to midnight for accurate date comparison

    // Check if the most recent activity was today. If not, the streak is 0.
    const mostRecentDate = new Date(activities[0].activity_date);
    //check and see if the most recent date was yesterday
    if (mostRecentDate.getTime() === today.getTime() - 86400000) {
      streak = 1;
    } else if (mostRecentDate.getTime() < today.getTime()) {
        // Most recent activity was yesterday, streak starts at 1
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (mostRecentDate.getTime() === yesterday.getTime()) {
          streak = 1;
        } else {
            return res.status(200).json({ streak: 0 }); // No activity yesterday or today, so streak is 0
        }
    }
    
    // Iterate through the rest of the activities
    for (let i = 1; i < activities.length; i++) {
        const currentDate = new Date(activities[i-1].activity_date);
        const previousDate = new Date(activities[i].activity_date);

        // Calculate the difference in days
        const oneDay = 1000 * 60 * 60 * 24;
        const diffInDays = Math.round((currentDate.getTime() - previousDate.getTime()) / oneDay);
        
        // If consecutive, increment the streak
        if (diffInDays === 1) {
            streak++;
        } else {
            // If the dates are not consecutive, the streak is broken
            break;
        }
    }
    
    return res.status(200).json({ streak });

  } catch (err) {
    console.error('Error calculating streak:', err);
    res.status(500).send('Server error.');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});