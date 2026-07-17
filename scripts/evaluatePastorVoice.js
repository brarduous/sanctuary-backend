const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { PDFParse } = require('pdf-parse');
const openai = require('../config/openai');
const { checkSourceSimilarity } = require('../utils/sourceSimilarity');

const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit');
const TARGET_EMAIL = String(process.env.TARGET_EMAIL || 'brandon.arduous@gmail.com').toLowerCase();
const MODEL = process.env.OPENAI_QUALITY_MODEL || 'gpt-5.6-sol';
const fixtureDir = path.resolve(__dirname, '../../sanctuary-clergy-web/qa-fixtures/sermon-voice/private-samples');
const resultDir = path.resolve(__dirname, '../../sanctuary-clergy-web/qa-fixtures/sermon-voice/evaluation-private');
const expectedFiles = ['man-who-was-a-fool.pdf', 'a-knock-at-midnight.pdf', 'loving-your-enemies.pdf'];
const expectedHashes = new Map([
  ['man-who-was-a-fool.pdf', 'e4bb1d74d3f0e6be9fbf798cd2ad879b25ed3412d5f3f8dd1365134be9338f79'],
  ['a-knock-at-midnight.pdf', '7fc23417ec0ec157c66a98301451a79e46c84b87e645624ed6b6aff042f3e0a5'],
  ['loving-your-enemies.pdf', '9c5fa956b710149a6c37c315dc22958479a825c242dcc6278cab2587321510b1'],
]);

const artifactSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'scripture', 'body', 'outline', 'formatNotes'],
  properties: {
    title: { type: 'string' }, scripture: { type: 'string' }, body: { type: 'string' },
    outline: { type: 'array', items: { type: 'string' } }, formatNotes: { type: 'array', items: { type: 'string' } },
  },
};
const scoringSchema = {
  type: 'object', additionalProperties: false, required: ['reviews'],
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'voiceConsistency', 'biblicalGrounding', 'preachabilityTeachability', 'pastoralSpecificity', 'structure', 'formatAdherence', 'originality', 'formatCompliant', 'biblicalAccuracyConcern', 'fabricatedQuotation', 'notes'],
        properties: {
          label: { type: 'string' }, voiceConsistency: { type: 'integer', minimum: 1, maximum: 10 }, biblicalGrounding: { type: 'integer', minimum: 1, maximum: 10 },
          preachabilityTeachability: { type: 'integer', minimum: 1, maximum: 10 }, pastoralSpecificity: { type: 'integer', minimum: 1, maximum: 10 },
          structure: { type: 'integer', minimum: 1, maximum: 10 }, formatAdherence: { type: 'integer', minimum: 1, maximum: 10 }, originality: { type: 'integer', minimum: 1, maximum: 10 },
          formatCompliant: { type: 'boolean' }, biblicalAccuracyConcern: { type: 'boolean' }, fabricatedQuotation: { type: 'boolean' }, notes: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        },
      },
    },
  },
};

const loadServiceRoleKey = () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'], { encoding: 'utf8' }));
  return keys.find((candidate) => candidate.name === 'service_role')?.api_key;
};

async function structured({ instructions, input, schema, name, maxOutputTokens }) {
  const startedAt = Date.now();
  const response = await openai.responses.create({ model: MODEL, instructions, input, reasoning: { effort: 'medium' }, store: false, max_output_tokens: maxOutputTokens, text: { format: { type: 'json_schema', name, schema, strict: true } } });
  return { data: JSON.parse(response.output_text), usage: response.usage, durationMs: Date.now() - startedAt, model: response.model };
}

async function loadSources() {
  return Promise.all(expectedFiles.map(async (filename) => {
    const fullPath = path.join(fixtureDir, filename);
    const buffer = fs.readFileSync(fullPath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    if (checksum !== expectedHashes.get(filename)) throw new Error(`Checksum mismatch for ${filename}.`);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const parsed = await parser.getText();
      return { title: filename.replace(/\.pdf$/, ''), checksum, text: parsed.text.trim() };
    } finally {
      if (typeof parser.destroy === 'function') await parser.destroy();
    }
  }));
}

async function activeProfile() {
  const db = createClient(`https://${PROJECT_REF}.supabase.co`, loadServiceRoleKey(), { auth: { persistSession: false } });
  let user = null;
  for (let page = 1; page <= 20 && !user; page += 1) {
    const result = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    user = result.data.users.find((candidate) => candidate.email?.toLowerCase() === TARGET_EMAIL) || null;
  }
  if (!user) throw new Error(`No auth user found for ${TARGET_EMAIL}.`);
  const result = await db.from('pastor_voice_profiles').select('id,profile,version').eq('user_id', user.id).eq('status', 'active').limit(1).single();
  if (result.error) throw result.error;
  return { userId: user.id, ...result.data };
}

const artifactDefinitions = [
  { id: 'pulpit_25_min', instruction: 'Write a complete 25-minute pulpit sermon (2,925–3,575 words) on Mark 5:21–43 and faithful presence amid interruption. It must be biblically grounded, directly preachable, original, and contain no invented personal anecdotes or quotations.' },
  { id: 'youtube_60_90_sec', instruction: 'Write a 60–90 second YouTube sermon (150–210 words) on Mark 5:21–43 and faithful presence amid interruption. Preserve pastoral cadence, open immediately, fit spoken video, and end with one clear application.' },
  { id: 'bible_study_four_lessons', instruction: 'Write a four-lesson expository Bible study on Mark 5:21–43 and faithful presence amid interruption. Clearly label all four lessons. Each needs passage focus, aims, concise commentary, facilitator guidance, discussion questions, and application. It must be pastoral but teachable rather than four sermon transcripts.' },
];

async function main() {
  const sources = await loadSources();
  const profile = await activeProfile();
  const fullContext = sources.map((source, index) => `PRIVATE SOURCE ${index + 1}\n${source.text}\nEND PRIVATE SOURCE`).join('\n\n');
  const treatments = {
    baseline: 'No pastor voice context is available. Use a warm, biblically grounded pastoral voice and do not invent congregational facts.',
    structured_profile: `Use only these derived traits; do not imitate or copy source prose: ${JSON.stringify(profile.profile)}`,
    full_private_context: `Derive rhetorical traits from all three private sources below, balanced equally. Do not name the author, quote, closely paraphrase, or reproduce distinctive language.\n${fullContext}`,
  };
  const runs = [];
  for (const artifact of artifactDefinitions) {
    for (const [treatment, context] of Object.entries(treatments)) {
      const response = await structured({
        instructions: 'Create original Christian pastoral content. Scripture, artifact format, duration, and lesson-count constraints outrank style personalization. Never attribute language to a source author and never fabricate quotations.',
        input: `${artifact.instruction}\n\nVOICE TREATMENT:\n${context}`,
        schema: artifactSchema, name: 'voice_evaluation_artifact', maxOutputTokens: artifact.id === 'pulpit_25_min' ? 10000 : artifact.id.includes('bible') ? 10000 : 1800,
      });
      const similarity = checkSourceSimilarity(response.data.body, sources);
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      runs.push({ artifact: artifact.id, treatment, response: response.data, originality: similarity, model: response.model, reasoning: 'medium', latencyMs: response.durationMs, inputTokens, outputTokens, estimatedCostUsd: Number(((inputTokens * 5 + outputTokens * 30) / 1_000_000).toFixed(6)) });
    }
  }

  const blindMap = {};
  const scored = [];
  for (const artifact of artifactDefinitions) {
    const labels = ['Treatment A', 'Treatment B', 'Treatment C'].sort(() => crypto.randomInt(0, 3) - 1);
    const artifactRuns = runs.filter((run) => run.artifact === artifact.id);
    artifactRuns.forEach((run, index) => { blindMap[`${artifact.id}:${labels[index]}`] = run.treatment; });
    const packet = artifactRuns.map((run, index) => `${labels[index]}\n${JSON.stringify(run.response)}`).join('\n\n');
    const score = await structured({
      instructions: 'Act as a blinded pastoral-content reviewer. Score only the supplied artifacts. Penalize theological imprecision, fabricated quotations, weak format compliance, caricature, and source-like phrasing. Do not infer treatment identities.',
      input: `REQUEST:\n${artifact.instruction}\n\nTARGET VOICE RUBRIC (traits only):\n${JSON.stringify(profile.profile)}\n\nBLINDED OUTPUTS:\n${packet}`,
      schema: scoringSchema, name: 'blinded_pastor_voice_scores', maxOutputTokens: 3500,
    });
    scored.push({ artifact: artifact.id, reviews: score.data.reviews });
  }

  for (const run of runs) {
    if (!run.originality.passed) run.hardFail = true;
    const blinded = Object.entries(blindMap).find(([key, treatment]) => key.startsWith(`${run.artifact}:`) && treatment === run.treatment)?.[0].split(':')[1];
    const review = scored.find((item) => item.artifact === run.artifact)?.reviews.find((item) => item.label === blinded);
    if (review?.biblicalAccuracyConcern || review?.fabricatedQuotation || !review?.formatCompliant) run.hardFail = true;
  }

  const summary = runs.map(({ response, ...run }) => ({ ...run, outputWordCount: response.body.match(/\S+/g)?.length || 0 }));
  fs.mkdirSync(resultDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(resultDir, `${stamp}-private-results.json`), JSON.stringify({ profileId: profile.id, sourceHashes: sources.map((source) => source.checksum), blindMap, runs, scored }, null, 2));
  fs.writeFileSync(path.join(resultDir, `${stamp}-aggregate.json`), JSON.stringify({ model: MODEL, reasoning: 'medium', promptVersion: 'pastor-voice-eval-v1', profileId: profile.id, sourceHashes: sources.map((source) => source.checksum), summary, scored, ownerPreferenceRequired: true }, null, 2));
  console.log(JSON.stringify({ status: 'evaluation_complete', privateResultDirectory: resultDir, aggregate: summary, ownerPreferenceRequired: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
