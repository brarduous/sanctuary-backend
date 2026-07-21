const crypto = require('crypto');

const DEFAULT_TIME_ZONE = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

function isValidTimeZone(value) {
  if (!value || typeof value !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
}

function localParts(now, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, weekday: values.weekday, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function parseTimeMinutes(value) {
  const [hour, minute] = String(value || '00:00').split(':').map(Number);
  return hour * 60 + minute;
}

function isWithinWindow(currentMinutes, targetTime, windowMinutes = 15) {
  const target = parseTimeMinutes(targetTime);
  return currentMinutes >= target && currentMinutes < target + windowMinutes;
}

function isWithinQuietHours(currentMinutes, start = '21:00', end = '08:00') {
  const startMinutes = parseTimeMinutes(start); const endMinutes = parseTimeMinutes(end);
  return startMinutes <= endMinutes ? currentMinutes >= startMinutes && currentMinutes < endMinutes : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function isoWeek(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value - yearStart) / DAY_MS) + 1) / 7);
}

function copyVariant(now) { return ((isoWeek(now) - 1) % 4) + 1; }
function cohortBucket(userId) { return crypto.createHash('sha256').update(String(userId)).digest().readUInt32BE(0) % 100; }
function stagePercentage(stage) { return stage === '100' ? 100 : stage === '50' ? 50 : stage === '10' ? 10 : 0; }

function isInRollout(profile, stage, configuredInternalIds = new Set()) {
  if (stage === 'dry_run') return false;
  if (stage === 'internal') return profile.subscription_tier === 'admin' || configuredInternalIds.has(profile.user_id);
  return cohortBucket(profile.user_id) < stagePercentage(stage);
}

function devotionalCopy({ title, scripture, variant, weekday }) {
  const reference = scripture ? ` — ${scripture}` : '';
  const weeklyPrompt = weekday === 'Mon' ? ' What do you want to carry into this week with God?' : weekday === 'Fri' ? ' Where did you notice grace this week?' : '';
  const variants = {
    1: { heading: 'Your daily devotional is ready', body: `${title}${reference}. Read it, then share today's verse with a friend.` },
    2: { heading: 'A moment for Scripture', body: `Today's devotional: ${title}. Who could use this encouragement today?` },
    3: { heading: 'Begin with what matters', body: `${title}${reference}. Share the verse with a friend.` },
    4: { heading: 'Pause, pray, and reflect', body: `Spend a few minutes with ${title}, then invite a friend into the reflection.` },
  };
  return { ...variants[variant], body: `${variants[variant].body}${weeklyPrompt}` };
}

module.exports = { DAY_MS, DEFAULT_TIME_ZONE, cohortBucket, copyVariant, devotionalCopy, isInRollout, isValidTimeZone, isWithinQuietHours, isWithinWindow, localParts, parseTimeMinutes, stagePercentage };
