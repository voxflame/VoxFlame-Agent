\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.check_total(account TEXT, expected NUMERIC) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE actual NUMERIC;
BEGIN
  actual := (public.get_recording_progress(account, 0)->>'totalDurationSeconds')::numeric;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'total for %: expected %, got %', account, expected, actual; END IF;
END;
$$;
SELECT pg_temp.check_total('test-a', 60);
SELECT pg_temp.check_total('test-b', 0);
DO $$ BEGIN
  IF (get_recording_progress('test-a',0)->>'todayDurationSeconds')::numeric <> 30 THEN
    RAISE EXCEPTION 'backfill date lost';
  END IF;
  IF (SELECT recording_count FROM recording_duration_totals WHERE contributor_id='test-a') <> 3 THEN
    RAISE EXCEPTION 'historical retries counted twice';
  END IF;
END $$;
-- Skeleton is not a confirmed upload.
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, sentence_id, duration_seconds, metadata)
VALUES ('test-a', 'new.wav', 'same prompt', 's1', 5.125, '{"recording_id":"r3"}');
SELECT pg_temp.check_total('test-a', 60);
UPDATE voice_contributions SET metadata = metadata || '{"upload_receipt":{"manifest_synced":true,"recording_id":"r3"}}'
WHERE audio_path='new.wav';
SELECT pg_temp.check_total('test-a', 65.125);
-- Repeated receipt, path migration, altered duration and ID on the same DB row cannot recredit.
UPDATE voice_contributions SET audio_path='moved/new.wav', duration_seconds=999, metadata=metadata||'{"recording_id":"altered-id"}'
WHERE audio_path='new.wav';
SELECT pg_temp.check_total('test-a', 65.125);
-- Legacy confirmation must not recredit its baseline.
UPDATE voice_contributions SET metadata='{"recording_id":"legacy-now-known","upload_receipt":{"manifest_synced":true}}'
WHERE audio_path='legacy.wav';
SELECT pg_temp.check_total('test-a', 65.125);
-- Delete every audio metadata row, then retry/reimport an old stable recording ID.
DELETE FROM voice_contributions WHERE contributor_id='test-a';
SELECT pg_temp.check_total('test-a', 65.125);
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, duration_seconds, metadata)
VALUES ('test-a', 'reimport/r3.wav', 'same prompt', 5.125,
        '{"recording_id":"r3","upload_receipt":{"manifest_synced":true}}');
SELECT pg_temp.check_total('test-a', 65.125);
-- Same ID for another account is isolated; same sentence with a new ID counts.
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, sentence_id, duration_seconds, metadata)
VALUES ('test-b', 'b/r3.wav', 'same prompt', 's1', 8,
        '{"recording_id":"r3","upload_receipt":{"manifest_synced":true}}'),
       ('test-a', 'a/r4.wav', 'same prompt', 's1', 7,
        '{"recording_id":"r4","upload_receipt":{"manifest_synced":true}}');
SELECT pg_temp.check_total('test-a', 72.125);
SELECT pg_temp.check_total('test-b', 8);
-- An outer transaction abort also rolls back the ledger and counter.
BEGIN;
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, duration_seconds, metadata)
VALUES ('test-a', 'rollback.wav', 'test', 100, '{"recording_id":"abort","upload_receipt":{"manifest_synced":true}}');
ROLLBACK;
SELECT pg_temp.check_total('test-a', 72.125);
-- Invalid confirmed values abort without corrupting the aggregate.
DO $$ DECLARE bad FLOAT8; BEGIN
  FOREACH bad IN ARRAY ARRAY[-1::float8, 'NaN'::float8, 'Infinity'::float8, NULL::float8] LOOP
    BEGIN
      INSERT INTO voice_contributions (contributor_id, audio_path, transcript, duration_seconds, metadata)
      VALUES ('test-a', 'bad.wav', 'test', bad, '{"recording_id":"bad","upload_receipt":{"manifest_synced":true}}');
      RAISE EXCEPTION 'unexpected_invalid_acceptance';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'recording_duration_invalid' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
SELECT pg_temp.check_total('test-a', 72.125);
-- Offset day boundary (DB session timezone must not change result).
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, duration_seconds, metadata, created_at)
VALUES ('test-day', 'day.wav', 'test', 9, '{"recording_id":"day","upload_receipt":{"manifest_synced":true}}',
        date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 hour');
DO $$ DECLARE expected NUMERIC; BEGIN
  expected := CASE WHEN (NOW() AT TIME ZONE 'UTC')::time < '16:00'::time THEN 9 ELSE 0 END;
  IF (get_recording_progress('test-day',-480)->>'todayDurationSeconds')::numeric <> expected THEN
    RAISE EXCEPTION 'offset day incorrect'; END IF;
  PERFORM set_config('timezone', 'America/Los_Angeles', true);
  IF (get_recording_progress('test-day',-480)->>'todayDurationSeconds')::numeric <> expected THEN
    RAISE EXCEPTION 'session timezone changed result'; END IF;
END $$;
-- Minimal statistics are not exempt from account erasure.
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, duration_seconds, metadata)
VALUES ('00000000-0000-4000-8000-000000000001', 'erase.wav', 'test', 4,
        '{"recording_id":"erase","upload_receipt":{"manifest_synced":true}}');
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_total('00000000-0000-4000-8000-000000000001', 0);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM recording_duration_ledger WHERE contributor_id='00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'erasure missed ledger'; END IF;
  IF has_table_privilege('authenticated', 'recording_duration_ledger', 'SELECT')
    OR has_table_privilege('anon', 'recording_duration_totals', 'SELECT')
    OR has_table_privilege('service_role', 'recording_duration_totals', 'UPDATE')
    OR has_function_privilege('authenticated', 'get_recording_progress(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'unexpected privileges'; END IF;
END $$;
SET ROLE service_role;
SELECT public.get_recording_progress('test-a',0);
RESET ROLE;
SELECT 'recording duration SQL assertions passed' AS result;
