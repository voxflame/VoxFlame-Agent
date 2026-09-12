CREATE TABLE IF NOT EXISTS public.reading_article_progress (
  contributor_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contributor_id, article_id)
);

ALTER TABLE public.reading_article_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_article_progress FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.reading_article_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.reading_article_progress FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reading_article_progress TO service_role;

COMMENT ON TABLE public.reading_article_progress IS
  'Account-level current reading cycle. Resetting advances the cycle without deleting recordings.';
