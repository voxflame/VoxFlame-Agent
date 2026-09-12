CREATE TABLE IF NOT EXISTS public.voice_contribution_quality_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contribution_id UUID NOT NULL REFERENCES public.voice_contributions(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL,
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'needs_retake')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  request_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_contribution_quality_reviews_contribution_created
ON public.voice_contribution_quality_reviews (contribution_id, created_at DESC);

ALTER TABLE public.voice_contribution_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_contribution_quality_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.voice_contribution_quality_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.voice_contribution_quality_reviews TO service_role;

COMMENT ON TABLE public.voice_contribution_quality_reviews IS
'人工质检审计记录；复核决定不直接授权训练导入。';
