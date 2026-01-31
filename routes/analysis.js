const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const { PDFParse } = require('pdf-parse'); // Check if your package is 'pdf-parse' or similar
const mammoth = require('mammoth');
const OpenAI = require('openai');
const supabase = require('../config/supabase'); // [!code ++]
const authenticateUser = require('../middleware/auth'); // [!code ++]

const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// [!code change] Add authenticateUser middleware
router.post('/analyze-style', authenticateUser, upload.array('files', 5), async (req, res) => {
  const userId = req.user.id; // [!code ++] Get ID from auth middleware

  try {
    let combinedText = "";
    const savedSermons = [];

    // 1. Process each file
    for (const file of req.files) {
      const buffer = fs.readFileSync(file.path);
      let text = "";

      // Extract Text
      if (file.mimetype === 'application/pdf') {
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const data = await parser.getText();
        text = data.text;
      } else if (file.mimetype.includes('wordprocessing') || file.originalname.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ path: file.path });
        text = result.value;
      } else {
        // Fallback for .txt
        text = buffer.toString('utf8');
      }

      // [!code ++] SAVE TO DB IMMEDIATELY
      if (text.trim().length > 50) { // Only save if meaningful content
        const { error: insertError } = await supabase.from('sermons').insert({
            user_id: userId,
            title: file.originalname.replace(/\.[^/.]+$/, ""), // Remove extension
            sermon_body: text,
            status: 'completed', // It's a past sermon, so it's done
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        if (insertError) {
            console.error(`Failed to save sermon ${file.originalname}:`, insertError);
        } else {
            savedSermons.push(file.originalname);
        }
        
        combinedText += `\n--- START SERMON: ${file.originalname} ---\n${text}\n--- END SERMON ---\n`;
      }

      fs.unlinkSync(file.path); // Cleanup
    }

    // 2. AI Analysis with "Context Awareness"
    // We explicitly list the options so the AI knows the "Standard" but permit deviation.
    const prompt = `
      You are a Homiletics Expert analyzing a pastor's sermon archive.
      
      KNOWN PREACHING STYLES: 
      - Expository (Verse-by-verse, text-driven)
      - Topical (Subject-driven, gathers verses around a theme)
      - Textual (Focuses on a short passage as a launchpad)
      - Principle (Extracts timeless truths/applications)

      KNOWN ORATORICAL VOICES:
      - Scholar (Logical, systematic, teaching-focused, dense)
      - Prophet (Powerful rhetoric, visionary, urgent, convicting)
      - Evangelist (Simple, clear, call-to-action focused, gospel-centric)
      - Persuader (Rich language, illustrative, practical, emotional connection)

      TASK:
      Analyze the text samples provided.
      1. Determine the Preaching Style. If it fits a Known Style perfectly, use that name. If it is distinct (e.g., Narrative, Redemptive-Historical), create a NEW "Custom" Label and a 1-sentence description.
      2. Determine the Oratorical Voice. If it fits a Known Voice, use that name. If it is distinct (e.g., Storyteller, Fatherly), create a NEW "Custom" Label and a 1-sentence description.
      3. Write a "System Prompt" that tells an AI how to write exactly like this user.

      Output JSON:
      {
        "preachingStyle": { "label": "String", "isCustom": boolean, "description": "String (if custom)" },
        "oratoricalStyle": { "label": "String", "isCustom": boolean, "description": "String (if custom)" },
        "analysisSummary": "String (2-3 sentences explaining your findings to the user)",
        "customSystemPrompt": "String"
      }

      Text Samples:
      ${combinedText.substring(0, 25000)} 
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano", // Stronger model needed for nuance
      messages: [
        { role: "system", content: "You are a Homiletics Expert." }, 
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    // Pass back the count of saved sermons so we can show a toast
    result.savedCount = savedSermons.length;
    
    console.log('Analysis Result:', result);
    res.json(result);

  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;