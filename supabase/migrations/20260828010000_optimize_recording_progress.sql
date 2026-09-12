CREATE INDEX IF NOT EXISTS idx_voice_contributions_contributor_created_at_id
ON public.voice_contributions (contributor_id, created_at, id);

CREATE OR REPLACE FUNCTION public.get_recording_progress(
  p_contributor_id TEXT,
  p_timezone_offset_minutes INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
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
    'todayDurationSeconds', COALESCE((
      SELECT ROUND(SUM(duration_seconds)::numeric, 3)
      FROM contributions, day_window
      WHERE created_at >= day_start AND created_at < day_end
    ), 0),
    'totalDurationSeconds', COALESCE((
      SELECT ROUND(SUM(duration_seconds)::numeric, 3)
      FROM contributions
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.get_recording_progress(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recording_progress(TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.get_recording_progress(TEXT, INTEGER) IS
  'Returns privacy-minimal account recording progress without transferring the full contribution history to the API server.';
