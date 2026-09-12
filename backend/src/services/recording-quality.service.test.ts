import assert from 'node:assert/strict'
import test from 'node:test'

import { assessServerRecordingQuality } from './recording-quality.service'

test('objective capture failures enter review without consulting ASR alignment', () => {
  assert.deepEqual(assessServerRecordingQuality({
    duration_ms: 400,
    silence_ratio: 0.92,
    alignment_score: 0.99,
  }, 0.4, '2026-09-04T00:00:00.000Z'), {
    quality_status: 'pending_review',
    quality_reasons: ['capture_too_short', 'excessive_silence'],
    quality_assessment_version: '2026-09-04.1',
    quality_assessed_at: '2026-09-04T00:00:00.000Z',
    training_import_allowed: false,
  })
})

test('ASR mismatch alone never makes an otherwise usable capture low quality', () => {
  const result = assessServerRecordingQuality({
    duration_ms: 2200,
    speech_duration_ms: 1700,
    silence_ratio: 0.18,
    input_level_rms: 0.04,
    input_level_peak: 0.4,
    alignment_score: 0.05,
  }, 2.2, '2026-09-04T00:00:00.000Z')

  assert.equal(result.quality_status, 'ready')
  assert.deepEqual(result.quality_reasons, [])
  assert.equal(result.training_import_allowed, false)
})
