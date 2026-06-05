alter table public.scriptural_outlooks
  add column if not exists news_impact_score integer,
  add column if not exists news_impact_summary text,
  add column if not exists news_impact_model text,
  add column if not exists news_impact_evaluated_at timestamptz;

create index if not exists idx_scriptural_outlooks_news_impact_score
  on public.scriptural_outlooks (news_impact_score desc, created_at desc);

update public.scriptural_outlooks
set news_impact_score = least(
    100,
    greatest(
      1,
      35
      + case when coalesce(article_title, '') ~* '(war|military|invasion|missile|nuclear|terror|hostage|ceasefire)' then 18 else 0 end
      + case when coalesce(article_title, '') ~* '(president|congress|supreme court|election|senate|governor|white house)' then 14 else 0 end
      + case when coalesce(article_title, '') ~* '(economy|inflation|recession|market|jobs|tariff|interest rate)' then 12 else 0 end
      + case when coalesce(article_title, '') ~* '(disaster|hurricane|wildfire|earthquake|flood|tornado|crash|outbreak)' then 16 else 0 end
      + case when coalesce(article_title, '') ~* '(immigration|border|health care|education|housing|crime|justice)' then 10 else 0 end
      + case when coalesce(article_title, '') ~* '(global|world|national|federal|historic|major|breaking|urgent)' then 8 else 0 end
      + case when length(coalesce(article_body, '')) > 2500 then 8 else 0 end
    )
  ),
  news_impact_summary = coalesce(news_impact_summary, 'Backfilled from headline and article-depth impact signals.')
where news_impact_score is null;
