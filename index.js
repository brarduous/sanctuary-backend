// index.js
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // Use the v4 client
const { createClient } = require('@supabase/supabase-js');
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
            response_format: { type: responseFormatType }
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

// Endpoint to initiate Daily Devotional generation
app.post('/generate-devotional', async (req, res) => {
    try {
        const { userId, focusAreas, improvementAreas } = req.body;
        const generationDate = new Date().toISOString().split('T')[0];

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

        // 2. Return the placeholder ID to the frontend immediately
        res.status(202).json({
            message: 'Devotional generation initiated.',
            devotionalId: newDevotional.devotional_id,
            status: 'pending'
        });

        // 3. Start AI generation in the background (after sending response)
        const userPrompt = `Generate a daily Christian devotional personalized for the user.
        Focus areas: ${focusAreas.join(', ')}.
        Improvement areas: ${improvementAreas.join(', ')}.
        Ensure the tone is supportive and uplifting.`;

        try {
            const generatedContent = await callOpenAIAndProcessResult(
                'You are a helpful Christian devotional writer.',
                userPrompt,
                'gpt-4o', // Model for devotional
                500, // Max tokens
                "text" // Devotional expected as plain text
            );

            // Assuming the AI directly outputs the devotional text for the 'content' column
            const { error: updateError } = await supabase
                .from('daily_devotionals')
                .update({
                    content: generatedContent,
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

        // 1. Create a placeholder in the database immediately
        const { data: newSermon, error: insertError } = await supabase
            .from('sermons')
            .insert({
                user_id: userId,
                title: `Generating Sermon: ${topic}`,
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
                'gpt-4o', // Model for sermon
                4000, // Max tokens
                "json_object" // Sermon expected as JSON
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
                'gpt-4o',
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
                'gpt-4o',
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
                'gpt-4o',
                300, // Max tokens for prayer
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
                'gpt-4o',
                700, // Max tokens for advice
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


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});