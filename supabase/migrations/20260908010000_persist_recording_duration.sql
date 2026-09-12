-- Apply this migration alone after reviewing production history/backfill; never db push --include-all.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Freeze writers while the historical baseline and confirmation trigger are installed.
LOCK TABLE public.voice_contributions IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.recording_duration_ledger (
  contributor_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  source_contribution_id UUID NOT NULL UNIQUE,
  duration_seconds NUMERIC NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds < 'Infinity'::numeric),
  recorded_at TIMESTAMPTZ NOT NULL,
  credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credit_source TEXT NOT NULL CHECK (credit_source IN ('historical_baseline', 'upload_confirmed')),
  PRIMARY KEY (contributor_id, recording_id)
);
CREATE INDEX recording_duration_ledger_account_day
  ON public.recording_duration_ledger (contributor_id, recorded_at);

CREATE TABLE public.recording_duration_totals (
  contributor_id TEXT PRIMARY KEY,
  total_duration_seconds NUMERIC NOT NULL DEFAULT 0 CHECK (total_duration_seconds >= 0 AND total_duration_seconds < 'Infinity'::numeric),
  recording_count BIGINT NOT NULL DEFAULT 0 CHECK (recording_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recording_duration_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_duration_totals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recording_duration_ledger, public.recording_duration_totals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.recording_duration_ledger, public.recording_duration_totals TO service_role;

-- No audio path, transcript, or FK to deletable contribution rows belongs in this ledger.
CREATE FUNCTION public.increment_recording_duration_total() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.recording_duration_totals (contributor_id, total_duration_seconds, recording_count)
  VALUES (NEW.contributor_id, NEW.duration_seconds, 1)
  ON CONFLICT (contributor_id) DO UPDATE
  SET total_duration_seconds = recording_duration_totals.total_duration_seconds + EXCLUDED.total_duration_seconds,
      recording_count = recording_duration_totals.recording_count + 1,
      updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE TRIGGER increment_recording_duration_total
AFTER INSERT ON public.recording_duration_ledger
FOR EACH ROW EXECUTE FUNCTION public.increment_recording_duration_total();

CREATE FUNCTION public.credit_confirmed_recording_duration() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE recording_key TEXT;
BEGIN
  IF NEW.metadata #>> '{upload_receipt,manifest_synced}' IS DISTINCT FROM 'true' THEN
    RETURN NEW;
  END IF;
  recording_key := COALESCE(NULLIF(BTRIM(NEW.metadata ->> 'recording_id'), ''),
                            NULLIF(BTRIM(NEW.metadata #>> '{upload_receipt,recording_id}'), ''));
  IF recording_key IS NULL OR NEW.duration_seconds IS NULL
    OR NOT (NEW.duration_seconds >= 0 AND NEW.duration_seconds < 'Infinity'::float8) THEN
    RAISE EXCEPTION 'recording_duration_invalid';
  END IF;
  -- First accepted duration is immutable. A retry or metadata/path correction is not new effort.
  INSERT INTO public.recording_duration_ledger
    (contributor_id, recording_id, source_contribution_id, duration_seconds, recorded_at, credit_source)
  VALUES (NEW.contributor_id, 'recording:' || recording_key, NEW.id,
          ROUND(NEW.duration_seconds::numeric, 3), COALESCE(NEW.created_at, NOW()), 'upload_confirmed')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_confirmed_recording_duration
AFTER INSERT OR UPDATE ON public.voice_contributions
FOR EACH ROW EXECUTE FUNCTION public.credit_confirmed_recording_duration();

-- Preserve the previous DB-based baseline, not an unverified remembered display value.
-- Legacy records without stable recording IDs retain their contribution UUID as identity.
INSERT INTO public.recording_duration_ledger
  (contributor_id, recording_id, source_contribution_id, duration_seconds, recorded_at, credit_source)
SELECT contributor_id,
       COALESCE('recording:' || COALESCE(NULLIF(BTRIM(metadata ->> 'recording_id'), ''),
                     NULLIF(BTRIM(metadata #>> '{upload_receipt,recording_id}'), '')), 'legacy:' || id::text),
       id,
       CASE WHEN duration_seconds >= 0 AND duration_seconds < 'Infinity'::float8
         THEN ROUND(duration_seconds::numeric, 3) ELSE 0 END,
       COALESCE(created_at, NOW()), 'historical_baseline'
FROM public.voice_contributions
ORDER BY created_at ASC NULLS LAST, id ASC
ON CONFLICT DO NOTHING;

-- Storage cleanup/recording withdrawal retains minimal effort statistics; account erasure does not.
CREATE FUNCTION public.erase_account_recording_duration() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.recording_duration_ledger WHERE contributor_id = OLD.id::text;
  DELETE FROM public.recording_duration_totals WHERE contributor_id = OLD.id::text;
  RETURN OLD;
END;
$$;
CREATE TRIGGER erase_account_recording_duration
AFTER DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.erase_account_recording_duration();

REVOKE ALL ON FUNCTION public.increment_recording_duration_total(),
  public.credit_confirmed_recording_duration(), public.erase_account_recording_duration()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_recording_progress(
  p_contributor_id TEXT,
  p_timezone_offset_minutes INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $$
  WITH parameters AS (
    SELECT GREATEST(-840, LEAST(840, COALESCE(p_timezone_offset_minutes, 0))) AS offset_minutes
  ),
  day_window AS (
    SELECT
      date_trunc('day', NOW() - make_interval(mins => offset_minutes))
        + make_interval(mins => offset_minutes) AS day_start,
      date_trunc('day', NOW() - make_interval(mins => offset_minutes))
        + make_interval(mins => offset_minutes)
        + INTERVAL '1 day' AS day_end
    FROM parameters
  ),
  contributions AS (
    SELECT
      id,
      sentence_id,
      GREATEST(COALESCE(duration_seconds, 0), 0) AS duration_seconds,
      created_at,
      metadata ->> 'reading_segment_id' AS reading_segment_id,
      COALESCE(NULLIF(metadata ->> 'reading_round_id', ''), 'initial') AS reading_round_id,
      metadata ->> 'reading_article_id' AS reading_article_id,
      metadata ->> 'prepared_expression_id' AS prepared_expression_id,
      metadata ->> 'exercise_category' AS exercise_category
    FROM public.voice_contributions
    WHERE contributor_id = p_contributor_id
  ),
  latest_exercise_by_scope AS (
    SELECT DISTINCT ON (scope_key)
      scope_key,
      sentence_id
    FROM (
      SELECT
        CASE
          WHEN NULLIF(prepared_expression_id, '') IS NOT NULL
            THEN 'prepared_expression:' || prepared_expression_id
          WHEN NULLIF(reading_article_id, '') IS NULL
            AND NULLIF(exercise_category, '') IS NOT NULL
            THEN 'category:' || exercise_category
          ELSE NULL
        END AS scope_key,
        sentence_id,
        created_at,
        id
      FROM contributions
      WHERE NULLIF(sentence_id, '') IS NOT NULL
    ) scoped
    WHERE scope_key IS NOT NULL
    ORDER BY scope_key, created_at DESC, id DESC
  ),
  article_rounds AS (
    SELECT article_id, current_round
    FROM public.reading_article_progress
    WHERE contributor_id = p_contributor_id
      AND current_round > 0
  )
  SELECT jsonb_build_object(
    'recordedSentenceIds', COALESCE((
      SELECT jsonb_agg(sentence_id ORDER BY sentence_id)
      FROM (
        SELECT DISTINCT sentence_id
        FROM contributions
        WHERE NULLIF(sentence_id, '') IS NOT NULL
      ) sentence_ids
    ), '[]'::jsonb),
    'recordedReadingSegmentIds', COALESCE((
      SELECT jsonb_agg(reading_segment_id ORDER BY reading_segment_id)
      FROM (
        SELECT DISTINCT reading_segment_id
        FROM contributions
        WHERE NULLIF(reading_segment_id, '') IS NOT NULL
      ) segment_ids
    ), '[]'::jsonb),
    'recordedReadingRoundKeys', COALESCE((
      SELECT jsonb_agg(round_key ORDER BY round_key)
      FROM (
        SELECT DISTINCT reading_round_id || ':' || reading_segment_id AS round_key
        FROM contributions
        WHERE NULLIF(reading_segment_id, '') IS NOT NULL
      ) round_keys
    ), '[]'::jsonb),
    'readingArticleRoundIds', COALESCE((
      SELECT jsonb_object_agg(article_id, 'round-' || current_round)
      FROM article_rounds
    ), '{}'::jsonb),
    'lastRecordedExerciseIds', COALESCE((
      SELECT jsonb_object_agg(scope_key, sentence_id)
      FROM latest_exercise_by_scope
    ), '{}'::jsonb),
    'durationAccounting', 'durable_v1',
    'todayDurationSeconds', COALESCE((
      SELECT ROUND(SUM(duration_seconds)::numeric, 3)
      FROM public.recording_duration_ledger, day_window
      WHERE contributor_id = p_contributor_id
        AND recorded_at >= day_start AND recorded_at < day_end
    ), 0),
    'totalDurationSeconds', COALESCE((
      SELECT total_duration_seconds
      FROM public.recording_duration_totals
      WHERE contributor_id = p_contributor_id
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.get_recording_progress(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recording_progress(TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.get_recording_progress(TEXT, INTEGER) IS
  'Returns privacy-minimal account recording progress without transferring the full contribution history to the API server.';

COMMENT ON TABLE public.recording_duration_ledger IS
  'Minimal lifetime effort ledger; first recording ID wins per account. Independent of audio storage; erased on auth account deletion.';
COMMENT ON TABLE public.recording_duration_totals IS
  'Account lifetime seconds atomically incremented only by newly credited ledger rows.';
COMMIT;
