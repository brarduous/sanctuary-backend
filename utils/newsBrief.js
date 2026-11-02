const {validateNewsTldr,formatNewsTldr}=require('./newsReaderCopy');
function articleBriefInput(article) {
  let outlook = article.ai_outlook;
  if (typeof outlook === 'string') {
    try { outlook = JSON.parse(outlook); } catch { outlook = null; }
  }
  const summary = [outlook?.newsSummary, outlook?.tldr?.summary, outlook?.synopsis, article.article_body]
    .find(value => typeof value === 'string' && value.trim());
  return `Article ID: ${article.id || 'unavailable'}\nSource reporting date: ${article.publish_date || 'unavailable'}\nSource URL: ${article.article_url || 'unavailable'}\nTitle: ${article.article_title || 'Untitled'}\nReported summary: ${summary || 'No summary supplied.'}`;
}

function parseNewsBriefResponse(content, tokens, sourceArticles) {
  const result = JSON.parse(content);
  for (const field of ['synopsis', 'thought_to_remember', 'prayer']) {
    if (typeof result?.[field] !== 'string' || !result[field].trim()) {
      throw new Error(`Daily news brief missing ${field}`);
    }
  }
  if(!Array.isArray(result.stories) || result.stories.length<1 || result.stories.length>3 || typeof result.details!=='string' || !result.details.trim())throw new Error('Daily brief requires TLDR stories and further detail.');
  const stories=result.stories.map(story=>{if(typeof story.headline!=='string' || !story.headline.trim())throw new Error('Daily brief story needs a headline.');const normalized = {headline:story.headline.trim(),...validateNewsTldr(story)};
    if (sourceArticles) {
      const allowed = new Map(sourceArticles.map(article => [Number(article.id), article]));
      const ids = [...new Set(story.sourceArticleIds || [])];
      if (!ids.length || ids.some(id => !Number.isInteger(id) || !allowed.has(id))) throw new Error('Brief source links must use supplied article IDs.');
      normalized.sourceArticles = ids.map(id => {const article = allowed.get(id); return {id: article.id, slug: article.slug, title: article.article_title, sourceUrl: article.article_url};});
    }
    return normalized;});
  return {synopsis:stories.map(formatNewsTldr).join('\n\n'),details:result.details.trim(),stories,thought_to_remember:result.thought_to_remember,prayer:result.prayer,tokens};
}

module.exports = { articleBriefInput, parseNewsBriefResponse };
