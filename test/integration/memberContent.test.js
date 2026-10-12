const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMemberContentRouter } = require('../../routes/memberContent');

// Queryable fixtures exercise the real Express authentication, membership,
// publication filters and public response projections without production data.
const fixtures = {
  congregation_members: [{ member_id: 1, user_id: 'member', congregation_id: 1 }],
  congregations: [{ congregation_id: 1, name: 'Grace', invite_token: 'private-invite' }],
  bible_studies: [
    { study_id: 10, slug: 'published-study', congregation_id: 1, is_published: true, title: 'Published', user_id: 'pastor', pastor_review: 'private' },
    { study_id: 11, congregation_id: 1, is_published: false, title: 'Draft' },
    { study_id: 20, congregation_id: 2, is_published: true, title: 'Other church' }
  ],
  bible_study_lessons: [
    { lesson_id: 100, study_id: 10, lesson_number: 2, title: 'Second', commentary: 'Member reading', key_verse: 'Proverbs 25:28', generation_prompt: 'private' },
    { lesson_id: 101, study_id: 10, lesson_number: 1, title: 'First' },
    { lesson_id: 110, study_id: 11, lesson_number: 1, title: 'Draft lesson' },
    { lesson_id: 200, study_id: 20, lesson_number: 1, title: 'Other church lesson' }
  ],
  pastoral_messages: [
    { message_id: 1, congregation_id: 1, is_published: true, title: 'Legacy announcement', message_body: '<p>Welcome</p>', author_id: 'private', delivery_summary: 'private' },
    { message_id: 2, congregation_id: 1, is_published: true, status: 'sent', recipient_scope: { type: 'all' }, title: 'Broadcast', video_playback_id: 'playback' },
    { message_id: 3, congregation_id: 1, is_published: false, title: 'Draft' },
    { message_id: 4, congregation_id: 2, is_published: true, title: 'Other church' },
    { message_id: 5, congregation_id: 1, is_published: true, archived_at: '2026-10-01', title: 'Archived' },
    { message_id: 6, congregation_id: 1, is_published: true, status: 'scheduled', title: 'Scheduled' },
    { message_id: 7, congregation_id: 1, is_published: true, recipient_scope: { type: 'group', id: 99 }, title: 'Private group' }
  ]
};
let failureTable = null;
const supabase = { from(table) {
  let rows = [...(fixtures[table] || [])];
  let singular = false;
  let columns = null;
  const query = {
    select(value) { columns = value === '*' ? null : value.split(','); return query; },
    eq(key, value) { rows = rows.filter((row) => String(row[key]) === String(value)); return query; },
    order(key, { ascending }) { rows.sort((a, b) => ascending ? a[key] - b[key] : b[key] - a[key]); return query; },
    limit(n) { rows = rows.slice(0, n); return query; },
    maybeSingle() { singular = true; return query; },
    then(resolve, reject) {
      const selected = columns ? rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key]]))) : rows;
      return Promise.resolve(failureTable === table ? { data: null, error: { code: 'DB_UNAVAILABLE' } } : { data: singular ? selected[0] || null : selected, error: null }).then(resolve, reject);
    }
  };
  return query;
} };
const authenticateUser = (req, res, next) => {
  const id = req.get('x-test-user');
  if (!id) return res.status(401).json({ error: 'Unauthenticated' });
  req.user = { id };
  next();
};
let server;
let base;
test.before(async () => {
  const app = express();
  app.use('/api/congregations/:congregationId/content', createMemberContentRouter({ supabase, authenticateUser }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/congregations`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
const get = async (path, user = 'member') => {
  const response = await fetch(`${base}/${path}`, { headers: user ? { 'x-test-user': user } : {} });
  return { status: response.status, body: await response.json() };
};

test('authentication and church membership are required for list and details', async () => {
  for (const suffix of ['', '/studies/10', '/lessons/100', '/messages/1']) {
    assert.equal((await get(`1/content${suffix}`, null)).status, 401);
    assert.equal((await get(`1/content${suffix}`, 'outsider')).status, 403);
    assert.equal((await get(`2/content${suffix}`)).status, 403);
  }
  assert.equal((await get('invalid/content')).status, 404);
});

test('member list includes only published public broadcasts and safe study fields', async () => {
  const { status, body } = await get('1/content');
  assert.equal(status, 200);
  assert.deepEqual(body.studies.map((row) => row.study_id), [10]);
  assert.deepEqual(body.messages.map((row) => row.message_id), [1, 2]);
  assert.equal(body.church.invite_token, undefined);
  assert.equal(body.studies[0].user_id, undefined);
  assert.equal(body.studies[0].pastor_review, undefined);
  assert.equal(body.messages[0].author_id, undefined);
  assert.equal(body.messages[0].delivery_summary, undefined);
});

test('numeric and slug study links return ordered lessons without private fields', async () => {
  for (const id of ['10', 'published-study']) {
    const { status, body } = await get(`1/content/studies/${id}`);
    assert.equal(status, 200);
    assert.equal(body.title, 'Published');
    assert.deepEqual(body.lessons.map((row) => row.lesson_id), [101, 100]);
    assert.equal(body.lessons[1].generation_prompt, undefined);
    assert.equal(body.lessons[1].key_verse, 'Proverbs 25:28');
    assert.equal(body.pastor_review, undefined);
  }
});

test('draft, missing and other-church studies and lessons are unavailable', async () => {
  for (const path of ['studies/11', 'studies/20', 'studies/missing', 'lessons/110', 'lessons/200', 'lessons/999']) {
    assert.equal((await get(`1/content/${path}`)).status, 404, path);
  }
  const { status, body } = await get('1/content/lessons/100');
  assert.equal(status, 200);
  assert.equal(body.commentary, 'Member reading');
  assert.equal(body.key_verse, 'Proverbs 25:28');
  assert.equal(body.generation_prompt, undefined);
});

test('member can open a broadcast but cannot open drafts, other churches, archived, scheduled or group messages', async () => {
  assert.equal((await get('1/content/messages/1')).body.message_body, '<p>Welcome</p>');
  assert.equal((await get('1/content/messages/2')).body.video_playback_id, 'playback');
  for (const id of [3, 4, 5, 6, 7, 999]) assert.equal((await get(`1/content/messages/${id}`)).status, 404);
});

test('database failures fail closed rather than returning partial content', async () => {
  for (const table of ['congregation_members', 'bible_studies', 'pastoral_messages']) {
    failureTable = table;
    const { status, body } = await get('1/content');
    assert.equal(status, 500);
    assert.equal(body.studies, undefined);
  }
  failureTable = null;
});
