type JsonRecord = Record<string, unknown>

export type ServerQualityStatus = 'ready' | 'pending_review'

export interface ServerQualityAssessment {
  quality_status: ServerQualityStatus
  quality_reasons: string[]
  quality_assessment_version: string
  quality_assessed_at: string
  training_import_allowed: false
}

const QUALITY_ASSESSMENT_VERSION = '2026-09-04.1'

function finiteNumber(metadata: JsonRecord, key: string): number | null {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(metadata: JsonRecord, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Flag only objective capture problems. ASR alignment and articulation style
 * are deliberately excluded because they cannot establish unusable audio.
 */
export function assessServerRecordingQuality(
  metadata: JsonRecord,
  durationSeconds: number,
  assessedAt: string = new Date().toISOString(),
): ServerQualityAssessment {
  const reasons = new Set<string>()
  const durationMs = finiteNumber(metadata, 'duration_ms') ?? durationSeconds * 1000
  const speechDurationMs = finiteNumber(metadata, 'speech_duration_ms')
  const silenceRatio = finiteNumber(metadata, 'silence_ratio')
  const inputLevelRms = finiteNumber(metadata, 'input_level_rms')
  const inputLevelPeak = finiteNumber(metadata, 'input_level_peak')
  const clientDisposition = stringValue(metadata, 'audio_quality_disposition')

  if (durationMs < 700) reasons.add('capture_too_short')
  if (speechDurationMs !== null && speechDurationMs < 250) reasons.add('speech_too_short')
  if (silenceRatio !== null && silenceRatio >= 0.88) reasons.add('excessive_silence')
  if (inputLevelRms !== null && inputLevelRms < 0.003) reasons.add('input_level_too_low')
  if (inputLevelPeak !== null && inputLevelPeak >= 0.995) reasons.add('input_clipping_risk')
  if (clientDisposition === 'low_confidence') reasons.add('client_capture_low_confidence')

  return {
    quality_status: reasons.size > 0 ? 'pending_review' : 'ready',
    quality_reasons: [...reasons],
    quality_assessment_version: QUALITY_ASSESSMENT_VERSION,
    quality_assessed_at: assessedAt,
    training_import_allowed: false,
  }
}
