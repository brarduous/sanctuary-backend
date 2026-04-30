-- Adds channel popularity + handle metadata, and recommendation metadata for ranking/personalization.

alter table if exists youtube_channels
  add column if not exists handle text,
  add column if not exists subscriber_count bigint,
  add column if not exists view_count bigint,
  add column if not exists video_count bigint,
  add column if not exists is_active boolean default true;

alter table if exists recommended_videos
  add column if not exists channel_id text,
  add column if not exists channel_name text,
  add column if not exists view_count bigint;

create index if not exists idx_youtube_channels_active_subs
  on youtube_channels (is_active, subscriber_count desc nulls last, view_count desc nulls last);

create index if not exists idx_youtube_channels_name_lower
  on youtube_channels (lower(channel_name));

create index if not exists idx_youtube_channels_handle_lower
  on youtube_channels (lower(handle));

create index if not exists idx_recommended_videos_channel_id
  on recommended_videos (channel_id);

create index if not exists idx_recommended_videos_view_count
  on recommended_videos (view_count desc nulls last);
