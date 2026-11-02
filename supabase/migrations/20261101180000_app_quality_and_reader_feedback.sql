begin;
create table if not exists public.reader_content_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check(content_type in ('devotional','general_devotional','advice','prayer','sermon','bible_study','news')),
  content_id text not null check(length(content_id) between 1 and 100),
  rating integer not null check(rating between 1 and 5),
  clarity integer check(clarity between 1 and 5),
  relevance integer check(relevance between 1 and 5),
  practice_feasible boolean,
  issue_tags text[] not null default '{}' check(issue_tags <@ array['repetitive','confusing','not_relevant','too_long','accuracy','unsafe']),
  channel text not null check(channel in ('web','mobile','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,content_type,content_id)
);
create index if not exists reader_feedback_recent on public.reader_content_feedback(updated_at desc);
create table if not exists public.app_quality_reports (
  run_key text primary key,
  kind text not null check(kind in ('operations','content','release')),
  status text not null check(status in ('running','completed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_commit text,
  report jsonb not null default '{}'
);
alter table public.reader_content_feedback enable row level security;
alter table public.app_quality_reports enable row level security;
revoke all on public.reader_content_feedback,public.app_quality_reports from public,anon,authenticated;
grant all on public.reader_content_feedback,public.app_quality_reports to service_role;
create or replace function public.claim_app_quality_run(p_key text,p_kind text,p_commit text)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed integer;
begin
 insert into app_quality_reports(run_key,kind,status,source_commit) values(p_key,p_kind,'running',p_commit)
 on conflict(run_key) do update set status='running',started_at=now(),completed_at=null,source_commit=p_commit
 where app_quality_reports.status='failed' or (app_quality_reports.status='running' and app_quality_reports.started_at<now()-interval '2 hours');
 get diagnostics claimed=row_count;
 return claimed=1;
end; $$;
revoke all on function public.claim_app_quality_run(text,text,text) from public,anon,authenticated;
grant execute on function public.claim_app_quality_run(text,text,text) to service_role;
commit;
