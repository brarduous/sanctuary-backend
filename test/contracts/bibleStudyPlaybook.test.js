const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '../../routes/bibleStudies.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20260920163000_bible_study_research_playbook.sql'),
  'utf8'
);

test('Bible study generation uses the research-grounded teaching playbook', () => {
  for (const marker of [
    'Hook → Book → Look → Took',
    'Audience need:',
    'Warm-up —',
    'Observation —',
    'Interpretation —',
    'Tension —',
    'Application —',
    'head, heart, and hands',
    '450–650 words per lesson',
    'human pastoral review before publication',
  ]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(route, /one clear learner-facing purpose and a coherent transformational arc/);
  assert.match(route, /Make every lesson facilitation-ready/);
  assert.match(migration, /where key = 'bible_study_generator'/);
});
