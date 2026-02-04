const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

// Helper: Format JS array to Postgres array string
const toPgArray = (arr) => {
  if (!arr || arr.length === 0) return '{}';
  const quoted = arr.map(item => `"${item.replace(/"/g, '\\"')}"`); 
  return `{${quoted.join(',')}}`;
};

router.get('/recommended', auth, async (req, res) => {
  try {
    const userId = req.user.id;

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

    const { focusAreas = [], improvementAreas = [] } = profile.user_preferences;
    
    // Convert to Postgres format for the query
    const focusString = toPgArray(focusAreas);
    const improveString = toPgArray(improvementAreas);
    // 2. Query Candidates
    // We fetch more than we display (limit 50) so we can sort the "best" ones to the top.
    const { data: candidates, error: videoError } = await supabase
      .from('recommended_videos')
      .select('*')
      .or(`focus_areas.ov.${focusString},improvement_areas.ov.${improveString}`)
      .eq('is_active', true)
      .limit(50);

    if (videoError) throw videoError;

    // 3. Score & Sort (The "Relevance" Logic)
    const scoredVideos = (candidates || []).map(video => {
      // Count how many tags match the user's profile
      const focusMatches = video.focus_areas?.filter(tag => focusAreas.includes(tag)).length || 0;
      const improveMatches = video.improvement_areas?.filter(tag => improvementAreas.includes(tag)).length || 0;
      
      return {
        ...video,
        // Score = Total number of overlapping tags
        relevanceScore: focusMatches + improveMatches
      };
    });

    // Sort descending by Score. (If scores are tied, show newest first)
    scoredVideos.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
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