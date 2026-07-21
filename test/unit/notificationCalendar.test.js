const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cohortBucket,
  copyVariant,
  devotionalCopy,
  isInRollout,
  isValidTimeZone,
  isWithinQuietHours,
  isWithinWindow,
  localParts,
} = require('../../utils/notificationCalendarRules');

test('uses recipient-local time across DST boundaries', () => {
  assert.deepEqual(localParts(new Date('2026-07-21T13:00:00Z'), 'America/New_York'), { date: '2026-07-21', weekday: 'Tue', minutes: 540 });
  assert.deepEqual(localParts(new Date('2026-12-21T14:00:00Z'), 'America/New_York'), { date: '2026-12-21', weekday: 'Mon', minutes: 540 });
  assert.equal(isValidTimeZone('America/Los_Angeles'), true);
  assert.equal(isValidTimeZone('Not/A_Zone'), false);
});

test('enforces send windows and quiet hours crossing midnight', () => {
  assert.equal(isWithinWindow(540, '09:00'), true);
  assert.equal(isWithinWindow(554, '09:00'), true);
  assert.equal(isWithinWindow(555, '09:00'), false);
  assert.equal(isWithinQuietHours(22 * 60, '21:00', '08:00'), true);
  assert.equal(isWithinQuietHours(7 * 60 + 59, '21:00', '08:00'), true);
  assert.equal(isWithinQuietHours(8 * 60, '21:00', '08:00'), false);
});

test('assigns deterministic rollout cohorts and internal users', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  assert.equal(cohortBucket(userId), cohortBucket(userId));
  assert.equal(isInRollout({ user_id: userId, subscription_tier: 'free' }, 'internal', new Set([userId])), true);
  assert.equal(isInRollout({ user_id: userId, subscription_tier: 'admin' }, 'internal'), true);
  assert.equal(isInRollout({ user_id: userId, subscription_tier: 'free' }, 'dry_run'), false);
  assert.equal(isInRollout({ user_id: userId, subscription_tier: 'free' }, '100'), true);
});

test('rotates copy by ISO week and folds Monday and Friday prompts into one message', () => {
  assert.equal(copyVariant(new Date('2026-01-05T12:00:00Z')), 2);
  const monday = devotionalCopy({ title: 'Steady Hope', scripture: 'Romans 5:5', variant: 1, weekday: 'Mon' });
  const friday = devotionalCopy({ title: 'Steady Hope', scripture: 'Romans 5:5', variant: 4, weekday: 'Fri' });
  assert.match(monday.body, /Steady Hope/);
  assert.match(monday.body, /carry into this week/);
  assert.match(friday.body, /notice grace this week/);
});
