-- Stop new single-source publication before rolling back the application.
-- Existing published rows remain available; no content/history is deleted.
begin;
create or replace function public.enforce_news_publication_sources()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.publication_status='published'
     and (select count(*) from public.news_article_sources source where source.outlook_id=new.id)<2 then
    raise exception 'A published article requires at least two supporting sources';
  end if;
  return new;
end;
$$;
commit;
