begin;
alter table public.news_article_sources add column if not exists evidence_excerpt text;
comment on column public.news_article_sources.evidence_excerpt is 'Bounded publisher-supplied text used to decide whether a partial-access source materially contributes to a story cluster.';
commit;
