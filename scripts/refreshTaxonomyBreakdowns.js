const OpenAI = require('openai');
const supabase = require('../config/supabase');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TAXONOMY_PROMPT = `# ROLE
You are a concise news analyst for a Christian news app.

# INPUT
Topic/Category Name: {{taxonomy_name}}
Recent Article Synopses:
{{synopses}}

# TASK
1. Summarize what this topic/category is about in the current news cycle.
2. If the subject naturally deserves a Christian worldview take, add one brief pastoral sentence about truth, wisdom, dignity, justice, mercy, peace, stewardship, or neighbor-love.
3. If the subject does not naturally deserve a spiritual outlook (for example Sports, routine Entertainment, Weather, Traffic, or market-score style updates), only summarize the category plainly with no moral, pastoral, or spiritual application.
4. Create an image generation prompt for this topic influenced by the recent synopses.

# WRITING RULES
- The breakdown must be 2-3 sentences total.
- Do not quote, cite, name, or reference any scripture passage, Bible book, chapter, or verse.
- Do not use the words "scripture", "biblical", "verse", "Micah", or "prophetic".
- Avoid generic repeated phrases. Make the breakdown specific to the taxonomy name and the supplied synopses.
- Keep the tone calm, nonpartisan, and news-aware.
- For Sports and similar recreational categories, describe the teams, events, logistics, stakes, and public-interest angles only.

# IMAGE STYLE REQUIREMENTS
- Style: photorealistic journalistic photograph suitable for a news article image.
- If the subject is a real person, satirical political-cartoon styling is allowed.
- No text in the image.

# OUTPUT
Return valid JSON only:
{
  "scriptural_breakdown": "string",
  "image_prompt": "string"
}`;

const RECENT_WINDOW_DAYS = Number(process.env.TAXONOMY_REFRESH_DAYS || 15);
const MIN_RECENT_ARTICLES = Number(process.env.TAXONOMY_REFRESH_THRESHOLD || 10);
const MAX_ITEMS = Number(process.env.TAXONOMY_REFRESH_LIMIT || 0);
const OPENAI_MODEL = process.env.TAXONOMY_REFRESH_MODEL || 'gpt-5-mini';
const CONCURRENCY = Math.max(1, Number(process.env.TAXONOMY_REFRESH_CONCURRENCY || 3));
const TYPES = (process.env.TAXONOMY_REFRESH_TYPES || 'category,topic')
  .split(',')
  .map(type => type.trim().toLowerCase())
  .filter(Boolean);

function renderPrompt(taxonomyName, synopses) {
  return TAXONOMY_PROMPT
    .replace('{{taxonomy_name}}', taxonomyName)
    .replace('{{synopses}}', synopses);
}

async function updateLivePrompt() {
  const { error } = await supabase
    .from('system_prompts')
    .upsert({
      key: 'news_taxonomy_breakdown_generator',
      content: TAXONOMY_PROMPT,
    }, { onConflict: 'key' });

  if (error) throw error;
  console.log('Updated live news_taxonomy_breakdown_generator prompt.');
}

async function fetchAll(table, select) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function fetchRecentRelations({ relationTable, idColumn }) {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(relationTable)
      .select(`
        id,
        ${idColumn},
        scriptural_outlooks!inner (
          created_at,
          ai_outlook
        )
      `)
      .gte('scriptural_outlooks.created_at', since)
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function generateBreakdown(name, synopses) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: renderPrompt(name, synopses.join('\n\n')) },
      { role: 'user', content: 'Generate JSON only.' },
    ],
    max_completion_tokens: 2400,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  return JSON.parse(content);
}

async function refreshType(type) {
  const isCategory = type === 'category';
  const table = isCategory ? 'categories' : 'topics';
  const relationTable = isCategory ? 'outlook_categories' : 'outlook_topics';
  const idColumn = isCategory ? 'category_id' : 'topic_id';

  const items = await fetchAll(table, 'id, name');
  const itemMap = new Map(items.map(item => [item.id, item]));
  const recentRelations = await fetchRecentRelations({ relationTable, idColumn });
  const groupedRelations = new Map();

  for (const row of recentRelations) {
    const id = row[idColumn];
    if (!groupedRelations.has(id)) groupedRelations.set(id, []);
    groupedRelations.get(id).push(row);
  }

  const tasks = [];
  let skipped = 0;

  for (const [id, rows] of groupedRelations.entries()) {
    const item = itemMap.get(id);
    if (!item) {
      skipped += 1;
      continue;
    }

    try {
      const count = rows.length;
      if (count <= MIN_RECENT_ARTICLES) {
        skipped += 1;
        continue;
      }

      const synopses = rows
        .slice(0, 5)
        .map(row => row.scriptural_outlooks?.ai_outlook?.synopsis)
        .filter(Boolean);

      if (synopses.length === 0) {
        skipped += 1;
        continue;
      }

      tasks.push({ id, item, count, synopses });
      if (MAX_ITEMS && tasks.length >= MAX_ITEMS) break;
    } catch (error) {
      skipped += 1;
      console.error(`Failed preparing ${type} ${id}:`, error.message);
    }
  }

  let refreshed = 0;
  let failed = 0;
  console.log(`${type} refresh has ${tasks.length} eligible item(s).`);

  for (let index = 0; index < tasks.length; index += CONCURRENCY) {
    const batch = tasks.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map(async ({ id, item, count, synopses }) => {
      try {
      console.log(`Refreshing ${type} "${item.name}" from ${synopses.length} recent synopses (${count} recent articles).`);
      const aiResponse = await generateBreakdown(item.name, synopses);

      if (!aiResponse?.scriptural_breakdown) {
        throw new Error('AI response missing scriptural_breakdown.');
      }

      const { error } = await supabase
        .from(table)
        .update({ scriptural_breakdown: aiResponse.scriptural_breakdown })
        .eq('id', id);

      if (error) throw error;
      return { ok: true };
    } catch (error) {
      console.error(`Failed refreshing ${type} ${item.id} (${item.name}):`, error.message);
      return { ok: false };
    }
    }));

    refreshed += results.filter(result => result.ok).length;
    failed += results.filter(result => !result.ok).length;
  }

  console.log(`${type} refresh complete: ${refreshed} refreshed, ${skipped} skipped, ${failed} failed.`);
  return { refreshed, skipped, failed };
}

async function main() {
  console.log('Starting taxonomy breakdown refresh.');
  await updateLivePrompt();

  const requestedTypes = TYPES.includes('all') ? ['category', 'topic'] : TYPES;
  for (const type of requestedTypes) {
    if (!['category', 'topic'].includes(type)) {
      console.warn(`Ignoring unknown taxonomy type: ${type}`);
      continue;
    }
    await refreshType(type);
  }
}

main().catch(error => {
  console.error('Taxonomy refresh failed:', error);
  process.exit(1);
});
