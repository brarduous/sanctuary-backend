function clampScore(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return Math.max(1, Math.min(100, Math.round(score)));
}

function normalizeArticleForImpact(article = {}) {
    return {
        title: article.article_title || article.title || '',
        description: article.description || article.ai_outlook?.synopsis || article.ai_outlook?.mainMessage || '',
        body: article.article_body || article.body || '',
        categories: article.categories || article.ai_outlook?.categories || [],
        topics: article.topics || article.ai_outlook?.topics || [],
        publishDate: article.publish_date || article.created_at || null,
        url: article.article_url || article.url || ''
    };
}

async function evaluateNewsImpactWithAI(openai, article, options = {}) {
    const normalized = normalizeArticleForImpact(article);
    const model = options.model || process.env.NEWS_IMPACT_MODEL || 'gpt-5-mini';
    const bodyExcerpt = normalized.body.slice(0, 3000);

    const systemPrompt = `You are an editorial severity-and-scope scorer for a national news homepage.
Return JSON only. Score real-world impact from 1 to 100.

Definition of impact:
Impact means the severity, seriousness, and scope of likely consequences. Ask:
1. How many people could be materially affected?
2. How severe are the consequences for those affected?
3. How direct and concrete is the effect, versus symbolic, speculative, or merely interesting?
4. Does the story affect public safety, war/peace, law, rights, health, economic security, infrastructure, democratic governance, or large-scale social stability?

Rubric:
- 90-100: catastrophic or major national/global consequences; war escalation, nuclear risk, mass casualty, severe public-health threat, constitutional crisis, massive economic shock, or rights/safety consequences for millions.
- 75-89: serious consequences for many people or a highly vulnerable population; major public safety, federal/state policy, court, infrastructure, security, economic, or health effects.
- 55-74: meaningful but bounded impact; substantial local/regional effect, sector-wide consequences, significant legal/civic implications, or serious harm to a smaller group.
- 35-54: moderate public interest but limited material consequence; political maneuvering, institutional controversy, business/sports/entertainment stories unless they substantially affect people beyond fans or insiders.
- 1-34: low real-world consequence; celebrity updates, routine sports results, soft features, viral moments, commentary, niche lifestyle, or stories mostly about attention rather than material harm/benefit.

Scoring rules:
- Do not reward sensational wording, famous names, partisan drama, or novelty by itself.
- A story about a powerful person is high impact only if the consequences are severe and broad.
- Sports, entertainment, celebrity, and lifestyle stories should usually score below 55 unless they involve major safety, legal, economic, or public-health consequences.
- Explain the score in terms of scope and severity, not general importance.`;

    const userPrompt = JSON.stringify({
        title: normalized.title,
        description: normalized.description,
        pastoralSynopsis: article?.ai_outlook?.synopsis || article?.ai_outlook?.mainMessage || '',
        categories: normalized.categories,
        topics: normalized.topics,
        publishDate: normalized.publishDate,
        url: normalized.url,
        bodyExcerpt,
        requiredJsonShape: {
            news_impact_score: 'integer 1-100',
            news_impact_summary: 'one concise sentence explaining why this score reflects public importance'
        }
    });

    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_completion_tokens: 1200,
            response_format: { type: 'json_object' }
        });

        const content = response.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);
        const aiScore = clampScore(parsed.news_impact_score);

        if (!aiScore) {
            throw new Error(`AI impact response did not include a valid 1-100 score: ${content}`);
        }

        return {
            newsImpactScore: aiScore,
            newsImpactSummary: parsed.news_impact_summary || 'Scored by AI based on the severity, seriousness, and scope of likely real-world consequences.',
            newsImpactModel: model
        };
    } catch (error) {
        throw new Error(`AI news impact scoring failed: ${error.message}`);
    }
}

module.exports = {
    evaluateNewsImpactWithAI
};
