-- Human approval is optional. A single real source may publish as provisional;
-- source breadth, uncertainty and claim assessments remain visible to readers.
-- Preserve the existing completeness constraint and all rejection/archival states.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public.enforce_news_publication_sources()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.publication_status='published'
     and not exists(select 1 from public.news_article_sources source
       where source.outlook_id=new.id and source.url ~* '^https?://' and nullif(btrim(source.title),'') is not null) then
    raise exception 'A published article requires a linked reporting source';
  end if;
  return new;
end;
$$;
commit;
