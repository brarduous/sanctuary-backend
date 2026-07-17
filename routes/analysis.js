const crypto = require('crypto');
const express = require('express');
const mammoth = require('mammoth');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { callStructuredResponse } = require('../utils/openaiResponses');
const { getActiveVoiceContext } = require('../utils/pastorVoice');

const router = express.Router();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 3, fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, done) => {
    const allowedExtension = /\.(pdf|docx|txt)$/i.test(file.originalname || '');
    done(ALLOWED_TYPES.has(file.mimetype) && allowedExtension ? null : new Error('Only PDF, DOCX, and TXT files are supported.'), ALLOWED_TYPES.has(file.mimetype) && allowedExtension);
  },
});

const voiceProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'preachingStructure', 'cadence', 'vocabularyTendencies', 'illustrationPatterns',
    'theologicalConstraints', 'congregationalContext', 'applicationStyle',
    'prohibitedCopying', 'summary', 'preachingStyle', 'oratoricalStyle',
    'customPreachingDesc', 'customOratoricalDesc',
  ],
  properties: {
    preachingStructure: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    cadence: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'sentencePatterns', 'repetitionPatterns', 'transitionPatterns'],
      properties: {
        summary: { type: 'string' },
        sentencePatterns: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        repetitionPatterns: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        transitionPatterns: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
    },
    vocabularyTendencies: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    illustrationPatterns: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    theologicalConstraints: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    congregationalContext: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    applicationStyle: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    prohibitedCopying: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 8 },
    summary: { type: 'string' },
    preachingStyle: { type: 'string' },
    oratoricalStyle: { type: 'string' },
    customPreachingDesc: { type: 'string' },
    customOratoricalDesc: { type: 'string' },
  },
};

async function extractDocument(file) {
  if (!file?.buffer?.length) throw new Error(`${file?.originalname || 'A file'} was empty.`);
  let text = '';
  if (file.mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try {
      const result = await parser.getText();
      text = result.text || '';
    } finally {
      if (typeof parser.destroy === 'function') await parser.destroy();
    }
  } else if (file.mimetype.includes('wordprocessing')) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    text = result.value || '';
  } else {
    text = file.buffer.toString('utf8');
  }
  const cleaned = text.replace(/\u0000/g, '').trim();
  if (cleaned.length < 100) throw new Error(`${file.originalname} did not contain enough extractable text.`);
  return cleaned;
}

const analyzeUploads = (req, res, next) => upload.array('files', 3)(req, res, (error) => {
  if (!error) return next();
  const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
    ? 'Each source file must be 10 MB or smaller.'
    : error.message;
  return res.status(400).json({ error: message });
});

router.post('/analyze-style', authenticateUser, analyzeUploads, async (req, res) => {
  const userId = req.user.id;
  const files = req.files || [];
  const rightsAttested = String(req.body?.rightsAttested || '') === 'true';
  const temporaryEvaluation = String(req.body?.temporaryEvaluation || '') === 'true';
  const retentionUntil = temporaryEvaluation
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  let createdProfileId = null;
  const createdSermonIds = [];
  let previousActiveIds = [];

  if (files.length < 1 || files.length > 3) {
    req.files = undefined;
    return res.status(400).json({ error: 'Upload between one and three source documents.' });
  }
  if (!rightsAttested) {
    req.files = undefined;
    return res.status(400).json({ error: 'You must confirm that you have the right to use these source documents.' });
  }

  try {
    // Nothing is persisted until every source has extracted successfully and the
    // balanced, complete analysis has validated against the response schema.
    const extracted = await Promise.all(files.map(async (file) => {
      const text = await extractDocument(file);
      return {
        title: file.originalname.replace(/\.[^/.]+$/, ''),
        originalName: file.originalname,
        mimeType: file.mimetype,
        text,
        checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        wordCount: text.match(/\S+/g)?.length || 0,
      };
    }));

    const sourceSections = extracted.map((source, index) => [
      `SOURCE ${index + 1} OF ${extracted.length}: ${source.title}`,
      `WORD COUNT: ${source.wordCount}`,
      source.text,
      `END SOURCE ${index + 1}`,
    ].join('\n')).join('\n\n');
    const context = await getActiveVoiceContext(userId);
    const result = await callStructuredResponse({
      schemaName: 'pastor_voice_profile',
      schema: voiceProfileSchema,
      maxOutputTokens: 5000,
      instructions: [
        'Derive a reusable pastor voice profile from every supplied source, weighting each document equally rather than letting the first or longest dominate.',
        'Describe traits and constraints only. Do not quote source prose, preserve distinctive phrases, identify or name an author, or claim facts not supported across the sources.',
        'The resulting profile must help create original sermons and teachable Bible studies without impersonating or copying a source author.',
      ].join(' '),
      input: `${context.congregation ? `CURRENT CONGREGATION: ${context.congregation.name}\n` : ''}${sourceSections}`,
    });

    const { data: existingProfiles, error: latestError } = await supabase
      .from('pastor_voice_profiles').select('id, version, status').eq('user_id', userId).order('version', { ascending: false });
    if (latestError) throw latestError;
    const nextVersion = ((existingProfiles || [])[0]?.version || 0) + 1;
    previousActiveIds = (existingProfiles || []).filter((profile) => profile.status === 'active').map((profile) => profile.id);
    const { data: profileRecord, error: profileError } = await supabase.from('pastor_voice_profiles').insert({
      user_id: userId,
      congregation_id: context.congregation?.congregation_id || null,
      version: nextVersion,
      status: 'draft',
      profile: result.data,
      source_hashes: extracted.map((source) => source.checksum),
      rights_attested: true,
      temporary_evaluation: temporaryEvaluation,
      retention_until: retentionUntil,
      review_status: 'unreviewed',
    }).select('*').single();
    if (profileError) throw profileError;
    createdProfileId = profileRecord.id;

    for (const source of extracted) {
      const tags = ['voice-source', ...(temporaryEvaluation ? ['temporary-evaluation'] : [])];
      const { data: sermon, error: sermonError } = await supabase.from('sermons').insert({
        user_id: userId,
        title: source.title,
        sermon_body: source.text,
        status: 'completed',
        tags,
        content_format: 'sermon',
        distribution_channel: 'pulpit',
      }).select('sermon_id').single();
      if (sermonError) throw sermonError;
      createdSermonIds.push(sermon.sermon_id);

      const { error: sourceError } = await supabase.from('pastor_voice_sources').insert({
        profile_id: createdProfileId,
        user_id: userId,
        sermon_id: sermon.sermon_id,
        title: source.title,
        checksum_sha256: source.checksum,
        mime_type: source.mimeType,
        rights_basis: temporaryEvaluation ? 'temporary_private_evaluation' : 'user_attested_authorized_use',
        temporary_evaluation: temporaryEvaluation,
        retention_until: retentionUntil,
        word_count: source.wordCount,
      });
      if (sourceError) throw sourceError;
    }

    const { error: archiveError } = await supabase.from('pastor_voice_profiles')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('status', 'active').neq('id', createdProfileId);
    if (archiveError) throw archiveError;
    const { error: activateError } = await supabase.from('pastor_voice_profiles')
      .update({ status: 'active', activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', createdProfileId).eq('user_id', userId);
    if (activateError) throw activateError;

    res.json({
      ...result.data,
      savedCount: createdSermonIds.length,
      profileId: createdProfileId,
      voiceProfile: result.data,
      sources: extracted.map(({ title, checksum, wordCount }) => ({ title, checksum, wordCount, retentionUntil })),
      model: result.model,
      reasoningEffort: result.reasoningEffort,
    });
  } catch (error) {
    // Roll back this request's partial rows without touching any prior profile.
    if (createdProfileId) await supabase.from('pastor_voice_profiles').delete().eq('id', createdProfileId).eq('user_id', userId);
    if (createdSermonIds.length) await supabase.from('sermons').delete().eq('user_id', userId).in('sermon_id', createdSermonIds);
    if (previousActiveIds.length) await supabase.from('pastor_voice_profiles').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId).in('id', previousActiveIds);
    console.error('[Voice analysis] Failed:', error.message);
    res.status(500).json({ error: 'Voice analysis failed. No source documents were saved.' });
  } finally {
    // memoryStorage is deliberate: request buffers are released here and no
    // temporary manuscript files can remain on disk after success or failure.
    req.files = undefined;
  }
});

module.exports = router;
module.exports.extractDocument = extractDocument;
module.exports.voiceProfileSchema = voiceProfileSchema;
