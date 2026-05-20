const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const { PDFParse } = require('pdf-parse'); // Check if your package is 'pdf-parse' or similar
const mammoth = require('mammoth');
const OpenAI = require('openai');
const supabase = require('../config/supabase'); // [!code ++]
const authenticateUser = require('../middleware/auth'); // [!code ++]
const {
  getSermonStyleAnalysisSystemPrompt,
  getSermonStyleAnalysisPrompt
} = require('../prompts');

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

    const trimmedSamples = combinedText.substring(0, 25000);
    const systemPrompt = await getSermonStyleAnalysisSystemPrompt();
    const prompt = await getSermonStyleAnalysisPrompt({ combinedText: trimmedSamples });

    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano", // Stronger model needed for nuance
      messages: [
        { role: "system", content: systemPrompt }, 
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