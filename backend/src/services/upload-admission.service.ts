import admissionConfig from '../config/upload-admission.json'

type JsonRecord = Record<string, unknown>

export const UPLOAD_ADMISSION_VERSION = admissionConfig.admission_version
export const REQUIRED_LEGAL_CONSENT_VERSION =
  process.env.LEGAL_CONSENT_VERSION?.trim() || admissionConfig.legal_consent_version

export const MAX_UPLOAD_AUDIO_BYTES = admissionConfig.max_audio_bytes
export const MAX_UPLOAD_AUDIO_DURATION_SECONDS = admissionConfig.max_audio_duration_seconds
const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const ALLOWED_AUDIO_EXTENSIONS = new Set<string>(admissionConfig.allowed_audio_extensions)
const CONSENT_SCOPES = new Set([
  'training_only',
  'training_and_model_improvement',
  'evaluation_only',
])

const CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  webm: ['audio/webm'],
  mp4: ['audio/mp4'],
  m4a: ['audio/mp4', 'audio/m4a', 'audio/x-m4a'],
  caf: ['audio/x-caf'],
  aac: ['audio/aac'],
  '3gp': ['audio/3gpp'],
}

export interface VerifiedLegalConsent {
  version: string
  acceptedAt: string | null
}

export interface UploadObjectInspection {
  contentLength: number
  contentType: string
  etag: string | null
}

export interface UploadCompletionInput {
  audioPath: unknown
  text: unknown
  duration: unknown
  metadata: unknown
}

export interface AdmittedUpload {
  audioPath: string
  text: string
  duration: number
  metadata: JsonRecord
}

export class UploadAdmissionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(code)
    this.name = 'UploadAdmissionError'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeContentType(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase()
}

function extensionForPath(path: string): string | null {
  const filename = path.split('/').at(-1) ?? ''
  const dot = filename.lastIndexOf('.')
  return dot > 0 && dot < filename.length - 1
    ? filename.slice(dot + 1).toLowerCase()
    : null
}

function recordingIdForPath(path: string): string | null {
  const filename = path.split('/').at(-1) ?? ''
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : null
}

function assertSupportedAudioType(path: string, contentType: string): string {
  const extension = extensionForPath(path)
  const normalizedContentType = normalizeContentType(contentType)
  const allowed = extension ? CONTENT_TYPES_BY_EXTENSION[extension] : undefined

  if (
    !extension
    || !ALLOWED_AUDIO_EXTENSIONS.has(extension)
    || !allowed
    || !allowed.includes(normalizedContentType)
  ) {
    throw new UploadAdmissionError('unsupported_audio_type')
  }

  return normalizedContentType
}

/** Read the current four-part consent from trusted Supabase Auth metadata. */
export function requireCurrentLegalConsent(userMetadata: unknown): VerifiedLegalConsent {
  const metadata = isRecord(userMetadata) ? userMetadata : {}
  const consent = isRecord(metadata.legal_consent) ? metadata.legal_consent : {}
  const version = nonEmptyString(consent.version)
  const acceptedAt = nonEmptyString(consent.accepted_at)
  if (
    version !== REQUIRED_LEGAL_CONSENT_VERSION
    || !acceptedAt
    || !Number.isFinite(Date.parse(acceptedAt))
    || consent.privacy_accepted !== true
    || consent.sensitive_data_accepted !== true
    || consent.data_collection_accepted !== true
    || consent.commercial_use_accepted !== true
  ) {
    throw new UploadAdmissionError('current_legal_consent_required', 403)
  }

  return {
    version,
    acceptedAt,
  }
}

/** Validate the immutable path/type pair before issuing a direct-upload URL. */
export function validateUploadSignInput(filename: unknown, contentType: unknown): {
  filename: string
  contentType: string
} {
  const safeFilename = nonEmptyString(filename)
  const safeContentType = nonEmptyString(contentType)
  if (!safeFilename || !safeContentType) {
    throw new UploadAdmissionError('missing_filename_or_content_type')
  }

  return {
    filename: safeFilename,
    contentType: assertSupportedAudioType(safeFilename, safeContentType),
  }
}

/**
 * Admit an uploaded object only after OSS facts and client lineage agree.
 * Sample rate/channel claims remain optional for queued legacy clients, but
 * any supplied value must be plausible. New clients always send both fields.
 */
export function admitCompletedUpload(
  input: UploadCompletionInput,
  object: UploadObjectInspection | null,
  consent: VerifiedLegalConsent,
  verifiedAt: string = new Date().toISOString(),
): AdmittedUpload {
  const audioPath = nonEmptyString(input.audioPath)
  const text = nonEmptyString(input.text)
  const duration = finiteNumber(input.duration)
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  const recordingId = nonEmptyString(metadata.recording_id)

  if (!audioPath) throw new UploadAdmissionError('missing_audio_path')
  if (!text) throw new UploadAdmissionError('missing_target_text')
  if (!duration || duration <= 0 || duration > MAX_UPLOAD_AUDIO_DURATION_SECONDS) {
    throw new UploadAdmissionError('invalid_audio_duration')
  }
  if (!recordingId || !RECORDING_ID_PATTERN.test(recordingId)) {
    throw new UploadAdmissionError('invalid_recording_id')
  }
  if (recordingIdForPath(audioPath) !== recordingId) {
    throw new UploadAdmissionError('recording_id_path_mismatch')
  }
  if (!object) {
    throw new UploadAdmissionError('uploaded_audio_not_found', 409)
  }
  if (!Number.isFinite(object.contentLength) || object.contentLength <= 0) {
    throw new UploadAdmissionError('uploaded_audio_empty', 409)
  }
  if (object.contentLength > MAX_UPLOAD_AUDIO_BYTES) {
    throw new UploadAdmissionError('uploaded_audio_too_large', 413)
  }

  const actualContentType = assertSupportedAudioType(audioPath, object.contentType)
  const declaredContentType = nonEmptyString(metadata.audio_format)
  if (declaredContentType) {
    assertSupportedAudioType(audioPath, declaredContentType)
    if (normalizeContentType(declaredContentType) !== actualContentType) {
      throw new UploadAdmissionError('audio_content_type_mismatch', 409)
    }
  }

  const declaredSize = finiteNumber(metadata.file_size_bytes)
  if (declaredSize !== null && declaredSize !== object.contentLength) {
    throw new UploadAdmissionError('audio_size_mismatch', 409)
  }

  const durationMs = finiteNumber(metadata.duration_ms)
  if (durationMs !== null && (durationMs <= 0 || durationMs > MAX_UPLOAD_AUDIO_DURATION_SECONDS * 1000)) {
    throw new UploadAdmissionError('invalid_audio_duration_metadata')
  }
  const sampleRate = finiteNumber(metadata.sample_rate)
  if (sampleRate !== null && (sampleRate < 8_000 || sampleRate > 192_000)) {
    throw new UploadAdmissionError('invalid_audio_sample_rate')
  }
  const channelCount = finiteNumber(metadata.channel_count)
  if (channelCount !== null && (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 2)) {
    throw new UploadAdmissionError('invalid_audio_channel_count')
  }
  const consentScope = nonEmptyString(metadata.consent_scope) || 'training_only'
  if (!CONSENT_SCOPES.has(consentScope)) {
    throw new UploadAdmissionError('invalid_consent_scope')
  }

  return {
    audioPath,
    text,
    duration,
    metadata: {
      ...metadata,
      recording_id: recordingId,
      consent_version: consent.version,
      consent_accepted_at: consent.acceptedAt ?? undefined,
      consent_scope: consentScope,
      audio_format: actualContentType,
      file_size_bytes: object.contentLength,
      admission_status: 'admitted',
      admission_version: UPLOAD_ADMISSION_VERSION,
      admission_verified_at: verifiedAt,
      object_etag: object.etag ?? undefined,
    },
  }
}
