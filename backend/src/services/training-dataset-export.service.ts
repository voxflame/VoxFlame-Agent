import { createHash } from 'crypto'

import exportConfig from '../config/training-dataset-export.json'
import {
  MAX_UPLOAD_AUDIO_BYTES,
  MAX_UPLOAD_AUDIO_DURATION_SECONDS,
  REQUIRED_LEGAL_CONSENT_VERSION,
  requireCurrentLegalConsent,
  UPLOAD_ADMISSION_VERSION,
  validateUploadSignInput,
  type UploadObjectInspection,
} from './upload-admission.service'
import { uploadPathBelongsToContributor } from './upload-path-policy'

type JsonRecord = Record<string, unknown>

export type DatasetSplit = 'train' | 'validation' | 'test'

export const TRAINING_EXPORT_POLICY_VERSION = exportConfig.policy_version
export const TRAINING_SNAPSHOT_SCHEMA_VERSION = exportConfig.snapshot_schema_version

const ALLOWED_CONSENT_SCOPES = new Set<string>(exportConfig.allowed_consent_scopes)
const ALLOWED_AUDIO_QUALITY_DISPOSITIONS = new Set<string>(
  exportConfig.allowed_audio_quality_dispositions,
)
const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

export interface TrainingExportContributionRow {
  id: string
  contributor_id: string
  audio_path: string
  transcript: string
  sentence_id: string | null
  duration_seconds: number | null
  created_at: string
  metadata: JsonRecord | null
}

export interface TrainingExportEligibleSample {
  contributionId: string
  contributorId: string
  recordingId: string
  audioPath: string
  targetText: string
  sentenceId: string | null
  createdAt: string
  durationMs: number
  format: string
  sampleRate: number | null
  channelCount: number | null
  fileSizeBytes: number
  objectEtag: string
  consentScope: string
  consentVersion: string
  consentAcceptedAt: string
  admissionVersion: string
  admissionVerifiedAt: string
  metadata: JsonRecord
}

export type TrainingExportCandidateResult =
  | { eligible: true; sample: TrainingExportEligibleSample }
  | { eligible: false; reasons: string[] }

export interface SpeakerSplitPolicy {
  algorithm: string
  trainRatio: number
  validationRatio: number
  testRatio: number
}

export const TRAINING_SPEAKER_SPLIT_POLICY: Readonly<SpeakerSplitPolicy> = {
  algorithm: exportConfig.split_policy.algorithm,
  trainRatio: exportConfig.split_policy.train_ratio,
  validationRatio: exportConfig.split_policy.validation_ratio,
  testRatio: exportConfig.split_policy.test_ratio,
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(record: JsonRecord, key: string): boolean | null {
  const value = record[key]
  return typeof value === 'boolean' ? value : null
}

function parseIsoTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeEtag(value: string | null): string | null {
  return value?.trim().replace(/^"|"$/g, '') || null
}

function pathRecordingId(audioPath: string): string | null {
  const filename = audioPath.split('/').at(-1) ?? ''
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : null
}

function addReason(reasons: string[], condition: boolean, reason: string): void {
  if (condition) reasons.push(reason)
}

/**
 * Fail closed before a recording can enter a model-training snapshot.
 * Review-class recordings remain eligible; only explicit unusable/retry states
 * are excluded, and the raw contribution is never deleted by this decision.
 */
export function evaluateTrainingExportCandidate(
  row: TrainingExportContributionRow,
  object: UploadObjectInspection | null,
  currentUserMetadata: unknown,
): TrainingExportCandidateResult {
  const metadata = isRecord(row.metadata) ? row.metadata : {}
  const reasons: string[] = []
  const recordingId = readString(metadata, 'recording_id')
  const targetText = readString(metadata, 'target_text') || row.transcript.trim()
  const consentVersion = readString(metadata, 'consent_version')
  const consentAcceptedAt = readString(metadata, 'consent_accepted_at')
  const consentScope = readString(metadata, 'consent_scope')
  const admissionVerifiedAt = readString(metadata, 'admission_verified_at')
  const declaredFormat = readString(metadata, 'audio_format')
  const declaredSize = readNumber(metadata, 'file_size_bytes')
  const storedEtag = normalizeEtag(readString(metadata, 'object_etag'))
  const durationMs = readNumber(metadata, 'duration_ms')
    ?? (typeof row.duration_seconds === 'number' && Number.isFinite(row.duration_seconds)
      ? Math.round(row.duration_seconds * 1000)
      : null)
  const qualityDisposition = readString(metadata, 'audio_quality_disposition')

  try {
    requireCurrentLegalConsent(currentUserMetadata)
  } catch {
    reasons.push('current_legal_consent_required')
  }

  addReason(reasons, metadata.admission_status !== 'admitted', 'not_server_admitted')
  addReason(
    reasons,
    readString(metadata, 'admission_version') !== UPLOAD_ADMISSION_VERSION,
    'admission_version_mismatch',
  )
  addReason(reasons, consentVersion !== REQUIRED_LEGAL_CONSENT_VERSION, 'consent_version_mismatch')
  addReason(
    reasons,
    !consentScope || !ALLOWED_CONSENT_SCOPES.has(consentScope),
    'consent_scope_not_allowed_for_training',
  )

  const consentAcceptedTime = parseIsoTimestamp(consentAcceptedAt)
  const admissionVerifiedTime = parseIsoTimestamp(admissionVerifiedAt)
  addReason(reasons, consentAcceptedTime === null, 'invalid_verified_consent_timestamp')
  addReason(reasons, admissionVerifiedTime === null, 'invalid_admission_timestamp')
  addReason(
    reasons,
    consentAcceptedTime !== null
      && admissionVerifiedTime !== null
      && consentAcceptedTime > admissionVerifiedTime,
    'consent_timestamp_after_admission',
  )

  addReason(reasons, !uploadPathBelongsToContributor(row.audio_path, row.contributor_id), 'audio_path_owner_mismatch')
  addReason(
    reasons,
    !recordingId || !RECORDING_ID_PATTERN.test(recordingId),
    'invalid_recording_id',
  )
  addReason(
    reasons,
    Boolean(recordingId) && pathRecordingId(row.audio_path) !== recordingId,
    'recording_id_path_mismatch',
  )
  addReason(reasons, targetText.length === 0, 'missing_target_text')
  addReason(
    reasons,
    durationMs === null
      || durationMs <= 0
      || durationMs > MAX_UPLOAD_AUDIO_DURATION_SECONDS * 1000,
    'invalid_audio_duration',
  )

  addReason(reasons, !qualityDisposition, 'missing_audio_quality_disposition')
  addReason(
    reasons,
    Boolean(qualityDisposition) && !ALLOWED_AUDIO_QUALITY_DISPOSITIONS.has(qualityDisposition as string),
    'audio_quality_not_training_ready',
  )
  addReason(
    reasons,
    ['retry_recommended', 'rejected'].includes(readString(metadata, 'evaluation_status') ?? ''),
    'evaluation_not_training_ready',
  )
  addReason(
    reasons,
    readString(metadata, 'alignment_status') === 'retry_recommended'
      || readString(metadata, 'alignment_tier') === 'retry'
      || readString(metadata, 'sample_quality_tier') === 'retry',
    'quality_diagnostic_requires_retry',
  )
  addReason(
    reasons,
    readBoolean(metadata, 'accepted_for_export') === false || Boolean(readString(metadata, 'rejection_reason')),
    'explicitly_rejected_for_export',
  )

  if (!object) {
    reasons.push('audio_object_missing')
  } else {
    addReason(
      reasons,
      !Number.isFinite(object.contentLength)
        || object.contentLength <= 0
        || object.contentLength > MAX_UPLOAD_AUDIO_BYTES,
      'invalid_audio_object_size',
    )
    addReason(reasons, declaredSize === null || declaredSize !== object.contentLength, 'audio_object_size_changed')
    addReason(
      reasons,
      !storedEtag || storedEtag !== normalizeEtag(object.etag),
      'audio_object_etag_changed',
    )

    if (!declaredFormat) {
      reasons.push('missing_audio_format')
    } else {
      try {
        const declared = validateUploadSignInput(row.audio_path, declaredFormat).contentType
        const actual = validateUploadSignInput(row.audio_path, object.contentType).contentType
        addReason(reasons, declared !== actual, 'audio_object_content_type_changed')
      } catch {
        reasons.push('unsupported_audio_type')
      }
    }
  }

  const uploadReceipt = isRecord(metadata.upload_receipt) ? metadata.upload_receipt : {}
  addReason(
    reasons,
    uploadReceipt.manifest_synced !== true
      || readString(uploadReceipt, 'recording_id') !== recordingId
      || readString(uploadReceipt, 'audio_path') !== row.audio_path
      || readString(uploadReceipt, 'manifest_path') !== `dataset/${row.contributor_id}/manifest.jsonl`,
    'upload_artifact_not_fully_synced',
  )

  const uniqueReasons = Array.from(new Set(reasons))
  if (uniqueReasons.length > 0 || !object || !recordingId || !consentScope || !consentVersion
    || !consentAcceptedAt || !admissionVerifiedAt || !declaredFormat || !storedEtag || durationMs === null) {
    return { eligible: false, reasons: uniqueReasons.length > 0 ? uniqueReasons : ['incomplete_export_facts'] }
  }

  return {
    eligible: true,
    sample: {
      contributionId: row.id,
      contributorId: row.contributor_id,
      recordingId,
      audioPath: row.audio_path,
      targetText,
      sentenceId: row.sentence_id,
      createdAt: row.created_at,
      durationMs,
      format: declaredFormat,
      sampleRate: readNumber(metadata, 'sample_rate'),
      channelCount: readNumber(metadata, 'channel_count'),
      fileSizeBytes: object.contentLength,
      objectEtag: storedEtag,
      consentScope,
      consentVersion,
      consentAcceptedAt,
      admissionVersion: UPLOAD_ADMISSION_VERSION,
      admissionVerifiedAt,
      metadata,
    },
  }
}

function splitCounts(speakerCount: number): Record<DatasetSplit, number> {
  if (speakerCount <= 0) return { train: 0, validation: 0, test: 0 }
  if (speakerCount === 1) return { train: 1, validation: 0, test: 0 }
  if (speakerCount === 2) return { train: 1, validation: 1, test: 0 }

  const validation = Math.max(1, Math.floor(speakerCount * TRAINING_SPEAKER_SPLIT_POLICY.validationRatio))
  const test = Math.max(1, Math.floor(speakerCount * TRAINING_SPEAKER_SPLIT_POLICY.testRatio))
  return {
    train: speakerCount - validation - test,
    validation,
    test,
  }
}

/** Assign whole contributors, never individual utterances, to deterministic splits. */
export function assignSpeakerDisjointSplits(
  contributorIds: readonly string[],
): Map<string, DatasetSplit> {
  const uniqueIds = Array.from(new Set(contributorIds.filter((value) => value.trim().length > 0)))
  const ranked = uniqueIds.sort((left, right) => {
    const leftHash = createHash('sha256')
      .update(`${TRAINING_SPEAKER_SPLIT_POLICY.algorithm}:${left}`)
      .digest('hex')
    const rightHash = createHash('sha256')
      .update(`${TRAINING_SPEAKER_SPLIT_POLICY.algorithm}:${right}`)
      .digest('hex')
    return leftHash.localeCompare(rightHash) || left.localeCompare(right)
  })
  const counts = splitCounts(ranked.length)
  const assignments = new Map<string, DatasetSplit>()

  ranked.forEach((contributorId, index) => {
    const split: DatasetSplit = index < counts.train
      ? 'train'
      : index < counts.train + counts.validation
        ? 'validation'
        : 'test'
    assignments.set(contributorId, split)
  })

  return assignments
}

export function assertSpeakerDisjoint(
  samples: ReadonlyArray<{ contributorId: string; split: DatasetSplit }>,
): void {
  const assignments = new Map<string, DatasetSplit>()
  for (const sample of samples) {
    const existing = assignments.get(sample.contributorId)
    if (existing && existing !== sample.split) {
      throw new Error(`speaker_split_overlap:${sample.contributorId}`)
    }
    assignments.set(sample.contributorId, sample.split)
  }
}

/** An active manifest sample must match as one recording/path pair, not two unrelated rows. */
export function activeManifestContainsRecording(
  rows: JsonRecord[],
  recordingId: string,
  audioPath: string,
): boolean {
  return rows.some((row) => {
    const audio = isRecord(row.audio) ? row.audio : {}
    return readString(row, 'recording_id') === recordingId
      && readString(audio, 'path') === audioPath
  })
}
