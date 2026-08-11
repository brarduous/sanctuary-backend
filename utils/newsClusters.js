require('dotenv').config();

const crypto = require('crypto');
const OpenAI = require('openai');
const supabase = require('../config/supabase');
const { MATCH_THRESHOLD, overlapScore, tokens } = require('./newsClusterMatching');

const LOOKBACK_DAYS = 120;

function safeSlug(title) {
  const base = String(title || 'developing-story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'developing-story';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function sourceComparison(source) {
  return {
    sourceId: source.id,
    publisher: source.publisher,
    title: source.title,
    url: source.url,
    reportingQualityScore: 70,
    reportingQualityRationale: 'Not yet assessed beyond the supplied source metadata.',
    christianVirtuesAlignmentScore: 70,
    christianVirtuesRationale: 'Not yet assessed beyond the supplied source metadata; religious vocabulary receives no preference.',
    distinctiveContribution: source.title,
    framing: 'Review the linked report for its emphasis and framing.',
    omissionsOrUncertainties: 'The source package may not include every relevant primary document or perspective.',
    calibrationVersion: 2,
    assessedAt: new Date().toISOString(),
  };
}

function relevantExcerpt(value, clusterTitle, sourceTitle) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const focus = `${clusterTitle} ${sourceTitle}`;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const relevant = sentences.map((sentence, index) => ({ sentence, index, score: overlapScore(focus, sentence) })).filter((item) => item.score >= 0.08 || item.index === 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).sort((a, b) => a.index - b.index).map((item) => item.sentence).join(' ');
  return (relevant || text).slice(0, 3500);
}

async function assessSourceComparison(sources, clusterTitle) {
  if (!process.env.OPENAI_API_KEY || !sources.length) return sources.map(sourceComparison);
  const outlookIds = [...new Set(sources.map((source) => source.outlook_id).filter(Boolean))];
  const { data: outlooks } = await supabase.from('scriptural_outlooks').select('id,article_body,ai_outlook').in('id', outlookIds);
  const byId = new Map((outlooks || []).map((outlook) => [outlook.id, outlook]));
  const inputs = sources.map((source) => ({ id: source.id, publisher: source.publisher, title: source.title, url: source.url, suppliedText: relevantExcerpt(byId.get(source.outlook_id)?.article_body || byId.get(source.outlook_id)?.ai_outlook?.newsSummary || '', clusterTitle, source.title) }));
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({ model: 'gpt-5-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `Assess only the supplied text for each report. Return JSON {"sources": [...]} with exactly one item per source: sourceId, publisher, title, url, distinctiveContribution, framing, omissionsOrUncertainties, reportingQualityScore (0-100), reportingQualityRationale, christianVirtuesAlignmentScore (0-100), christianVirtuesRationale.

Reporting quality measures whether the report responsibly accomplishes its apparent purpose using accurate wording, attribution, specificity, context, and honest uncertainty. Calibrate generously and proportionately: 85-100 exceptional depth; 70-84 solid and responsible; 55-69 adequate with meaningful limitations; below 55 only for substantive problems such as unsupported consequential assertions, materially misleading framing, serious attribution failures, or sensationalism. An accurate concise brief should ordinarily score around 70. Do not punish a brief merely for not being a long investigation, and do not treat unavailable full-page text as evidence of poor journalism.

Christian-virtues alignment separately measures truthfulness, human dignity, compassion, justice, peacemaking, humility, and care for vulnerable people. Neutral, accurate, non-dehumanizing reporting should ordinarily score around 70 even without explicit moral or religious language. Use 80+ for unusually strong care, dignity, justice, truth-correction, or constructive context. Score below 55 only for concrete distortion, dehumanization, exploitation of suffering, reckless fear, or disregard for vulnerable people. Never infer a publisher's religion, motives, or politics. Religious words confer no points. Distinguish limitations of the supplied excerpt from faults in the underlying report. Use concrete evidence and rank every source; scores may tie.` }, { role: 'user', content: JSON.stringify(inputs) }] });
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    const rows = Array.isArray(parsed.sources) ? parsed.sources : [];
    const allowed = new Map(sources.map((source) => [source.id, source]));
    return rows.filter((row) => allowed.has(row.sourceId)).map((row) => ({ ...row, publisher: allowed.get(row.sourceId).publisher, title: allowed.get(row.sourceId).title, url: allowed.get(row.sourceId).url, reportingQualityScore: Math.max(0, Math.min(100, Math.round(Number(row.reportingQualityScore) || 0))), christianVirtuesAlignmentScore: Math.max(0, Math.min(100, Math.round(Number(row.christianVirtuesAlignmentScore) || 0))), calibrationVersion: 2, assessedAt: new Date().toISOString() })).concat(sources.filter((source) => !rows.some((row) => row.sourceId === source.id)).map(sourceComparison));
  } catch (error) {
    console.warn(`Could not assess cluster source comparison: ${error.message}`);
    return sources.map(sourceComparison);
  }
}

async function regenerateCanonicalOutlook(cluster, sources, comparison) {
  if (!process.env.OPENAI_API_KEY || !cluster.canonical_outlook_id || !sources.length) return;
  const outlookIds = [...new Set(sources.map((source) => source.outlook_id).filter(Boolean))];
  const [{ data: sourceOutlooks }, { data: canonical }] = await Promise.all([
    supabase.from('scriptural_outlooks').select('id,article_title,article_body,ai_outlook').in('id', outlookIds),
    supabase.from('scriptural_outlooks').select('ai_outlook').eq('id', cluster.canonical_outlook_id).single(),
  ]);
  const byId = new Map((sourceOutlooks || []).map((outlook) => [outlook.id, outlook]));
  const sourceInputs = sources.map((source) => ({ publisher: source.publisher, title: source.title, url: source.url, suppliedText: relevantExcerpt(byId.get(source.outlook_id)?.article_body || byId.get(source.outlook_id)?.ai_outlook?.newsSummary || '', cluster.title, source.title) }));
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({ model: 'gpt-5-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `Create a unified Sanctuary News update about the single core story named by clusterTitle. Return JSON fields: title, newsSummary, sourceAndFramingAnalysis, outlook, citedPassages (reference/context/application), faithfulResponse, reflectionQuestions, closingPrayer, confirmedDetails, singlyReportedDetails, disputedDetails, unresolvedQuestions. The title and every section must remain exclusively about clusterTitle. Ignore unrelated headlines or events embedded in live blogs, news wraps, navigation, or page excerpts. Attribute source-specific details and disagreements. Do not invent facts, URLs, quotations, Scripture text, or consensus. The Christian outlook must center truth, mercy, justice, peacemaking, humility, dignity, and care for vulnerable neighbors; keep it distinct from factual reporting. Use contextual Scripture without proof-texting.` }, { role: 'user', content: JSON.stringify({ clusterTitle: cluster.title, currentCanonical: canonical?.ai_outlook || {}, reports: sourceInputs, sourceComparison: comparison }) }] });
    const generated = JSON.parse(response.choices[0]?.message?.content || '{}');
    const nextOutlook = { ...(canonical?.ai_outlook || {}), ...generated, sources: sources.map((source, index) => ({ title: source.title, publisher: source.publisher, url: source.url, type: index === 0 ? 'primary_reporting' : 'additional_reporting' })), additionalSourcesNeeded: new Set(sources.map((source) => source.publisher)).size < 2, clusterSynthesis: { confirmedDetails: generated.confirmedDetails || [], singlyReportedDetails: generated.singlyReportedDetails || [], disputedDetails: generated.disputedDetails || [], unresolvedQuestions: generated.unresolvedQuestions || [], generatedAt: new Date().toISOString() } };
    await supabase.from('scriptural_outlooks').update({ article_title: generated.title || cluster.title, ai_outlook: nextOutlook }).eq('id', cluster.canonical_outlook_id);
  } catch (error) {
    console.warn(`Could not regenerate canonical cluster outlook ${cluster.id}: ${error.message}`);
  }
}

async function refreshCluster(clusterId, attempt = 0) {
  const { data: cluster, error: clusterError } = await supabase.from('news_story_clusters').select('*').eq('id', clusterId).single();
  if (clusterError) throw clusterError;
  const { data: sourceRows, error: sourceError } = await supabase.from('news_article_sources').select('id,outlook_id,publisher,title,url,published_at,is_independent').eq('story_cluster_id', clusterId).order('published_at', { ascending: false, nullsFirst: false });
  if (sourceError) throw sourceError;
  const sources = [...new Map((sourceRows || []).map((source) => [source.url, source])).values()];
  const uniquePublishers = new Set((sources || []).map((source) => source.publisher));
  const timeline = (sources || []).map((source) => ({ publishedAt: source.published_at, publisher: source.publisher, title: source.title, url: source.url }));
  const comparison = (await assessSourceComparison(sources, cluster.title)).sort((a, b) => b.christianVirtuesAlignmentScore - a.christianVirtuesAlignmentScore || b.reportingQualityScore - a.reportingQualityScore);
  const status = uniquePublishers.size >= 2 ? 'corroborated' : 'provisional';
  const latest = (sources || []).map((source) => source.published_at).filter(Boolean).sort().at(-1) || cluster.latest_reported_at;
  const earliest = (sources || []).map((source) => source.published_at).filter(Boolean).sort().at(0) || cluster.first_reported_at;
  const { data: updated, error } = await supabase.from('news_story_clusters').update({ status, first_reported_at: earliest, latest_reported_at: latest, source_comparison: comparison, timeline, content_version: cluster.content_version + 1, updated_at: new Date().toISOString() }).eq('id', clusterId).eq('content_version', cluster.content_version).select('*').maybeSingle();
  if (error) throw error;
  if (!updated) {
    if (attempt >= 3) throw new Error(`Cluster ${clusterId} changed repeatedly during regeneration.`);
    return refreshCluster(clusterId, attempt + 1);
  }
  await regenerateCanonicalOutlook(updated, sources || [], comparison);
  return updated;
}

async function reconcileOutlookCluster(outlookId, article, aiResponse) {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const { data: candidates, error } = await supabase.from('news_story_clusters').select('*').gte('latest_reported_at', cutoff).neq('status', 'archived').order('latest_reported_at', { ascending: false }).limit(250);
  if (error) throw error;
  const context = [article.title, ...(aiResponse.topics || []).map((item) => item.name), ...(aiResponse.categories || []).map((item) => item.name)].join(' ');
  const ranked = (candidates || []).map((cluster) => ({ cluster, score: overlapScore(context, `${cluster.title} ${JSON.stringify(cluster.clustering_metadata || {})}`) })).sort((a, b) => b.score - a.score);
  let cluster = ranked[0]?.score >= MATCH_THRESHOLD ? ranked[0].cluster : null;
  if (!cluster) {
    const { data, error: createError } = await supabase.from('news_story_clusters').insert({ slug: safeSlug(aiResponse.title || article.title), title: aiResponse.title || article.title, canonical_outlook_id: outlookId, status: 'provisional', first_reported_at: article.publish_date, latest_reported_at: article.publish_date, representative_image_url: article.thumbnail_url, clustering_metadata: { keywords: [...tokens(context)], automatic: true, matchThreshold: MATCH_THRESHOLD } }).select('*').single();
    if (createError) throw createError;
    cluster = data;
  }
  const canonicalId = cluster.canonical_outlook_id || outlookId;
  const outlookUpdate = { story_cluster_id: cluster.id, superseded_by_outlook_id: canonicalId === outlookId ? null : canonicalId };
  const { error: outlookError } = await supabase.from('scriptural_outlooks').update(outlookUpdate).eq('id', outlookId);
  if (outlookError) throw outlookError;
  await supabase.from('news_article_sources').update({ story_cluster_id: cluster.id }).eq('outlook_id', outlookId);
  if (!cluster.canonical_outlook_id) await supabase.from('news_story_clusters').update({ canonical_outlook_id: outlookId }).eq('id', cluster.id);
  if (canonicalId !== outlookId) {
    const [{ data: categories }, { data: topics }, { data: incoming }, { data: canonicalRow }] = await Promise.all([
      supabase.from('outlook_categories').select('category_id').eq('outlook_id', outlookId),
      supabase.from('outlook_topics').select('topic_id').eq('outlook_id', outlookId),
      supabase.from('scriptural_outlooks').select('publish_date,article_thumbnail_url,news_impact_score,news_impact_summary').eq('id', outlookId).single(),
      supabase.from('scriptural_outlooks').select('publish_date,news_impact_score').eq('id', canonicalId).single(),
    ]);
    if (categories?.length) await supabase.from('outlook_categories').upsert(categories.map((row) => ({ outlook_id: canonicalId, category_id: row.category_id })), { onConflict: 'outlook_id,category_id', ignoreDuplicates: true });
    if (topics?.length) await supabase.from('outlook_topics').upsert(topics.map((row) => ({ outlook_id: canonicalId, topic_id: row.topic_id })), { onConflict: 'outlook_id,topic_id', ignoreDuplicates: true });
    const incomingTime = new Date(incoming?.publish_date || 0).getTime();
    const canonicalTime = new Date(canonicalRow?.publish_date || 0).getTime();
    await supabase.from('scriptural_outlooks').update({ publish_date: incomingTime > canonicalTime ? incoming.publish_date : canonicalRow?.publish_date, article_thumbnail_url: incomingTime > canonicalTime && incoming?.article_thumbnail_url ? incoming.article_thumbnail_url : undefined, news_impact_score: Math.max(Number(incoming?.news_impact_score) || 0, Number(canonicalRow?.news_impact_score) || 0), news_impact_summary: Number(incoming?.news_impact_score) > Number(canonicalRow?.news_impact_score) ? incoming?.news_impact_summary : undefined }).eq('id', canonicalId);
  }
  const refreshed = await refreshCluster(cluster.id);
  const { data: canonical } = await supabase.from('scriptural_outlooks').select('ai_outlook,article_thumbnail_url').eq('id', canonicalId).single();
  const canonicalOutlook = { ...(canonical?.ai_outlook || {}), storyCluster: { id: refreshed.id, slug: refreshed.slug, status: refreshed.status, sourceCount: refreshed.source_comparison.length, sourceComparison: refreshed.source_comparison, timeline: refreshed.timeline, lastUpdatedAt: refreshed.updated_at } };
  await supabase.from('scriptural_outlooks').update({ ai_outlook: canonicalOutlook, article_thumbnail_url: refreshed.representative_image_url || canonical?.article_thumbnail_url }).eq('id', canonicalId);
  return { cluster: refreshed, canonicalOutlookId: canonicalId, superseded: canonicalId !== outlookId, matchScore: ranked[0]?.score || 0 };
}

async function processRequestedClusterRegenerations(limit = 5) {
  const { data: clusters, error } = await supabase.from('news_story_clusters').select('id,clustering_metadata').neq('status', 'archived').order('updated_at', { ascending: true }).limit(100);
  if (error) throw error;
  const pending = (clusters || []).filter((cluster) => {
    const requested = new Date(cluster.clustering_metadata?.regenerationRequestedAt || 0).getTime();
    const completed = new Date(cluster.clustering_metadata?.regenerationCompletedAt || 0).getTime();
    return requested > completed;
  }).slice(0, limit);
  for (const cluster of pending) {
    await refreshCluster(cluster.id);
    await supabase.from('news_story_clusters').update({ clustering_metadata: { ...(cluster.clustering_metadata || {}), regenerationCompletedAt: new Date().toISOString() } }).eq('id', cluster.id);
  }
  return pending.length;
}

module.exports = { reconcileOutlookCluster, refreshCluster, processRequestedClusterRegenerations };
