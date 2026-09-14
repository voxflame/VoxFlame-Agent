import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeMandarinAttempt } from './mandarin-feedback.ts'
import { assessTrainingSampleQuality } from './training-sample-quality.ts'

const exercise = {
  id: 'pending-reference-text',
  text: '请帮我开门',
  category: '日常与出行',
} as const

test('pending reference text does not downgrade a saved recording as unclear', () => {
  const feedback = analyzeMandarinAttempt(exercise, '')
  const result = assessTrainingSampleQuality({
    feedback,
    recording: {
      recordingId: 'recording-1',
      sessionId: 'session-1',
      mode: 'training',
      sourceSurface: 'web',
      collectionMode: 'supervised',
      createdAt: '2026-09-14T00:00:00.000Z',
      startedAt: '2026-09-14T00:00:00.000Z',
      stoppedAt: '2026-09-14T00:00:02.000Z',
      audio: {
        blob: new Blob(['audio'], { type: 'audio/wav' }),
        format: 'audio/wav',
        sampleRate: 16_000,
        channelCount: 1,
        durationMs: 2_000,
        durationSeconds: 2,
        fileSizeBytes: 5,
        captureTransport: 'local_pcm_stream',
        quality: {
          durationMs: 2_000,
          speechDurationMs: 1_500,
          silenceRatio: 0.25,
          inputLevelRms: 0.04,
          inputLevelPeak: 0.3,
          disposition: 'high_confidence',
          reasons: [],
        },
      },
    },
    transcriptLatencyMs: 0,
    referenceTextStatus: 'pending',
  })

  assert.ok(result.score >= 60)
  assert.match(result.reasons.join(' '), /不用文字覆盖度评价录音/)
  assert.doesNotMatch(result.reasons.join(' '), /关键词偏少/)
})
