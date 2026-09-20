const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '../../routes/devotionals.js'), 'utf8');
const prompts = fs.readFileSync(path.join(__dirname, '../../prompts.js'), 'utf8');

test('devotional generation uses authenticated, saved personalization context', () => {
  assert.match(route, /const userId = req\.user\.id/);
  assert.match(route, /personal_growth_profiles/);
  assert.match(route, /ai_tuning_notes/);
  assert.match(route, /favoriteGospelArtists/);
  assert.match(route, /recentDevotionals/);
  assert.match(prompts, /user_recent_devotionals/);
  assert.match(prompts, /user_music_preferences/);
});
