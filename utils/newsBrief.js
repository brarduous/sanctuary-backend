function articleBriefInput(article) {
  let outlook = article.ai_outlook;
  if (typeof outlook === 'string') {
    try { outlook = JSON.parse(outlook); } catch { outlook = null; }
  }
  const summary = [outlook?.newsSummary, outlook?.synopsis, article.article_body]
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
  return { synopsis: result.synopsis, thought_to_remember: result.thought_to_remember, prayer: result.prayer, tokens };
}

module.exports = { articleBriefInput, parseNewsBriefResponse };
