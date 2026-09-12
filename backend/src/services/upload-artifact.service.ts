import { createClient } from '@supabase/supabase-js'
import { ossService } from './oss.service'
import { assessServerRecordingQuality } from './recording-quality.service'

type JsonRecord = Record<string, unknown>

const RECORDING_DISCARDED_EVENT = 'recording_discarded'
const MANIFEST_EVENT_SCHEMA_VERSION = '1.0'

const UPLOAD_METADATA_KEYS = new Set([
  // Training labels and target/transcript separation.
  'kind', 'sentence_id', 'target_text', 'spoken_text', 'recognized_text',
  'prompt_aligned_transcript', 'disability_category', 'condition', 'etiology', 'severity', 'age_band', 'sex',
  'speech_variant', 'dialect_name', 'dialect_region', 'dialect_name_user_reported', 'dialect_code',
  'language_tag', 'prompt_language', 'spoken_language', 'label_source', 'utterance_pair_id',
  'consent_scope', 'consent_version', 'consent_accepted_at', 'collection_plan_id',
  'admission_status', 'admission_version', 'admission_verified_at', 'object_etag',
  'quality_status', 'quality_reasons', 'quality_assessment_version', 'quality_assessed_at',
  'training_import_allowed',
  'reading_assistance_used',
  // Retry de-duplication and prompt lineage.
  'recording_id', 'session_id', 'prompt_group_key', 'prompt_fingerprint',
  'recording_dedupe_key', 'duplicate_policy', 'repeated_prompt_strategy',
  // Operational audio/quality fields needed for QC and manifest export.
  'mode', 'source_surface', 'collection_mode', 'source', 'timestamp',
  'audio_format', 'sample_rate', 'channel_count', 'duration_ms',
  'file_size_bytes', 'capture_transport', 'speech_duration_ms',
  'leading_silence_ms', 'trailing_silence_ms', 'silence_ratio',
  'input_level_rms', 'input_level_peak', 'audio_quality_disposition',
  'audio_quality_reasons', 'confidence', 'confidence_source', 'latency_ms',
  // Training feedback retained for review/reporting, not default model input.
  'exercise_id', 'exercise_text', 'exercise_category', 'feedback_status',
  'clarity_score', 'alignment_score', 'alignment_status', 'alignment_tier',
  'alignment_summary', 'alignment_reasons', 'transcript_coverage_ratio',
  'missing_chars', 'extra_chars', 'speech_patterns', 'articulation_tips',
  'pronunciation_summary', 'pronunciation_targets',
  'prepared_expression_id', 'prepared_expression_section_id',
  'prepared_expression_section_title',
  // Long-form reading lineage. Article bodies stay in the versioned catalog.
  'reading_material_kind', 'reading_article_id', 'reading_article_version',
  'reading_segment_id', 'reading_segment_index', 'reading_segment_count',
  'reading_round_id',
])

export interface UploadCompletePayload {
  contributorId: string
  audioPath: string
  text: string
  recognizedText?: string | null
  sentenceId?: string | null
  duration?: number | null
  source?: string
  metadata?: Record<string, unknown>
}

export interface UploadArtifactResult {
  contributionId: string | null
  recordingId: string
  manifestPath: string
  reusedContribution: boolean
  manifestAlreadySynced: boolean
  transcriptAlreadySynced: boolean | null
}

export interface DiscardUploadPayload {
  contributorId: string
  contributionId?: string | null
  audioPath?: string | null
  recordingId?: string | null
}

export interface DiscardUploadResult {
  contributionId: string | null
  audioPath: string | null
  recordingId: string | null
  manifestPath: string
  removedContribution: boolean
  removedAudioObject: boolean
  removedManifestEntry: boolean
  removedTranscriptEntry: boolean
}

export interface DiscardUploadSteps {
  removeManifestEntry(): Promise<boolean>
  removeTranscriptEntry(): Promise<boolean>
  removeAudioObject(): Promise<boolean>
  removeContribution(): Promise<boolean>
}

/**
 * Keep the database contribution until every external asset cleanup succeeds.
 * A failed request can then be retried with the same durable lookup record.
 */
export async function executeRecoverableDiscard(
  steps: DiscardUploadSteps,
): Promise<Pick<
  DiscardUploadResult,
  'removedContribution' | 'removedAudioObject' | 'removedManifestEntry' | 'removedTranscriptEntry'
>> {
  // Independent external cleanups run together; the database stays last so a
  // failed remote cleanup leaves a durable lookup record for safe retry.
  const externalCleanup = await Promise.allSettled([
    steps.removeManifestEntry(),
    steps.removeTranscriptEntry(),
    steps.removeAudioObject(),
  ])
  const rejected = externalCleanup.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (rejected) {
    throw rejected.reason
  }
  const [removedManifestEntry, removedTranscriptEntry, removedAudioObject] = externalCleanup.map(
    (result): boolean => result.status === 'fulfilled' ? result.value : false,
  )
  const removedContribution = await steps.removeContribution()

  return {
    removedContribution,
    removedAudioObject,
    removedManifestEntry,
    removedTranscriptEntry,
  }
}

export interface RecordingProgressRow {
  sentence_id?: string | null
  duration_seconds?: number | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}

export interface RecordingProgressSnapshot {
  recordedSentenceIds: string[]
  recordedReadingSegmentIds: string[]
  recordedReadingRoundKeys: string[]
  readingArticleRoundIds: Record<string, string>
  lastRecordedExerciseIds: Record<string, string>
  todayDurationSeconds: number
  totalDurationSeconds: number
}

interface ContributionRecord {
  id: string
  metadata: JsonRecord
  audio_path?: string | null
  sentence_id?: string | null
}

interface DiscardContributionMatches {
  contributionId: ContributionRecord | null
  audioPath: ContributionRecord | null
  recordingId: ContributionRecord | null
}

interface UploadReceiptMetadata extends JsonRecord {
  recording_id?: string
  audio_path?: string
  manifest_path?: string
  manifest_synced?: boolean
  synced_at?: string
}

const artifactOperationTails = new Map<string, Promise<void>>()

/** Serialize one account's shared manifest/transcript mutations inside this backend process. */
export async function runSerializedArtifactOperation<T>(
  contributorId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = artifactOperationTails.get(contributorId)?.catch(() => undefined) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = predecessor.then(() => gate)
  artifactOperationTails.set(contributorId, tail)
  await predecessor
  try {
    return await operation()
  } finally {
    release()
    if (artifactOperationTails.get(contributorId) === tail) {
      artifactOperationTails.delete(contributorId)
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeMetadataValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value === 'boolean') {
    return true
  }

  return Array.isArray(value)
    && value.length <= 32
    && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

/**
 * Enforce the dataset metadata boundary server-side. The client allow-list is
 * only a UX/privacy convenience; uploads can also come from old clients or
 * manually crafted requests.
 */
export function sanitizeUploadMetadata(metadata: Record<string, unknown> | undefined): JsonRecord {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter(([key, value]) => UPLOAD_METADATA_KEYS.has(key) && isSafeMetadataValue(value))
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ]),
  )
}

function readString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return ''
}

function readNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = metadata?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function readStringArray(metadata: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = metadata?.[key]
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'unknown_error'
}

function toSafeDurationSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function toTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function normalizeRecordingProgressSnapshot(value: unknown): RecordingProgressSnapshot | null {
  if (!isRecord(value) || value.durationAccounting !== 'durable_v1'
    || typeof value.todayDurationSeconds !== 'number' || !Number.isFinite(value.todayDurationSeconds)
    || value.todayDurationSeconds < 0
    || typeof value.totalDurationSeconds !== 'number' || !Number.isFinite(value.totalDurationSeconds)
    || value.totalDurationSeconds < 0) {
    return null
  }

  return {
    recordedSentenceIds: readStringArray(value, 'recordedSentenceIds') ?? [],
    recordedReadingSegmentIds: readStringArray(value, 'recordedReadingSegmentIds') ?? [],
    recordedReadingRoundKeys: readStringArray(value, 'recordedReadingRoundKeys') ?? [],
    readingArticleRoundIds: readStringRecord(value.readingArticleRoundIds),
    lastRecordedExerciseIds: readStringRecord(value.lastRecordedExerciseIds),
    todayDurationSeconds: toSafeDurationSeconds(value.todayDurationSeconds),
    totalDurationSeconds: toSafeDurationSeconds(value.totalDurationSeconds),
  }
}

/** Build the privacy-minimal progress payload returned to an authenticated user. */
export function summarizeRecordingProgress(
  rows: RecordingProgressRow[],
  timezoneOffsetMinutes: number,
  nowMs: number = Date.now(),
): RecordingProgressSnapshot {
  const safeOffsetMinutes = Number.isFinite(timezoneOffsetMinutes)
    ? Math.max(-840, Math.min(840, Math.round(timezoneOffsetMinutes)))
    : 0
  const localNow = new Date(nowMs - safeOffsetMinutes * 60_000)
  const localDayStartUtc = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  ) + safeOffsetMinutes * 60_000
  const localDayEndUtc = localDayStartUtc + 86_400_000
  const sentenceIds = new Set<string>()
  const readingSegmentIds = new Set<string>()
  const readingRoundKeys = new Set<string>()
  const latestExerciseByScope = new Map<string, { exerciseId: string; createdAt: number; order: number }>()
  let todayDurationSeconds = 0
  let totalDurationSeconds = 0

  for (const [order, row] of rows.entries()) {
    const durationSeconds = toSafeDurationSeconds(row.duration_seconds)
    totalDurationSeconds += durationSeconds

    const createdAt = toTimestamp(row.created_at)
    if (createdAt !== null && createdAt >= localDayStartUtc && createdAt < localDayEndUtc) {
      todayDurationSeconds += durationSeconds
    }

    if (typeof row.sentence_id === 'string' && row.sentence_id.trim()) {
      const exerciseId = row.sentence_id.trim()
      sentenceIds.add(exerciseId)

      const preparedExpressionId = readString(row.metadata ?? undefined, 'prepared_expression_id')
      const readingArticleId = readString(row.metadata ?? undefined, 'reading_article_id')
      const exerciseCategory = readString(row.metadata ?? undefined, 'exercise_category')
      const scopeKey = preparedExpressionId
        ? `prepared_expression:${preparedExpressionId}`
        : !readingArticleId && exerciseCategory
          ? `category:${exerciseCategory}`
          : null

      if (scopeKey) {
        const candidate = {
          exerciseId,
          createdAt: createdAt ?? Number.NEGATIVE_INFINITY,
          order,
        }
        const existing = latestExerciseByScope.get(scopeKey)
        if (
          !existing
          || candidate.createdAt > existing.createdAt
          || (candidate.createdAt === existing.createdAt && candidate.order > existing.order)
        ) {
          latestExerciseByScope.set(scopeKey, candidate)
        }
      }
    }

    const readingSegmentId = readString(row.metadata ?? undefined, 'reading_segment_id')
    if (readingSegmentId) {
      readingSegmentIds.add(readingSegmentId)
      const readingRoundId = readString(row.metadata ?? undefined, 'reading_round_id') ?? 'initial'
      readingRoundKeys.add(`${readingRoundId}:${readingSegmentId}`)
    }
  }

  return {
    recordedSentenceIds: Array.from(sentenceIds).sort(),
    recordedReadingSegmentIds: Array.from(readingSegmentIds).sort(),
    recordedReadingRoundKeys: Array.from(readingRoundKeys).sort(),
    readingArticleRoundIds: {},
    lastRecordedExerciseIds: Object.fromEntries(
      Array.from(latestExerciseByScope.entries()).map(([key, value]) => [key, value.exerciseId]),
    ),
    todayDurationSeconds: Math.round(todayDurationSeconds * 1000) / 1000,
    totalDurationSeconds: Math.round(totalDurationSeconds * 1000) / 1000,
  }
}

export function buildRecordingManifestEntry(
  contributorId: string,
  audioPath: string,
  text: string,
  recognizedText: string | null | undefined,
  duration: number | null | undefined,
  metadata: Record<string, unknown> | undefined,
) {
  const targetText = readString(metadata, 'target_text') || text
  const alignedTranscript =
    readString(metadata, 'prompt_aligned_transcript') ||
    targetText
  const recognizedTranscript =
    recognizedText ||
    readString(metadata, 'recognized_text') ||
    readString(metadata, 'raw_transcript') ||
    ''
  const promptGroupKey =
    readString(metadata, 'prompt_group_key') ||
    readString(metadata, 'exercise_id') ||
    targetText
  const promptFingerprint =
    readString(metadata, 'prompt_fingerprint') ||
    targetText.replace(/\s+/g, '')
  const recordingDedupeKey =
    readString(metadata, 'recording_dedupe_key') ||
    readString(metadata, 'recording_id') ||
    audioPath
  const duplicatePolicy =
    readString(metadata, 'duplicate_policy') ||
    'exact_recording_retry_only'
  const repeatedPromptStrategy =
    readString(metadata, 'repeated_prompt_strategy') ||
    'keep_multiple_attempts'

  return {
    recording_id: readString(metadata, 'recording_id') || audioPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || `${Date.now()}`,
    user_id: contributorId,
    session_id: readString(metadata, 'session_id') || 'unknown-session',
    mode: readString(metadata, 'mode') || 'training',
    source_surface: readString(metadata, 'source_surface') || 'web',
    collection_mode: readString(metadata, 'collection_mode') || 'supervised',
    created_at: readString(metadata, 'timestamp') || new Date().toISOString(),
    prompt: {
      id: readString(metadata, 'exercise_id'),
      text: readString(metadata, 'exercise_text') || targetText,
      category: readString(metadata, 'exercise_category'),
      target_focus: readStringArray(metadata, 'pronunciation_targets'),
      scenario_tag: [readString(metadata, 'exercise_category')].filter(Boolean),
    },
    audio: {
      path: audioPath,
      format: readString(metadata, 'audio_format') || 'audio/webm',
      sample_rate: readNumber(metadata, 'sample_rate') || 16000,
      channel_count: readNumber(metadata, 'channel_count') || 1,
      duration_ms: readNumber(metadata, 'duration_ms') || ((duration || 0) * 1000),
      file_size_bytes: readNumber(metadata, 'file_size_bytes'),
      capture_transport: readString(metadata, 'capture_transport') || 'rtc_dup_track',
    },
    transcript: {
      raw: recognizedTranscript,
      final: targetText,
      aligned: alignedTranscript,
      source: 'rtc_asr',
      confidence: readNumber(metadata, 'confidence') ?? undefined,
      latency_ms: readNumber(metadata, 'latency_ms') ?? undefined,
      language: 'zh-CN',
    },
    evaluation: {
      clarity_signals: {
        clarity_score: readNumber(metadata, 'clarity_score'),
        feedback_status: readString(metadata, 'feedback_status'),
        alignment_score: readNumber(metadata, 'alignment_score'),
        alignment_tier: readString(metadata, 'alignment_tier'),
        alignment_status: readString(metadata, 'alignment_status'),
        transcript_coverage_ratio: readNumber(metadata, 'transcript_coverage_ratio'),
        confidence_source: readString(metadata, 'confidence_source'),
        latency_ms: readNumber(metadata, 'latency_ms'),
      },
      error_tags: [
        ...(readStringArray(metadata, 'missing_chars') || []).map((item) => `missing:${item}`),
        ...(readStringArray(metadata, 'extra_chars') || []).map((item) => `extra:${item}`),
      ],
      focus_feedback: readStringArray(metadata, 'speech_patterns'),
      alignment_summary: readString(metadata, 'alignment_summary'),
      alignment_reasons: readStringArray(metadata, 'alignment_reasons'),
    },
    consent: {
      scope: readString(metadata, 'consent_scope') || 'training_only',
      version: readString(metadata, 'consent_version'),
      accepted_at: readString(metadata, 'consent_accepted_at'),
      retention_tier: 'synced_hot',
      sync_status: 'uploaded',
      visibility: 'private',
    },
    lineage: {
      prompt_group_key: promptGroupKey,
      prompt_fingerprint: promptFingerprint,
      recording_dedupe_key: recordingDedupeKey,
      duplicate_policy: duplicatePolicy,
      repeated_prompt_strategy: repeatedPromptStrategy,
    },
    metadata: metadata || {},
  }
}

function buildUploadReceiptMetadata(
  manifestPath: string,
  audioPath: string,
  recordingId: string,
  manifestSynced: boolean,
): UploadReceiptMetadata {
  return {
    recording_id: recordingId,
    audio_path: audioPath,
    manifest_path: manifestPath,
    manifest_synced: manifestSynced,
    synced_at: new Date().toISOString(),
  }
}

function readUploadReceipt(metadata: JsonRecord): UploadReceiptMetadata {
  return isRecord(metadata.upload_receipt)
    ? metadata.upload_receipt as UploadReceiptMetadata
    : {}
}

function hasManifestReceipt(
  receipt: UploadReceiptMetadata,
  recordingId: string,
  manifestPath: string,
): boolean {
  return (
    receipt.manifest_synced === true &&
    receipt.recording_id === recordingId &&
    receipt.manifest_path === manifestPath
  )
}

function buildTranscriptExportLine(
  contributorId: string,
  audioPath: string,
  text: string,
  sentenceId?: string | null,
): { path: string; line: string; uttId: string } | null {
  if (!sentenceId) {
    return null
  }

  const fileName = audioPath.split('/').pop() || `${sentenceId}_${Date.now()}.wav`
  const uttId = fileName.replace(/\.[^/.]+$/, '')

  return {
    path: `dataset/${contributorId}/transcripts.txt`,
    line: `${uttId}\t${audioPath}\t${text}`,
    uttId,
  }
}

export function classifyManifestRecordingState(
  rows: JsonRecord[],
  recordingId: string,
  audioPath: string,
): 'active' | 'discarded' | 'missing' {
  if (rows.some((row) => (
    isRecordingDiscardEvent(row) && manifestRowMatchesRecording(row, recordingId, audioPath)
  ))) {
    return 'discarded'
  }

  return rows.some((row) => manifestRowMatchesRecording(row, recordingId, audioPath))
    ? 'active'
    : 'missing'
}

async function getManifestRecordingState(
  manifestPath: string,
  recordingId: string,
  audioPath: string,
): Promise<'active' | 'discarded' | 'missing'> {
  const content = await ossService.getTextObject(manifestPath)
  if (!content) {
    return 'missing'
  }

  return classifyManifestRecordingState(parseJsonLines(content), recordingId, audioPath)
}

async function transcriptExportContainsLine(
  transcriptsPath: string,
  expectedLine: string,
  audioPath: string,
  uttId: string,
): Promise<boolean> {
  const content = await ossService.getTextObject(transcriptsPath)
  if (!content) {
    return false
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .some((line) => (
      line === expectedLine ||
      line.includes(`\t${audioPath}\t`) ||
      line.startsWith(`${uttId}\t${audioPath}\t`)
    ))
}

async function findExistingContribution(
  contributorId: string,
  audioPath: string,
): Promise<ContributionRecord | null> {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase
    .from('voice_contributions')
    .select('id, metadata, audio_path, sentence_id')
    .eq('contributor_id', contributorId)
    .eq('audio_path', audioPath)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    audio_path: typeof row.audio_path === 'string' ? row.audio_path : null,
    sentence_id: typeof row.sentence_id === 'string' ? row.sentence_id : null,
  }
}

async function findContributionByDiscardSelector(
  contributorId: string,
  column: 'id' | 'audio_path' | 'metadata->>recording_id',
  value: string,
): Promise<ContributionRecord | null> {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase
    .from('voice_contributions')
    .select('id, metadata, audio_path, sentence_id')
    .eq('contributor_id', contributorId)
    .eq(column, value)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null
  if (!row || typeof row.id !== 'string') {
    return null
  }

  return {
    id: row.id,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    audio_path: typeof row.audio_path === 'string' ? row.audio_path : null,
    sentence_id: typeof row.sentence_id === 'string' ? row.sentence_id : null,
  }
}

/** Refuse to combine identifiers that resolve to different recordings. */
export function resolveDiscardContributionMatches(
  payload: DiscardUploadPayload,
  matches: DiscardContributionMatches,
): ContributionRecord | null {
  if (payload.audioPath && payload.recordingId) {
    const pathRecordingId = payload.audioPath.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? ''
    if (pathRecordingId !== payload.recordingId) {
      throw new Error('discard_identifier_mismatch')
    }
  }

  const suppliedMatches = [
    ['contributionId', payload.contributionId, matches.contributionId],
    ['audioPath', payload.audioPath, matches.audioPath],
    ['recordingId', payload.recordingId, matches.recordingId],
  ] as const
  const resolved: Array<readonly [string, string, ContributionRecord]> = []
  for (const [name, value, match] of suppliedMatches) {
    if (typeof value === 'string' && value.trim().length > 0 && match) {
      resolved.push([name, value, match])
    }
  }

  if (resolved.length > 0) {
    const expectedId = resolved[0][2].id
    if (resolved.some((entry) => entry[2].id !== expectedId)) {
      throw new Error('discard_identifier_mismatch')
    }

    const selected = resolved[0][2]
    if (payload.contributionId && payload.contributionId !== selected.id) {
      throw new Error('discard_identifier_mismatch')
    }
    if (payload.audioPath && selected.audio_path && payload.audioPath !== selected.audio_path) {
      throw new Error('discard_identifier_mismatch')
    }
    if (payload.recordingId) {
      const receipt = readUploadReceipt(selected.metadata)
      const storedRecordingId =
        readString(selected.metadata, 'recording_id') ||
        receipt.recording_id ||
        selected.audio_path?.split('/').pop()?.replace(/\.[^/.]+$/, '') ||
        null
      if (storedRecordingId && payload.recordingId !== storedRecordingId) {
        throw new Error('discard_identifier_mismatch')
      }
    }

    return selected
  }

  return null
}

async function findContributionForDiscard(payload: DiscardUploadPayload): Promise<ContributionRecord | null> {
  if (!supabase) {
    return null
  }

  const [contributionId, audioPath, recordingId] = await Promise.all([
    payload.contributionId
      ? findContributionByDiscardSelector(payload.contributorId, 'id', payload.contributionId)
      : null,
    payload.audioPath
      ? findContributionByDiscardSelector(payload.contributorId, 'audio_path', payload.audioPath)
      : null,
    payload.recordingId
      ? findContributionByDiscardSelector(payload.contributorId, 'metadata->>recording_id', payload.recordingId)
      : null,
  ])

  return resolveDiscardContributionMatches(payload, {
    contributionId,
    audioPath,
    recordingId,
  })
}

async function upsertContributionSkeleton(payload: UploadCompletePayload): Promise<ContributionRecord | null> {
  if (!supabase) {
    return null
  }

  const row = {
    contributor_id: payload.contributorId,
    audio_path: payload.audioPath,
    transcript: payload.text,
    sentence_id: payload.sentenceId || null,
    is_free_recording: payload.source !== 'guided_recording',
    duration_seconds: payload.duration,
    metadata: payload.metadata || {},
  }

  const { data, error } = await supabase
    .from('voice_contributions')
    .insert(row)
    .select('id, metadata')
    .single()

  if (error) {
    const existing = await findExistingContribution(payload.contributorId, payload.audioPath)
    if (existing) {
      return existing
    }

    throw new Error(error.message)
  }

  if (!data || typeof data.id !== 'string') {
    return null
  }

  return {
    id: data.id,
    metadata: isRecord(data.metadata) ? data.metadata : {},
  }
}

async function updateContributionMetadata(
  contributionId: string,
  metadata: JsonRecord,
): Promise<void> {
  if (!supabase) {
    return
  }

  const { error } = await supabase
    .from('voice_contributions')
    .update({ metadata })
    .eq('id', contributionId)
    .select('id')
    .single()

  if (error) {
    throw new Error(error.message)
  }
}

function manifestRowMatchesRecording(
  row: JsonRecord,
  recordingId: string | null,
  audioPath: string | null,
): boolean {
  const audio = isRecord(row.audio) ? row.audio : {}
  return (
    (Boolean(recordingId) && row.recording_id === recordingId) ||
    (Boolean(audioPath) && audio.path === audioPath)
  )
}

function isRecordingDiscardEvent(row: JsonRecord): boolean {
  return row.event === RECORDING_DISCARDED_EVENT
}

function parseJsonLines(content: string): JsonRecord[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown
        return isRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
}

/** Resolve append-only manifest events to the recordings that remain active. */
export function resolveActiveManifestRows(rows: JsonRecord[]): JsonRecord[] {
  const discardedRecordingIds = new Set<string>()
  const discardedAudioPaths = new Set<string>()

  for (const row of rows) {
    if (!isRecordingDiscardEvent(row)) continue
    if (typeof row.recording_id === 'string' && row.recording_id.trim()) {
      discardedRecordingIds.add(row.recording_id)
    }
    const audio = isRecord(row.audio) ? row.audio : {}
    if (typeof audio.path === 'string' && audio.path.trim()) {
      discardedAudioPaths.add(audio.path)
    }
  }

  return rows.filter((row) => {
    if (isRecordingDiscardEvent(row)) return false
    const audio = isRecord(row.audio) ? row.audio : {}
    return !(
      (typeof row.recording_id === 'string' && discardedRecordingIds.has(row.recording_id)) ||
      (typeof audio.path === 'string' && discardedAudioPaths.has(audio.path))
    )
  })
}

function buildRecordingDiscardEvent(
  recordingId: string | null,
  audioPath: string | null,
): JsonRecord {
  return {
    event: RECORDING_DISCARDED_EVENT,
    schema_version: MANIFEST_EVENT_SCHEMA_VERSION,
    recording_id: recordingId,
    audio: { path: audioPath },
    discarded_at: new Date().toISOString(),
  }
}

function serializeLines(lines: string[]): string {
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export function removeManifestRecordingLines(
  content: string,
  recordingId: string | null,
  audioPath: string | null,
): string {
  const remaining = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line) as unknown
        return !isRecord(parsed)
          || isRecordingDiscardEvent(parsed)
          || !manifestRowMatchesRecording(parsed, recordingId, audioPath)
      } catch {
        return true
      }
    })
  return serializeLines(remaining)
}

export function removeTranscriptRecordingLines(
  content: string,
  audioPath: string | null,
  recordingId: string | null,
): string {
  const remaining = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !(
      (Boolean(audioPath) && line.includes(`\t${audioPath}\t`)) ||
      (Boolean(recordingId) && line.startsWith(`${recordingId}\t`))
    ))
  return serializeLines(remaining)
}

async function removeRecordingFromManifest(
  manifestPath: string,
  recordingId: string | null,
  audioPath: string | null,
): Promise<boolean> {
  if (!recordingId && !audioPath) {
    return false
  }

  const content = await ossService.getTextObject(manifestPath)
  const rows = parseJsonLines(content ?? '')
  const existingDiscard = rows.some((row) => (
    isRecordingDiscardEvent(row) && manifestRowMatchesRecording(row, recordingId, audioPath)
  ))
  const activeMatch = rows.some((row) => (
    !isRecordingDiscardEvent(row) &&
    manifestRowMatchesRecording(row, recordingId, audioPath)
  ))
  if (!existingDiscard || activeMatch) {
    const remaining = content
      ? removeManifestRecordingLines(content, recordingId, audioPath)
      : ''
    const nextContent = existingDiscard
      ? remaining
      : `${remaining}${JSON.stringify(buildRecordingDiscardEvent(recordingId, audioPath))}\n`
    await ossService.writeTextObject(manifestPath, nextContent)
  }
  return true
}

async function removeRecordingFromTranscriptExport(
  transcriptsPath: string,
  audioPath: string | null,
  recordingId: string | null,
): Promise<boolean> {
  if (!audioPath && !recordingId) {
    return false
  }

  return await ossService.rewriteTextObject(
    transcriptsPath,
    (current) => removeTranscriptRecordingLines(current, audioPath, recordingId),
  )
}

async function cleanupDiscardedUpload(
  payload: UploadCompletePayload,
  manifestPath: string,
  recordingId: string,
): Promise<void> {
  const existing = await findExistingContribution(payload.contributorId, payload.audioPath)
  await executeRecoverableDiscard({
    removeManifestEntry: () => removeRecordingFromManifest(
      manifestPath,
      recordingId,
      payload.audioPath,
    ),
    removeTranscriptEntry: () => removeRecordingFromTranscriptExport(
      `dataset/${payload.contributorId}/transcripts.txt`,
      payload.audioPath,
      recordingId,
    ),
    removeAudioObject: async () => {
      await ossService.deleteObject(payload.audioPath)
      return true
    },
    removeContribution: async () => (
      existing?.id
        ? await deleteContribution(payload.contributorId, existing.id)
        : false
    ),
  })
}

async function deleteContribution(contributorId: string, contributionId: string): Promise<boolean> {
  if (!supabase) {
    return false
  }

  const { error } = await supabase
    .from('voice_contributions')
    .delete()
    .eq('id', contributionId)
    .eq('contributor_id', contributorId)

  if (error) {
    throw new Error(error.message)
  }

  return true
}

export class UploadArtifactService {
  async getRecordingProgress(
    contributorId: string,
    timezoneOffsetMinutes: number,
  ): Promise<RecordingProgressSnapshot> {
    if (!supabase) throw new Error('recording_progress_storage_unavailable')
    const { data, error } = await supabase.rpc('get_recording_progress', {
      p_contributor_id: contributorId,
      p_timezone_offset_minutes: timezoneOffsetMinutes,
    })
    if (error) throw new Error('recording_progress_storage_unavailable')
    const snapshot = normalizeRecordingProgressSnapshot(data)
    // Never silently fall back to a sum of deletable contribution rows.
    if (!snapshot) throw new Error('recording_duration_migration_required')
    return snapshot
  }

  async resetReadingArticleProgress(
    contributorId: string,
    articleId: string,
  ): Promise<{ articleId: string; roundId: string }> {
    if (!supabase) {
      throw new Error('reading_progress_storage_unavailable')
    }

    const { data: existing, error: readError } = await supabase
      .from('reading_article_progress')
      .select('current_round')
      .eq('contributor_id', contributorId)
      .eq('article_id', articleId)
      .maybeSingle()

    if (readError) {
      throw new Error(readError.message)
    }

    const currentRound = existing
      && typeof existing.current_round === 'number'
      && Number.isInteger(existing.current_round)
      && existing.current_round >= 0
        ? existing.current_round
        : 0
    const nextRound = currentRound + 1
    const { error: writeError } = await supabase
      .from('reading_article_progress')
      .upsert({
        contributor_id: contributorId,
        article_id: articleId,
        current_round: nextRound,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'contributor_id,article_id' })

    if (writeError) {
      throw new Error(writeError.message)
    }

    return { articleId, roundId: `round-${nextRound}` }
  }

  async persistCompletedUpload(payload: UploadCompletePayload): Promise<UploadArtifactResult> {
    return await runSerializedArtifactOperation(payload.contributorId, async () => {
    const manifestPath = `dataset/${payload.contributorId}/manifest.jsonl`
    const sanitizedMetadata = sanitizeUploadMetadata({
      ...(payload.metadata || {}),
      target_text: firstNonEmptyString(payload.metadata?.target_text, payload.text),
      recognized_text: firstNonEmptyString(payload.recognizedText, payload.metadata?.recognized_text),
      spoken_text: firstNonEmptyString(payload.metadata?.spoken_text, payload.recognizedText),
    })
    const serverQuality = assessServerRecordingQuality(
      sanitizedMetadata,
      typeof payload.duration === 'number' ? payload.duration : 0,
    )
    Object.assign(sanitizedMetadata, serverQuality)
    const manifestEntry = buildRecordingManifestEntry(
      payload.contributorId,
      payload.audioPath,
      payload.text,
      payload.recognizedText,
      typeof payload.duration === 'number' ? payload.duration : null,
      sanitizedMetadata,
    )
    const manifestState = await getManifestRecordingState(
      manifestPath,
      manifestEntry.recording_id,
      payload.audioPath,
    )
    if (manifestState === 'discarded') {
      await cleanupDiscardedUpload(payload, manifestPath, manifestEntry.recording_id)
      throw new Error('recording_already_discarded')
    }

    let existing: ContributionRecord | null = null
    let reusedContribution = false

    if (!supabase) throw new Error('recording_progress_storage_unavailable')
    // Reject an incomplete rollout before issuing an upload success receipt.
    const { error: ledgerError } = await supabase.from('recording_duration_totals')
      .select('contributor_id').eq('contributor_id', payload.contributorId).limit(1)
    if (ledgerError) throw new Error('recording_duration_migration_required')
    existing = await findExistingContribution(payload.contributorId, payload.audioPath)
    reusedContribution = Boolean(existing)
    if (!existing) {
      existing = await upsertContributionSkeleton({ ...payload, metadata: sanitizedMetadata })
    }
    if (!existing?.id) throw new Error('recording_contribution_persistence_failed')

    const currentMetadata = existing?.metadata ?? {}
    const mergedMetadata = sanitizeUploadMetadata({
      ...currentMetadata,
      ...sanitizedMetadata,
    })
    const existingReceipt = readUploadReceipt(currentMetadata)
    const manifestAlreadySynced = manifestState === 'active' || hasManifestReceipt(
      existingReceipt,
      manifestEntry.recording_id,
      manifestPath,
    )

    if (!manifestAlreadySynced) {
      await ossService.appendTextLog(
        manifestPath,
        JSON.stringify(manifestEntry),
      )
    }

    if (await getManifestRecordingState(
      manifestPath,
      manifestEntry.recording_id,
      payload.audioPath,
    ) === 'discarded') {
      await cleanupDiscardedUpload(payload, manifestPath, manifestEntry.recording_id)
      throw new Error('recording_already_discarded')
    }

    const transcriptExport = payload.source === 'guided_recording'
      ? buildTranscriptExportLine(
        payload.contributorId,
        payload.audioPath,
        payload.text,
        payload.sentenceId,
      )
      : null

    let transcriptAlreadySynced: boolean | null = null

    if (transcriptExport) {
      transcriptAlreadySynced = await transcriptExportContainsLine(
        transcriptExport.path,
        transcriptExport.line,
        payload.audioPath,
        transcriptExport.uttId,
      )

      if (!transcriptAlreadySynced) {
        await ossService.appendTextLog(transcriptExport.path, transcriptExport.line)
      }
    }

    if (await getManifestRecordingState(
      manifestPath,
      manifestEntry.recording_id,
      payload.audioPath,
    ) === 'discarded') {
      await cleanupDiscardedUpload(payload, manifestPath, manifestEntry.recording_id)
      throw new Error('recording_already_discarded')
    }

    if (existing?.id) {
      const nextReceipt = hasManifestReceipt(existingReceipt, manifestEntry.recording_id, manifestPath)
        ? {
          ...existingReceipt,
          audio_path: payload.audioPath,
          manifest_path: manifestPath,
          manifest_synced: true,
        }
        : buildUploadReceiptMetadata(
          manifestPath,
          payload.audioPath,
          manifestEntry.recording_id,
          true,
        )

      // The DB confirmation trigger credits duration atomically with this receipt.
      // A failure must reach the caller so Web/Mobile retain their retry queue.
      await updateContributionMetadata(existing.id, {
        ...mergedMetadata,
        upload_receipt: nextReceipt,
      })
    }

    return {
      contributionId: existing?.id ?? null,
      recordingId: manifestEntry.recording_id,
      manifestPath,
      reusedContribution,
      manifestAlreadySynced,
      transcriptAlreadySynced,
    }
    })
  }

  async discardCompletedUpload(payload: DiscardUploadPayload): Promise<DiscardUploadResult> {
    return await runSerializedArtifactOperation(payload.contributorId, async () => {
    const manifestPath = `dataset/${payload.contributorId}/manifest.jsonl`
  const existing = await findContributionForDiscard(payload)
    const metadata = existing?.metadata ?? {}
    const receipt = readUploadReceipt(metadata)
    const audioPath =
      existing?.audio_path ||
      payload.audioPath ||
      receipt.audio_path ||
      null
    const recordingId =
      payload.recordingId ||
      receipt.recording_id ||
      readString(metadata, 'recording_id') ||
      (audioPath ? audioPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || null : null)
    const contributionId = existing?.id ?? payload.contributionId ?? null

    const discardStartedAt = Date.now()
    const removed = await executeRecoverableDiscard({
      removeManifestEntry: () => removeRecordingFromManifest(
        manifestPath,
        recordingId,
        audioPath,
      ),
      removeTranscriptEntry: () => removeRecordingFromTranscriptExport(
        `dataset/${payload.contributorId}/transcripts.txt`,
        audioPath,
        recordingId,
      ),
      removeAudioObject: async () => {
        if (!audioPath) return false
        await ossService.deleteObject(audioPath)
        return true
      },
      removeContribution: async () => (
        contributionId
          ? await deleteContribution(payload.contributorId, contributionId)
          : false
      ),
    })

    console.log(
      `[Upload] Discard timing totalMs=${Date.now() - discardStartedAt} `
      + `manifest=${removed.removedManifestEntry} transcript=${removed.removedTranscriptEntry} `
      + `audio=${removed.removedAudioObject} contribution=${removed.removedContribution}`,
    )

    return {
      contributionId,
      audioPath,
      recordingId,
      manifestPath,
      ...removed,
    }
    })
  }
}

export const uploadArtifactService = new UploadArtifactService()
