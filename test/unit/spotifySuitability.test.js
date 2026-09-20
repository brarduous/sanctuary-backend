const test = require('node:test');
const assert = require('node:assert/strict');

const { isMinistrySafeTrack, selectMinistrySafeTrack } = require('../../utils/spotify');

test('rejects explicit and secular tracks even when a search query matched them', () => {
  assert.equal(isMinistrySafeTrack({ explicit: true, genres: ['gospel'], artistNames: ['Artist'] }), false);
  assert.equal(isMinistrySafeTrack({ explicit: false, genres: ['r&b', 'west coast hip hop'], artistNames: ['Blxst', 'Ty Dolla $ign'] }), false);
});

test('accepts non-explicit ministry genres without letting preferences bypass safety', () => {
  assert.equal(isMinistrySafeTrack({ explicit: false, genres: ['christian pop'], artistNames: ['Artist'] }), true);
  assert.equal(isMinistrySafeTrack(
    { explicit: false, genres: [], artistNames: ['Favorite Singer'] },
    { favoriteArtists: [{ name: 'Favorite Singer' }] }
  ), false);
});

test('selection fails closed instead of falling back to an unsuitable result', () => {
  const tracks = [
    { id: 'secular', explicit: false, genres: ['pop rap'], artistNames: ['Secular Artist'], previewUrl: 'preview' },
    { id: 'worship', explicit: false, genres: ['worship'], artistNames: ['Worship Artist'], previewUrl: null },
  ];
  assert.equal(selectMinistrySafeTrack(tracks)?.id, 'worship');
  assert.equal(selectMinistrySafeTrack([tracks[0]]), null);
});

test('ranks a preferred artist only after every candidate passes safety', () => {
  const selected = selectMinistrySafeTrack([
    { id: 'other', explicit: false, genres: ['gospel'], artistNames: ['Other Artist'], previewUrl: 'preview' },
    { id: 'favorite', explicit: false, genres: ['worship'], artistNames: ['Favorite Artist'], previewUrl: null },
  ], { favoriteArtists: [{ name: 'Favorite Artist' }] });
  assert.equal(selected.id, 'favorite');
});
