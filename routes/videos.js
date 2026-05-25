const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// Helper: Format JS array to Postgres array string
const toPgArray = (arr) => {
  if (!arr || arr.length === 0) return '{}';
  const quoted = arr.map(item => `"${item.replace(/"/g, '\\"')}"`); 
  return `{${quoted.join(',')}}`;
};

const normalizeArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const getVideoPreferences = (profile) => {
  const userPreferences = profile?.user_preferences || {};
  const videoPreferences = userPreferences.videoPreferences || {};

  return {
    preferredChannelIds: normalizeArray(videoPreferences.preferredChannelIds),
    blockedChannelIds: normalizeArray(videoPreferences.blockedChannelIds),
    preferredSpeakers: normalizeArray(videoPreferences.preferredSpeakers)
  };
};

router.get('/youtube-channels', optionalAuth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;
    const q = String(req.query.q || '').trim();

    let query = supabase
      .from('youtube_channels')
      .select('channel_id, channel_name, handle, subscriber_count, view_count, video_count, is_active')
      .eq('is_active', true)
      .order('subscriber_count', { ascending: false, nullsFirst: false })
      .order('view_count', { ascending: false, nullsFirst: false })
      .order('channel_name', { ascending: true })
      .limit(limit);

    if (q) {
      // Broad text search across common selector fields.
      query = query.or(`channel_name.ilike.%${q}%,handle.ilike.%${q}%,channel_id.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('[Videos API] Error fetching channels:', error.message);
    res.status(500).json({ error: 'Failed to fetch YouTube channels' });
  }
});

router.get('/videos/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('user_preferences')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    const prefs = getVideoPreferences(profile);
    res.json(prefs);
  } catch (error) {
    console.error('[Videos API] Error fetching video preferences:', error.message);
    res.status(500).json({ error: 'Failed to fetch video preferences' });
  }
});

router.post('/videos/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferredChannelIds = normalizeArray(req.body?.preferredChannelIds);
    const blockedChannelIds = normalizeArray(req.body?.blockedChannelIds)
      .filter((channelId) => !preferredChannelIds.includes(channelId));
    const preferredSpeakers = normalizeArray(req.body?.preferredSpeakers);

    const { data: profile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('user_preferences')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const nextUserPreferences = {
      ...(profile?.user_preferences || {}),
      videoPreferences: {
        preferredChannelIds,
        blockedChannelIds,
        preferredSpeakers
      }
    };

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          user_preferences: nextUserPreferences
        },
        { onConflict: 'user_id' }
      )
      .select('user_id, user_preferences')
      .single();

    if (error) throw error;

    res.json({
      userId: data.user_id,
      ...getVideoPreferences(data)
    });
  } catch (error) {
    console.error('[Videos API] Error saving video preferences:', error.message);
    res.status(500).json({ error: 'Failed to save video preferences' });
  }
});

router.get('/recommended', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id;

    if(!userId) {
      //get random videos if no user id
      const { data: randomVideos, error: randomError } = await supabase
        .from('recommended_videos')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(10);
      if (randomError) throw randomError;
      return res.json(randomVideos);
    }
    // 1. Get User Profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('user_preferences')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { focusAreas = [], improvementAreas = [] } = profile.user_preferences || {};
    const { preferredChannelIds, blockedChannelIds, preferredSpeakers } = getVideoPreferences(profile);
    
    // Convert to Postgres format for the query
    const focusString = toPgArray(focusAreas);
    const improveString = toPgArray(improvementAreas);
    // 2. Query Candidates
    // We fetch more than we display (limit 50) so we can sort the "best" ones to the top.
    let candidatesQuery = supabase
      .from('recommended_videos')
      .select('*')
      .eq('is_active', true)
      .limit(50);

    if (focusAreas.length > 0 || improvementAreas.length > 0) {
      candidatesQuery = candidatesQuery.or(`focus_areas.ov.${focusString},improvement_areas.ov.${improveString}`);
    }

    const { data: candidates, error: videoError } = await candidatesQuery;

    if (videoError) throw videoError;

    // 3. Score & Sort (The "Relevance" Logic)
    const visibleCandidates = (candidates || []).filter((video) => !blockedChannelIds.includes(video.channel_id));

    const scoredVideos = visibleCandidates.map(video => {
      // Count how many tags match the user's profile
      const focusMatches = video.focus_areas?.filter(tag => focusAreas.includes(tag)).length || 0;
      const improveMatches = video.improvement_areas?.filter(tag => improvementAreas.includes(tag)).length || 0;
      const channelMatch = preferredChannelIds.includes(video.channel_id) ? 1 : 0;
      const speakerTitle = String(video.channel_name || '').toLowerCase();
      const speakerMatch = preferredSpeakers.some((speaker) => speakerTitle.includes(String(speaker).toLowerCase())) ? 1 : 0;
      const viewCount = Number(video.view_count || 0);
      
      return {
        ...video,
        // Score = Total number of overlapping tags
        relevanceScore: focusMatches + improveMatches + (channelMatch * 4) + (speakerMatch * 2),
        popularityScore: Number.isFinite(viewCount) ? viewCount : 0
      };
    });

    // Sort descending by Score. (If scores are tied, show newest first)
    scoredVideos.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      if (b.popularityScore !== a.popularityScore) {
        return b.popularityScore - a.popularityScore;
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

    // 4. Return Top 10
    res.json(scoredVideos.slice(0, 10));

  } catch (error) {
    console.error('[Videos API] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

module.exports = router;
