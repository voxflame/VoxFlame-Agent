import { createClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

export type QualityReviewDecision = 'approved' | 'rejected' | 'needs_retake'

export interface QualityReviewQueueItem {
  contributionId: string
  contributorId: string
  audioPath: string
  targetText: string
  sentenceId: string | null
  durationSeconds: number | null
  createdAt: string
  qualityStatus: string
  qualityReasons: string[]
  speechVariant: string | null
  dialectName: string | null
  dialectRegion: string | null
  utterancePairId: string | null
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(metadata: JsonRecord, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(metadata: JsonRecord, key: string): string[] {
  const value = metadata[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

/** Only the recording's explicit variant may supply QC dialect grouping. */
export function readRecordingDialect(metadata: JsonRecord): {
  dialectName: string | null
  dialectRegion: string | null
} {
  const dialectName = readString(metadata, 'speech_variant') === 'dialect'
    ? readString(metadata, 'dialect_name') : null
  return { dialectName, dialectRegion: dialectName ? readString(metadata, 'dialect_region') : null }
}

export class QualityReviewService {
  async listPending(limit: number): Promise<QualityReviewQueueItem[]> {
    if (!supabase) throw new Error('quality_review_storage_unavailable')
    const { data, error } = await supabase
      .from('voice_contributions')
      .select('id, contributor_id, audio_path, transcript, sentence_id, duration_seconds, metadata, created_at')
      .eq('metadata->>quality_status', 'pending_review')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (error) throw new Error(error.message)

    return (Array.isArray(data) ? data : []).flatMap((row) => {
      if (typeof row.id !== 'string' || typeof row.contributor_id !== 'string' || typeof row.audio_path !== 'string') return []
      const metadata = isRecord(row.metadata) ? row.metadata : {}
      return [{
        contributionId: row.id,
        contributorId: row.contributor_id,
        audioPath: row.audio_path,
        targetText: typeof row.transcript === 'string' ? row.transcript : '',
        sentenceId: typeof row.sentence_id === 'string' ? row.sentence_id : null,
        durationSeconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : '',
        qualityStatus: readString(metadata, 'quality_status') ?? 'pending_review',
        qualityReasons: readStringArray(metadata, 'quality_reasons'),
        speechVariant: readString(metadata, 'speech_variant'),
        ...readRecordingDialect(metadata),
        utterancePairId: readString(metadata, 'utterance_pair_id'),
      }]
    })
  }

  async submitDecision(input: {
    contributionId: string
    reviewerId: string
    reviewerEmail: string
    decision: QualityReviewDecision
    reason: string
    requestId: string
  }): Promise<{ reviewId: string; decision: QualityReviewDecision; trainingImportAllowed: false }> {
    if (!supabase) throw new Error('quality_review_storage_unavailable')
    const { data: contribution, error: contributionError } = await supabase
      .from('voice_contributions')
      .select('id')
      .eq('id', input.contributionId)
      .maybeSingle()
    if (contributionError) throw new Error(contributionError.message)
    if (!contribution) throw new Error('quality_review_contribution_not_found')

    const { data, error } = await supabase
      .from('voice_contribution_quality_reviews')
      .upsert({
        contribution_id: input.contributionId,
        reviewer_id: input.reviewerId,
        reviewer_email: input.reviewerEmail,
        decision: input.decision,
        reason: input.reason,
        request_id: input.requestId,
      }, { onConflict: 'request_id' })
      .select('id, decision')
      .single()
    if (error) throw new Error(error.message)
    if (!data || typeof data.id !== 'string') throw new Error('quality_review_write_failed')

    return {
      reviewId: data.id,
      decision: data.decision as QualityReviewDecision,
      trainingImportAllowed: false,
    }
  }
}

export const qualityReviewService = new QualityReviewService()
