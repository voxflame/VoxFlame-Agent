CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
\ir ../migrations/20260124000000_create_voice_contributions.sql
CREATE TABLE public.reading_article_progress (contributor_id TEXT, article_id TEXT, current_round INTEGER);
-- Duplicate retry, a new capture of the same sentence, and a legacy row.
INSERT INTO voice_contributions (contributor_id, audio_path, transcript, sentence_id, duration_seconds, metadata, created_at)
VALUES ('test-a', 'old/a.wav', 'same prompt', 's1', 30, '{"recording_id":"r1"}', NOW() - interval '2 day'),
       ('test-a', 'other/a.wav', 'same prompt', 's1', 30, '{"recording_id":"r1"}', NOW() - interval '1 day'),
       ('test-a', 'old/b.wav', 'same prompt', 's1', 20, '{"recording_id":"r2"}', NOW()),
       ('test-a', 'legacy.wav', 'legacy', 's2', 10, '{}', NOW());
\ir ../migrations/20260908010000_persist_recording_duration.sql
