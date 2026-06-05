-- Ask article outlook generation to rewrite headlines more tightly.

update system_prompts
set content = replace(
  content,
  'Title: Rewrite the title to be completely factual, unbiased, and free of sensationalism, while keeping the pastoral outlook in mind. Be very specific to the original story, retaining the exact names, places, and core subjects.',
  'Title: Rewrite the title to be short, factual, unbiased, and free of sensationalism. Keep it concise, ideally 6-10 words and no more than 12 words. Retain only the most important names, places, and core subject needed for clarity. Avoid subtitles, clauses, clickbait phrasing, and pastoral framing in the title.'
)
where key = 'news_generator';

update system_prompts
set content = replace(
  content,
  '"title": "A concise, unbiased, and factual title."',
  '"title": "A short, concise, unbiased, and factual title, ideally 6-10 words and no more than 12 words."'
)
where key = 'news_generator';
