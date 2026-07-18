const normalizeGeneratedNumbering = (value) => {
  if (typeof value !== 'string') return value;
  if (!/(?:^|\s)2[.)]\s+/.test(value) || !/(?:^|\s)3[.)]\s+/.test(value)) return value;
  return value.replace(/(^|\s+)(\d+)[.)]\s+/g, (_match, prefix, number) => `${prefix.includes('\n') || !prefix ? prefix : '\n'}${number}. `);
};

const normalizeGeneratedListItems = (items) => {
  if (!Array.isArray(items)) return items;
  return items.flatMap((item) => {
    if (typeof item !== 'string') return item;
    return normalizeGeneratedNumbering(item)
      .split(/\n(?=\d+\.\s)/)
      .map((entry) => entry.replace(/^\d+\.\s+/, '').trim())
      .filter(Boolean);
  });
};

const normalizeGeneratedLessonLists = (lesson) => ({
  ...lesson,
  commentary: normalizeGeneratedNumbering(lesson.commentary),
  lesson_aims: normalizeGeneratedListItems(lesson.lesson_aims),
  study_outline: normalizeGeneratedListItems(lesson.study_outline),
  discussion_starters: normalizeGeneratedListItems(lesson.discussion_starters),
  application_sidebar: normalizeGeneratedListItems(lesson.application_sidebar),
  reflection_questions: normalizeGeneratedListItems(lesson.reflection_questions),
});

module.exports = { normalizeGeneratedNumbering, normalizeGeneratedListItems, normalizeGeneratedLessonLists };
