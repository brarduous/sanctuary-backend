const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');
const { getAiEditorSystemPrompt, getAiEditorUserPrompt } = require('../prompts');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/edit', async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const { text, instruction } = req.body;

  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const systemPrompt = await getAiEditorSystemPrompt();
    const userPrompt = await getAiEditorUserPrompt({ instruction, text });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast and cheap for interactive edits
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
    });

    const result = response.choices[0].message.content;

    logEvent('info', 'backend', userId, 'ai_edit_success', `Instruction: ${instruction}`);
    res.json({ result });

  } catch (error) {
    console.error('AI Edit Error:', error);
    res.status(500).json({ error: 'AI processing failed' });
  }
});

module.exports = router;