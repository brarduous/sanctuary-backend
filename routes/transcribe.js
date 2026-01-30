const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path'); // [!code ++] Import path
const OpenAI = require('openai');
const { logEvent } = require('../utils/helpers');

// Configure upload storage
const upload = multer({ dest: 'uploads/' });

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/transcribe', upload.single('file'), async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  // [!code ++] Define paths
  const originalPath = req.file.path;
  // Use the extension from the client, or default to .webm
  const extension = path.extname(req.file.originalname) || '.webm';
  const newPath = originalPath + extension;

  try {
    // [!code ++] Rename file to include extension so OpenAI recognizes it
    fs.renameSync(originalPath, newPath);

    // 1. Send to OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(newPath), // [!code change] Use newPath
      model: "whisper-1",
      language: "en",
      prompt: "This is a sermon transcription. Expect theology terms, scripture references, and pastoral language."
    });

    // 2. Clean up temp file
    if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
    }

    logEvent('info', 'backend', userId, 'transcription_success', 'Audio transcribed successfully');
    
    // 3. Return text
    res.json({ text: transcription.text });

  } catch (error) {
    console.error('Transcription error:', error);
    
    // Cleanup on error
    if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
    } else if (fs.existsSync(originalPath)) {
        fs.unlinkSync(originalPath);
    }
    
    logEvent('error', 'backend', userId, 'transcription_failed', error.message);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

module.exports = router;