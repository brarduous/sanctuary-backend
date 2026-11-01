const {validateNewsTldr,formatNewsTldr}=require('./newsReaderCopy');
function articleBriefInput(article) {
  let outlook = article.ai_outlook;
  if (typeof outlook === 'string') {
    try { outlook = JSON.parse(outlook); } catch { outlook = null; }
  }
  const summary = [outlook?.newsSummary, outlook?.tldr?.summary, outlook?.synopsis, article.article_body]
    .find(value => typeof value === 'string' && value.trim());
  return `Title: ${article.article_title || 'Untitled'}\nReported summary: ${summary || 'No summary supplied.'}`;
}

function parseNewsBriefResponse(content, tokens) {
  const result = JSON.parse(content);
  for (const field of ['synopsis', 'thought_to_remember', 'prayer']) {
    if (typeof result?.[field] !== 'string' || !result[field].trim()) {
      throw new Error(`Daily news brief missing ${field}`);
    }
  }
  if(!Array.isArray(result.stories) || result.stories.length<1 || result.stories.length>3 || typeof result.details!=='string' || !result.details.trim())throw new Error('Daily brief requires TLDR stories and further detail.');
  const stories=result.stories.map(story=>{if(typeof story.headline!=='string' || !story.headline.trim())throw new Error('Daily brief story needs a headline.');return {headline:story.headline.trim(),...validateNewsTldr(story)};});
  return {synopsis:stories.map(formatNewsTldr).join('\n\n'),details:result.details.trim(),stories,thought_to_remember:result.thought_to_remember,prayer:result.prayer,tokens};
}

module.exports = { articleBriefInput, parseNewsBriefResponse };
