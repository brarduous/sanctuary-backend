const axios = require('axios');

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

const getSpotifyCredentials = () => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
  }

  return { clientId, clientSecret };
};

const getSpotifyToken = async () => {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 30000) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret } = getSpotifyCredentials();
  const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  tokenCache = {
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  };

  return tokenCache.accessToken;
};

const spotifyGet = async (path, params) => {
  const accessToken = await getSpotifyToken();
  const response = await axios.get(`https://api.spotify.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params,
  });

  return response.data;
};

const mapArtist = (artist) => ({
  id: artist.id,
  name: artist.name,
  genres: artist.genres || [],
  imageUrl: artist.images?.[0]?.url || null,
  spotifyUrl: artist.external_urls?.spotify || null,
  popularity: artist.popularity || 0,
});

const mapTrack = (track) => ({
  id: track.id,
  title: track.name,
  artist: track.artists?.map((artist) => artist.name).join(', ') || 'Spotify',
  album: track.album?.name || null,
  imageUrl: track.album?.images?.[0]?.url || null,
  spotifyUrl: track.external_urls?.spotify || null,
  previewUrl: track.preview_url || null,
  durationMs: track.duration_ms || null,
  popularity: track.popularity || 0,
  provider: 'spotify',
});

const searchSpotifyArtists = async (query, limit = 8) => {
  if (!query || !query.trim()) return [];

  const data = await spotifyGet('/search', {
    q: query.trim(),
    type: 'artist',
    market: 'US',
    limit,
  });

  return (data.artists?.items || []).map(mapArtist);
};

const searchSpotifyTracks = async (query, limit = 10) => {
  if (!query || !query.trim()) return [];

  const data = await spotifyGet('/search', {
    q: query.trim(),
    type: 'track',
    market: 'US',
    limit,
  });

  return (data.tracks?.items || []).map(mapTrack);
};

module.exports = {
  searchSpotifyArtists,
  searchSpotifyTracks,
};
