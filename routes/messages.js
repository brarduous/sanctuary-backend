const express = require('express');
const router = express.Router();
const Mux = require('@mux/mux-node');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { sendPushToCongregation } = require('../utils/push');

// Initialize Mux (You'll need to add these to your backend .env file)
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

// 1. Get a Direct Upload URL from Mux
router.post('/upload-url', authenticateUser, async (req, res) => {
  try {
    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        video_quality: 'basic', // Cost-saving setting for mobile-first video
      },
      cors_origin: '*', // In production, restrict this to your frontend domains
    });

    res.json({
      uploadId: upload.id,
      uploadUrl: upload.url, // The frontend will PUT the file here directly
    });
  } catch (error) {
    console.error('Mux upload error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// 2. Save the final message to Supabase
router.post('/save-message', authenticateUser, async (req, res) => {
  const { uploadId, title, messageType, congregationId } = req.body;

  try {
    // We check Mux to get the actual Asset ID associated with this upload
    const upload = await mux.video.uploads.retrieve(uploadId);

    if (upload.status !== 'asset_created' && upload.status !== 'waiting') {
      return res.status(400).json({ error: 'Video has not finished processing' });
    }

    const assetId = upload.asset_id;

    // Save to your Database
    const { data, error } = await supabase
      .from('pastoral_messages')
      .insert({
        congregation_id: congregationId,
        video_asset_id: assetId,
        title: title,
        message_type: messageType,
        is_published: true
      })
      .select()
      .single();

    if (error) throw error;
    sendPushToCongregation(
      congregationId,
      "New Pastoral Update 🎥",
      `Your pastor just posted a new ${messageType.replace('_', ' ')}: "${title}"`,
      { route: '/(tabs)/church' } // Deep linking data so tapping the notification opens the church tab
    );
    res.json(data);
  } catch (error) {
    console.error('Save message error:', error);
    res.status(500).json({ error: 'Failed to save pastoral message' });
  }
});

module.exports = router;