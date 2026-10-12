const express = require('express');

// Member reads are intentionally separate from clergy editing/review routes.
const STUDY_FIELDS = ['study_id', 'slug', 'congregation_id', 'title', 'subtitle', 'study_method', 'created_at'];
const LESSON_FIELDS = ['lesson_id', 'study_id', 'lesson_number', 'title', 'scripture', 'key_verse', 'introduction', 'lesson_aims', 'study_outline', 'reflection_questions', 'discussion_starters', 'application_sidebar', 'conclusion', 'commentary'];
const MESSAGE_FIELDS = ['message_id', 'congregation_id', 'title', 'message_type', 'message_body', 'video_playback_id', 'created_at'];
const project = (row, fields) => Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]));
const isMemberBroadcast = (row) => row.is_published === true && !row.archived_at && (!row.status || row.status === 'sent') && (!row.recipient_scope || row.recipient_scope.type === 'all');

function createMemberContentRouter({ supabase, authenticateUser }) {
  const router = express.Router({ mergeParams: true });
  const notFound = (res) => res.status(404).json({ error: 'This church content is unavailable.' });
  const read = async (query) => {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  };
  const handle = (operation) => async (req, res, next) => {
    try { await operation(req, res, next); }
    catch (error) {
      console.error('[Member content] Read failed:', error.code || 'UNKNOWN');
      res.status(500).json({ error: 'Unable to load church content. Please try again.' });
    }
  };

  router.use(authenticateUser, handle(async (req, res, next) => {
    const congregationId = Number(req.params.congregationId);
    if (!Number.isSafeInteger(congregationId) || congregationId <= 0) return notFound(res);
    const membership = await read(supabase.from('congregation_members').select('member_id').eq('user_id', req.user.id).eq('congregation_id', congregationId).limit(1).maybeSingle());
    if (!membership) return res.status(403).json({ error: 'This content is available to congregation members.' });
    req.memberCongregationId = congregationId;
    // Express middleware must call next only after the membership query succeeds.
    next();
  }));

  const studyQuery = (req) => supabase.from('bible_studies').select('*').eq('congregation_id', req.memberCongregationId).eq('is_published', true);

  router.get('/', handle(async (req, res) => {
    const church = await read(supabase.from('congregations').select('congregation_id,name').eq('congregation_id', req.memberCongregationId).maybeSingle());
    if (!church) return notFound(res);
    const [studies, messages] = await Promise.all([
      read(studyQuery(req).order('created_at', { ascending: false })),
      read(supabase.from('pastoral_messages').select('*').eq('congregation_id', req.memberCongregationId).eq('is_published', true).order('created_at', { ascending: false }))
    ]);
    res.json({ church, studies: (studies || []).map((row) => project(row, STUDY_FIELDS)), messages: (messages || []).filter(isMemberBroadcast).map((row) => project(row, MESSAGE_FIELDS)) });
  }));

  router.get('/studies/:studyId', handle(async (req, res) => {
    const studyId = req.params.studyId;
    const study = await read(studyQuery(req).eq(/^\d+$/.test(studyId) ? 'study_id' : 'slug', studyId).maybeSingle());
    if (!study) return notFound(res);
    // Resolve slugs before fetching lessons, so both link forms return the same curriculum.
    const lessons = await read(supabase.from('bible_study_lessons').select('*').eq('study_id', study.study_id).order('lesson_number', { ascending: true }));
    res.json({ ...project(study, STUDY_FIELDS), lessons: (lessons || []).map((row) => project(row, LESSON_FIELDS)) });
  }));

  router.get('/lessons/:lessonId', handle(async (req, res) => {
    const lesson = await read(supabase.from('bible_study_lessons').select('*').eq('lesson_id', req.params.lessonId).maybeSingle());
    if (!lesson) return notFound(res);
    const study = await read(studyQuery(req).eq('study_id', lesson.study_id).maybeSingle());
    if (!study) return notFound(res);
    res.json(project(lesson, LESSON_FIELDS));
  }));

  router.get('/messages/:messageId', handle(async (req, res) => {
    const message = await read(supabase.from('pastoral_messages').select('*').eq('message_id', req.params.messageId).eq('congregation_id', req.memberCongregationId).eq('is_published', true).maybeSingle());
    if (!message || !isMemberBroadcast(message)) return notFound(res);
    res.json(project(message, MESSAGE_FIELDS));
  }));

  return router;
}

module.exports = { createMemberContentRouter };
