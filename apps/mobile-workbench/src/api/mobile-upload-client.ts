import { File } from 'expo-file-system'

import type {
  MobileWorkbenchRecorderQueueItem,
  MobileWorkbenchUploadReceipt,
} from '../contracts/workbench-contracts'
import type {
  MobileAuthTokenProvider,
  MobileWorkbenchClientOptions,
} from './mobile-workbench-client'
import { MOBILE_LEGAL_CONSENT_VERSION } from '../auth/legal-consent'

interface UploadSignResponse {
  url: string
}

interface UploadCompleteResponse {
  success: boolean
  contributionId?: string | null
  recordingId?: string
  manifestPath?: string
  reusedContribution?: boolean
  manifestAlreadySynced?: boolean
}

interface UploadDiscardResponse {
  success: boolean
}

const MOBILE_UPLOAD_REQUEST_ATTEMPTS = 3

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/** Bound every upload step; the persisted queue owns recovery after a timeout. */
async function fetchUploadStep(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchUploadApiWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  tokenProvider: MobileAuthTokenProvider,
  expectedUserId: string,
): Promise<Response> {
  let response: Response | null = null
  let rejectedToken: string | undefined
  let authRetried = false
  for (let attempt = 0; attempt < MOBILE_UPLOAD_REQUEST_ATTEMPTS; attempt += 1) {
    const token = await tokenProvider.getAccessToken({ expectedUserId, rejectedToken })
    if (!token || token === rejectedToken) throw new Error('mobile_auth_expired')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    response = await fetchUploadStep(input, { ...init, headers })
    if (response.status === 401) {
      if (authRetried || attempt === MOBILE_UPLOAD_REQUEST_ATTEMPTS - 1) return response
      authRetried = true
      rejectedToken = token
      continue
    }
    if ((response.status !== 408 && response.status !== 429 && response.status !== 503)
      || attempt === MOBILE_UPLOAD_REQUEST_ATTEMPTS - 1) return response
    const retryAfter = Number(response.headers.get('Retry-After'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(10_000, retryAfter * 1000)
      : Math.min(4_000, 500 * 2 ** attempt)
    await wait(delayMs)
  }
  return response as Response
}

function buildApiUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function getAuthorizationHeader(
  tokenProvider: MobileAuthTokenProvider,
  expectedUserId: string,
): Promise<Record<string, string>> {
  const token = await tokenProvider.getAccessToken({ expectedUserId })
  if (!token) {
    throw new Error('mobile_auth_required')
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

function normalizeExtension(format: string): string {
  const normalized = format.trim().toLowerCase().replace(/^\./, '')
  return normalized || 'm4a'
}

function contentTypeForFormat(format: string): string {
  const extension = normalizeExtension(format)

  if (extension === 'wav') {
    return 'audio/wav'
  }

  if (extension === 'mp4' || extension === 'm4a') {
    return 'audio/mp4'
  }

  if (extension === 'webm') {
    return 'audio/webm'
  }

  if (extension === 'caf') {
    return 'audio/x-caf'
  }

  return 'application/octet-stream'
}

function buildMobileStoragePath(item: MobileWorkbenchRecorderQueueItem): string {
  const extension = normalizeExtension(item.recording.audio.format)
  return [
    'dataset',
    item.contributorId,
    'mobile-workbench',
    `${item.recordingId}.${extension}`,
  ].join('/')
}

const TRAINING_METADATA_KEYS = new Set([
  'kind',
  'sentence_id',
  'target_text',
  'spoken_text',
  'recognized_text',
  'consent_version',
  'collection_plan_id',
  'reading_assistance_used',
  'etiology',
  'speech_variant',
  'dialect_name', 'dialect_region',
  'dialect_name_user_reported',
  'dialect_code',
  'language_tag',
  'prompt_language',
  'spoken_language',
  'label_source',
  'utterance_pair_id',
  'severity',
  'age_band',
  'sex',
  'exercise_id',
  'exercise_category',
  'feedback_status',
  'clarity_score',
  'alignment_score',
  'missing_chars',
  'extra_chars',
  'prepared_expression_id',
  'prepared_expression_section_id',
  'speech_patterns',
  'articulation_tips',
  'pronunciation_summary',
  'reading_material_kind',
  'reading_article_id',
  'reading_article_version',
  'reading_segment_id',
  'reading_segment_index',
  'reading_segment_count',
  'reading_round_id',
])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeMetadataValue(value: unknown): boolean {
  if (isNonEmptyString(value) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return true
  }

  return Array.isArray(value)
    && value.length <= 32
    && value.every((item) => isNonEmptyString(item))
}

function sanitizeMobileTrainingMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) => TRAINING_METADATA_KEYS.has(key) && isSafeMetadataValue(value))
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ]),
  )
}

function buildUploadMetadata(
  item: MobileWorkbenchRecorderQueueItem,
  contentType: string,
): Record<string, unknown> {
  return {
    ...sanitizeMobileTrainingMetadata(item.metadata),
    recording_id: item.recording.recordingId,
    session_id: item.recording.sessionId,
    consent_scope: item.consentScope,
    sentence_id: item.sentenceId,
    target_text: item.text,
    audio_format: contentType,
    sample_rate: item.recording.audio.sampleRate,
    channel_count: item.recording.audio.channelCount,
    duration_ms: item.recording.audio.durationMs,
    file_size_bytes: item.recording.audio.fileSizeBytes,
    capture_transport: item.recording.audio.captureTransport,
    source_surface: item.recording.sourceSurface,
    collection_mode: item.recording.collectionMode,
    consent_version: MOBILE_LEGAL_CONSENT_VERSION,
    audio_quality_disposition: item.recording.audio.quality?.disposition,
    audio_quality_reasons: item.recording.audio.quality?.reasons,
    spoken_text: item.recognizedText ?? '',
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return await response.json() as T
}

export async function uploadMobileRecorderQueueItem(
  item: MobileWorkbenchRecorderQueueItem,
  options: MobileWorkbenchClientOptions,
): Promise<MobileWorkbenchUploadReceipt> {
  const authHeaders = await getAuthorizationHeader(options.tokenProvider, item.contributorId)
  const storagePath = buildMobileStoragePath(item)
  const contentType = contentTypeForFormat(item.recording.audio.format)
  const signResponse = await fetchUploadApiWithRetry(
    buildApiUrl(options.apiBaseUrl, '/upload/sign'),
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: storagePath,
        contentType,
      }),
    },
    options.tokenProvider,
    item.contributorId,
  )

  if (!signResponse.ok) {
    throw new Error(`mobile_upload_sign_${signResponse.status}`)
  }

  const signPayload = await parseJsonResponse<UploadSignResponse>(signResponse)
  const audioFile = new File(item.recording.audio.uri)
  if (!audioFile.exists) {
    throw new Error('mobile_upload_audio_missing')
  }

  const putResponse = await fetchUploadStep(signPayload.url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: audioFile,
  })

  if (!putResponse.ok) {
    throw new Error(`mobile_upload_put_${putResponse.status}`)
  }

  const completeResponse = await fetchUploadApiWithRetry(
    buildApiUrl(options.apiBaseUrl, '/upload/complete'),
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioPath: storagePath,
        text: item.text,
        recognizedText: item.recognizedText ?? null,
        sentenceId: item.sentenceId ?? null,
        duration: item.recording.audio.durationSeconds,
        source: 'mobile_workbench_native_recorder',
        metadata: buildUploadMetadata(item, contentType),
      }),
    },
    options.tokenProvider,
    item.contributorId,
  )

  if (!completeResponse.ok) {
    throw new Error(`mobile_upload_complete_${completeResponse.status}`)
  }

  const completePayload =
    await parseJsonResponse<UploadCompleteResponse>(completeResponse)

  return {
    recordingId: completePayload.recordingId ?? item.recordingId,
    contributionId: completePayload.contributionId ?? null,
    manifestPath: completePayload.manifestPath,
    storagePath,
    reusedContribution: completePayload.reusedContribution,
    manifestAlreadySynced: completePayload.manifestAlreadySynced,
    source: 'cloud',
    syncStatus: 'uploaded',
    message: completePayload.manifestAlreadySynced
      ? '这条移动端录音已经写入训练资产，本次重试已安全复用。'
      : '移动端录音已上传并写入训练资产。',
  }
}

export async function discardMobileRecorderQueueItem(
  item: MobileWorkbenchRecorderQueueItem,
  options: MobileWorkbenchClientOptions,
): Promise<void> {
  const authHeaders = await getAuthorizationHeader(options.tokenProvider, item.contributorId)
  const response = await fetch(
    buildApiUrl(options.apiBaseUrl, '/upload/contribution'),
    {
      method: 'DELETE',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contributionId: item.uploadReceipt?.contributionId ?? null,
        audioPath: item.uploadReceipt?.storagePath ?? null,
        recordingId: item.recordingId,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`mobile_upload_discard_${response.status}`)
  }

  const payload = await parseJsonResponse<UploadDiscardResponse>(response)
  if (!payload.success) {
    throw new Error('mobile_upload_discard_failed')
  }
}
