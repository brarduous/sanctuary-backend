const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const OpenAI = require('openai');

const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/analyze-style', upload.array('files', 5), async (req, res) => {
  try {
    let combinedText = "";

    // 1. Extract Text from all files
    for (const file of req.files) {
      const buffer = fs.readFileSync(file.path);
      if (file.mimetype === 'application/pdf') {
        const data = await pdf(buffer);
        combinedText += data.text + "\n\n";
      } else if (file.mimetype.includes('wordprocessing')) { // docx
        const result = await mammoth.extractRawText({ path: file.path });
        combinedText += result.value + "\n\n";
      }
      fs.unlinkSync(file.path); // Cleanup
    }

    // 2. AI Analysis
    const prompt = `
      Analyze the following sermon text samples from a pastor. 
      Identify their specific:
      1. Preaching Style (Expository, Topical, Narrative, etc.)
      2. Oratorical Voice (Scholar, Prophet, Storyteller, etc.)
      3. Typical Sentence Structure & Tone.
      
      Output valid JSON ONLY:
      {
        "preachingStyle": "string",
        "oratoricalStyle": "string",
        "styleSummary": "string (2 sentences describing their unique voice)",
        "customSystemPrompt": "string (A system instruction to an AI to write exactly like this person)"
      }

      Text Sample: ${combinedText.substring(0, 15000)} 
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are a Homiletics Expert." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;