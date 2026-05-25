const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');
const { searchSpotifyArtists, searchSpotifyTracks } = require('../utils/spotify');

// Helper to format JS array to Postgres array string
const toPgArray = (arr) => {
  if (!arr || arr.length === 0) return '{}';
  const quoted = arr.map(item => `"${item.replace(/"/g, '\\"')}"`); 
  return `{${quoted.join(',')}}`;
};

const normalizeFavoriteArtists = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((artist) => {
      if (typeof artist === 'string') return { name: artist.trim() };
      return {
        id: String(artist?.id || '').trim(),
        name: String(artist?.name || '').trim(),
      };
    })
    .filter((artist) => artist.name);
};

const getProfileMusicPreferences = async (userId) => {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_preferences')
    .eq('user_id', userId)
    .single();

  const musicPreferences = profile?.user_preferences?.musicPreferences || {};
  return {
    favoriteGospelArtists: normalizeFavoriteArtists(musicPreferences.favoriteGospelArtists),
  };
};

const buildSpotifyQuery = ({ query, title, scripture, content, prayer, favoriteArtists }) => {
  if (query && String(query).trim()) return String(query).trim();

  const artistNames = favoriteArtists.map((artist) => artist.name).slice(0, 2);
  const sourceText = [title, scripture, content, prayer]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w\s:'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return [
    sourceText,
    artistNames.join(' '),
    'gospel worship christian',
  ]
    .filter(Boolean)
    .join(' ');
};

router.get('/playlist', auth, async (req, res) => {
  try {
    const { activity } = req.query; // 'gym', 'sleep', 'commute'
    const userId = req.user.id;

    if (!activity) return res.status(400).json({ error: 'Activity required' });

    // 1. Get User Profile (to know their "Vibe")
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('focus_areas, improvement_areas')
      .eq('user_id', userId)
      .single();

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const userFocus = profile.focus_areas || [];
    const userImprovement = profile.improvement_areas || [];

    // 2. Fetch tracks that match the ACTIVITY first (The "Must Have")
    // We fetch a batch (50) to filter/sort in memory for better precision
    const { data: tracks, error } = await supabase
      .from('curated_tracks')
      .select('*')
      .contains('activities', [activity]) 
      .eq('is_active', true)
      .limit(50);

    if (error) throw error;

    // 3. SCORING ALGORITHM
    // Rank tracks by how well they match the user's specific spiritual needs
    const scoredTracks = tracks.map(track => {
      let score = 0;
      
      // +2 Points for Focus Area Match (High Priority)
      const focusMatches = track.focus_areas?.filter(f => userFocus.includes(f)).length || 0;
      score += (focusMatches * 2);

      // +1 Point for Improvement Area Match
      const impMatches = track.improvement_areas?.filter(i => userImprovement.includes(i)).length || 0;
      score += impMatches;
      
      // Randomize slightly to keep playlists fresh if scores are tied
      const freshness = Math.random() * 0.5;

      return { ...track, score: score + freshness };
    });

    // 4. Sort Descending & Return Top 15
    scoredTracks.sort((a, b) => b.score - a.score);
    
    res.json(scoredTracks.slice(0, 15));

  } catch (err) {
    console.error('[Music API] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
});

router.get('/spotify/artists', auth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limitRaw = Number.parseInt(String(req.query.limit || '8'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 8;

    const artists = await searchSpotifyArtists(q, limit);
    res.json(artists);
  } catch (err) {
    console.error('[Music API] Spotify artist search error:', err.message);
    res.status(500).json({ error: 'Failed to search Spotify artists' });
  }
});

router.post('/spotify/recommend-track', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { favoriteGospelArtists } = await getProfileMusicPreferences(userId);
    const query = buildSpotifyQuery({
      query: req.body?.query,
      title: req.body?.title,
      scripture: req.body?.scripture,
      content: req.body?.content,
      prayer: req.body?.prayer,
      favoriteArtists: favoriteGospelArtists,
    });

    const tracks = await searchSpotifyTracks(query, 10);
    const previewTrack = tracks.find((track) => track.previewUrl);
    const track = previewTrack || tracks[0] || null;

    res.json({
      query,
      track,
      favoriteGospelArtists,
    });
  } catch (err) {
    console.error('[Music API] Spotify recommendation error:', err.message);
    res.status(500).json({ error: 'Failed to recommend Spotify track' });
  }
});

module.exports = router;
