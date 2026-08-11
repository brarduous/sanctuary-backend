const ITEM_TYPES = new Set(['sermon_summary','key_ideas','daily_devotional','guided_prayer','small_group_guide','family_prompts','member_reflection','congregational_response','email_draft','social_caption','shareable_quote']);
const requiredSlots = [
  ['sermon_summary',1], ['key_ideas',1],
  ...Array.from({ length: 5 }, (_, i) => ['daily_devotional', i + 1]),
  ...Array.from({ length: 5 }, (_, i) => ['guided_prayer', i + 1]),
  ['small_group_guide',1], ['family_prompts',1], ['member_reflection',1], ['congregational_response',1], ['email_draft',1],
  ...Array.from({ length: 3 }, (_, i) => ['social_caption', i + 1]),
  ...Array.from({ length: 3 }, (_, i) => ['shareable_quote', i + 1]),
];
const slugify = (value) => String(value || 'weekly-journey').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'weekly-journey';
const journeyReminderAt = (startsAt, releaseDay, releaseTime) => {
  const reminder = new Date(startsAt); const [hour, minute] = String(releaseTime || '08:00').split(':').map(Number);
  reminder.setUTCDate(reminder.getUTCDate() + releaseDay); reminder.setUTCHours(Number.isFinite(hour) ? hour : 8, Number.isFinite(minute) ? minute : 0, 0, 0); return reminder;
};
const BIBLE_BOOKS = '(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2) Samuel|(?:1|2) Kings|(?:1|2) Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of (?:Songs|Solomon)|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2) Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2) Thessalonians|(?:1|2) Timothy|Titus|Philemon|Hebrews|James|(?:1|2) Peter|(?:1|2|3) John|Jude|Revelation)';
const extractScriptureReferences = (text) => [...new Set((String(text || '').match(new RegExp(`\\b${BIBLE_BOOKS}\\s+\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?`, 'g')) || []).slice(0, 100))];
module.exports = { ITEM_TYPES, requiredSlots, slugify, journeyReminderAt, extractScriptureReferences };
