-- Sermon content format and duration metadata
-- Backward-compatible migration for Supabase Postgres

BEGIN;

-- 1) Add new sermon metadata columns
ALTER TABLE public.sermons
    ADD COLUMN IF NOT EXISTS content_format text,
    ADD COLUMN IF NOT EXISTS target_duration_min integer,
    ADD COLUMN IF NOT EXISTS actual_duration_min integer,
    ADD COLUMN IF NOT EXISTS distribution_channel text;

-- 2) Add optional series-level format
ALTER TABLE public.sermon_series
    ADD COLUMN IF NOT EXISTS series_format text;

-- 3) Backfill defaults for existing rows (backward compatibility)
UPDATE public.sermons
SET content_format = 'sermon'
WHERE content_format IS NULL OR btrim(content_format) = '';

UPDATE public.sermons
SET distribution_channel = 'pulpit'
WHERE distribution_channel IS NULL OR btrim(distribution_channel) = '';

UPDATE public.sermon_series
SET series_format = 'standard'
WHERE series_format IS NULL OR btrim(series_format) = '';

-- 4) Set safe defaults for new writes
ALTER TABLE public.sermons
    ALTER COLUMN content_format SET DEFAULT 'sermon',
    ALTER COLUMN distribution_channel SET DEFAULT 'pulpit';

ALTER TABLE public.sermon_series
    ALTER COLUMN series_format SET DEFAULT 'standard';

-- 5) Enforce allowed values and valid ranges
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sermons_content_format_check'
    ) THEN
        ALTER TABLE public.sermons
            ADD CONSTRAINT sermons_content_format_check
            CHECK (content_format IN ('sermon', 'sermonette', 'podcast_episode', 'youtube_video'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sermons_distribution_channel_check'
    ) THEN
        ALTER TABLE public.sermons
            ADD CONSTRAINT sermons_distribution_channel_check
            CHECK (distribution_channel IN ('pulpit', 'podcast', 'youtube', 'multi'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sermons_target_duration_min_check'
    ) THEN
        ALTER TABLE public.sermons
            ADD CONSTRAINT sermons_target_duration_min_check
            CHECK (target_duration_min IS NULL OR (target_duration_min BETWEEN 1 AND 240));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sermons_actual_duration_min_check'
    ) THEN
        ALTER TABLE public.sermons
            ADD CONSTRAINT sermons_actual_duration_min_check
            CHECK (actual_duration_min IS NULL OR (actual_duration_min BETWEEN 1 AND 240));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sermon_series_series_format_check'
    ) THEN
        ALTER TABLE public.sermon_series
            ADD CONSTRAINT sermon_series_series_format_check
            CHECK (series_format IN ('standard', 'short_form'));
    END IF;
END $$;

-- 6) Enforce non-null now that defaults and backfill are in place
ALTER TABLE public.sermons
    ALTER COLUMN content_format SET NOT NULL,
    ALTER COLUMN distribution_channel SET NOT NULL;

ALTER TABLE public.sermon_series
    ALTER COLUMN series_format SET NOT NULL;

-- 7) Helpful indexes for new filters
CREATE INDEX IF NOT EXISTS idx_sermons_user_content_format
    ON public.sermons (user_id, content_format);

CREATE INDEX IF NOT EXISTS idx_sermons_user_distribution_channel
    ON public.sermons (user_id, distribution_channel);

CREATE INDEX IF NOT EXISTS idx_sermon_series_user_series_format
    ON public.sermon_series (user_id, series_format);

COMMIT;
