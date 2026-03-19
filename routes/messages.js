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
 const { uploadId, title, messageType, congregationId, messageBody } = req.body;

  try {
    let assetId = null;
    let playbackId = null;

    // Only process Mux logic if an uploadId (video) was provided
    if (uploadId) {
        const upload = await mux.video.uploads.retrieve(uploadId);
        assetId = upload.asset_id; 
        const asset = await mux.video.assets.retrieve(assetId);
        playbackId = asset.playback_ids[0].id; 
    }

    const { data, error } = await supabase
      .from('pastoral_messages')
      .insert({
        congregation_id: congregationId,
        video_asset_id: assetId,
        video_playback_id: playbackId,
        message_body: messageBody || null, // Save the rich text!
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

router.get('/detail/:messageId', authenticateUser, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { data, error } = await supabase
      .from('pastoral_messages')
      .select('*')
      .eq('message_id', messageId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching message details:', error);
    res.status(500).json({ error: 'Failed to fetch message details' });
  }
});

module.exports = router;