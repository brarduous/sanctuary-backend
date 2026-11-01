const test = require('node:test');
const assert = require('node:assert/strict');
const { articleBriefInput, parseNewsBriefResponse } = require('../utils/newsBrief');
const { applyAudiencePolicy, VERSION } = require('../utils/audienceContentPolicy');

// Isolate prompt composition from credentials and network. Deliberately stale
// templates exercise precedence and interpolation, not just policy constants.
const databasePath = require.resolve('../config/supabase');
const originalDatabaseModule = require.cache[databasePath];
require.cache[databasePath] = { exports: {
  from(table) {
    if (table === 'devotional_quality_runtime') return {
      select() { return this; }, eq() { return this; }, async maybeSingle() { return { data:null, error:null }; },
    };
    assert.equal(table, 'system_prompts');
    return { select() { return this; }, eq(_column, key) { this.key = key; return this; }, async single() {
      return { data: { content: this.key === 'daily_devotional_personalization_wrapper'
        ? '{{base_prompt}}\nKeep {{curriculum_title}} and {{curriculum_scripture_reference}}. {{curriculum_core_message}}'
        : this.key === 'general_devotional_generator'
          ? 'Legacy voice: formal and comprehensive; use 300 words. {{theme_title}}'
          : this.key === 'news_taxonomy_breakdown_generator'
            ? 'Legacy voice: formal and comprehensive; use 300 words. {{taxonomy_name}} {{synopses}}'
            : 'Legacy voice: formal and comprehensive; use 300 words.' }, error: null };
    } };
  },
} };
const prompts = require('../prompts');
const { EVAL_CONFIG } = require('../scripts/evaluatePrompts');
if (originalDatabaseModule) require.cache[databasePath] = originalDatabaseModule;
else delete require.cache[databasePath];

test('all reader generation paths apply audience policy after stale templates and quality overlays', async () => {
  const cases = [
    [() => prompts.getDailyDevotionalPrompt(), '120-160 words'],
    [() => prompts.getPersonalizedDevotionalPrompt({}, { title: 'Listen Before You Reply', scripture_reference: 'James 1:19', content: 'Listen before speaking.' }), 'Listen Before You Reply'],
    [() => prompts.getGeneralDevotionalBatchPrompt({ theme_title: 'Trust', scripture_focus: 'Psalms' }), 'Trust'],
    [() => prompts.getAdviceGuidancePrompt(), '15-35 words'],
    [() => prompts.getScripturalOutlookPrompt(), 'news-reader-copy-v2'],
    [() => prompts.getDailyNewsSynopsisPrompt(), 'TLDR with Christian judgment'],
    [() => prompts.getNewsTaxonomyBreakdownPrompt({ taxonomyName: 'Housing', synopses: 'Council approves housing plan.' }), 'Housing'],
  ];
  for (const [generate, expected] of cases) {
    const result = await generate();
    assert.ok(result.includes(expected));
    assert.ok(result.includes(VERSION));
    assert.ok(result.indexOf('# FINAL AUDIENCE COPY POLICY') > result.indexOf('Legacy voice:'));
    assert.ok(!result.includes('{{'));
  }
  const advice = await prompts.getAdviceGuidancePrompt();
  assert.ok(advice.includes('explicit consent'));
  assert.ok(advice.indexOf('# FINAL AUDIENCE COPY POLICY') > advice.indexOf('GUIDANCE OUTPUT REQUIREMENTS'));
  const news = await prompts.getScripturalOutlookPrompt();
  assert.ok(news.includes('originalArticleAssessment'));
  assert.ok(news.indexOf('# FINAL AUDIENCE COPY POLICY') > news.indexOf('CLAIM ASSESSMENT RUBRIC'));
  assert.equal(applyAudiencePolicy('sermon_generator', 'Clergy template'), 'Clergy template');
});

test('daily brief uses factual summaries from object and serialized outlooks, with legacy fallback', () => {
  const article = { article_title: 'Proposal awaits a vote', article_body: 'Full raw article', ai_outlook: { newsSummary: 'Officials proposed a change; no vote has occurred.', synopsis: 'Legacy summary', outlook: 'Faith reflection' } };
  assert.equal(articleBriefInput(article), articleBriefInput({ ...article, ai_outlook: JSON.stringify(article.ai_outlook) }));
  assert.ok(articleBriefInput(article).includes('no vote has occurred'));
  assert.ok(!articleBriefInput(article).includes('Faith reflection'));
  assert.ok(articleBriefInput({ ...article, ai_outlook: { synopsis: 'Older factual summary' } }).includes('Older factual summary'));
  assert.ok(articleBriefInput({ ...article, ai_outlook: '{broken' }).includes('Full raw article'));
});

test('daily brief rejects malformed or prayer-only outputs and retains usage with valid nuggets', () => {
  const valid = {synopsis:'A reported development.',details:'Officials explained the proposal; a vote has not yet taken place.',stories:[{headline:'A housing proposal',summary:'The council proposed new housing support.',christianAssessment:{verdict:'aligned',focusType:'reported_conduct',focus:'Care for neighbors',reason:'Helping neighbors find shelter reflects justice and mercy.',scriptureReference:'Micah 6:8'}}],thought_to_remember:'A short original reflection.',prayer:'Lord, help our neighbors.'};
  const parsed=parseNewsBriefResponse(JSON.stringify(valid),321);assert.equal(parsed.tokens,321);assert.equal(parsed.details,valid.details);assert.match(parsed.synopsis,/Christian assessment/);assert.match(parsed.synopsis,/Micah 6:8/);assert.equal(parsed.stories.length,1);
  for (const invalid of ['not json', 'null', '[]', JSON.stringify({ ...valid, synopsis: '' }), JSON.stringify({ ...valid, synopsis: ['wrong type'] }), JSON.stringify({ prayer: valid.prayer })]) {
    assert.throws(() => parseNewsBriefResponse(invalid, 0));
  }
});

test('editorial evaluation grades effective prompts and includes slides and daily-brief fields', async () => {
  for (const key of ['daily_devotional_generator', 'advice_guidance_generator', 'news_generator', 'daily_news_synopsis']) {
    const config = EVAL_CONFIG.find(row => row.promptKey === key);
    assert.ok((await config.effectivePrompt()).includes(VERSION));
    assert.ok(config.criteria.includes('Grade actual samples separately from prompt design'));
  }
  const devotional = EVAL_CONFIG.find(row => row.promptKey === 'daily_devotional_generator');
  const sample = await devotional.sampleBuilder([{ devotional_id: 1, title: 'Sample', content: 'Body', scripture: 'James 1:19', short_form: { slides: [{ text: 'A short hook' }] } }]);
  assert.ok(sample.includes('A short hook'));
  const brief = EVAL_CONFIG.find(row => row.promptKey === 'daily_news_synopsis');
  assert.equal(brief.table, 'daily_news_synopses');
  assert.ok((await brief.sampleBuilder([{ id: 1, synopsis: 'News', scripture: 'Original thought', prayer: 'Prayer' }])).includes('Original thought'));
});
