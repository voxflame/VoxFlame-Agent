import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isCurrentRecordingProgressRequest,
  isRecordingProgressRequestTimedOut,
  mergeRecordingProgress,
} from './useRecordingProgress'
import type { VoxFlameRecorderQueueItem } from '@/lib/recording/recording-contract'

function queueItem(overrides: Partial<VoxFlameRecorderQueueItem>): VoxFlameRecorderQueueItem {
  const createdAt = new Date().toISOString()
  return {
    recordingId: 'recording-1',
    contributorId: 'user-1',
    text: '今天风很轻',
    sentenceId: 'reading-test-segment-01',
    source: 'guided_recording',
    metadata: { reading_segment_id: 'reading-test-segment-01' },
    consentScope: 'training_only',
    syncStatus: 'local_only',
    syncAttempts: 0,
    createdAt,
    recording: {
      recordingId: 'recording-1',
      sessionId: 'session-1',
      mode: 'training',
      sourceSurface: 'web',
      collectionMode: 'supervised',
      createdAt,
      startedAt: createdAt,
      stoppedAt: createdAt,
      audio: {
        blob: new Blob(),
        format: 'audio/wav',
        sampleRate: 16000,
        channelCount: 1,
        durationMs: 30_000,
        durationSeconds: 30,
        fileSizeBytes: 0,
        captureTransport: 'browser_media_recorder',
      },
    },
    ...overrides,
  }
}

test('merge progress keeps confirmed durations separate and de-duplicates sentence ids', () => {
  const result = mergeRecordingProgress({
    recordedSentenceIds: ['reading-test-segment-01'],
    recordedReadingSegmentIds: ['reading-test-segment-01'],
    recordedReadingRoundKeys: ['initial:reading-test-segment-01'],
    readingArticleRoundIds: {},
    lastRecordedExerciseIds: {},
    todayDurationSeconds: 60,
    totalDurationSeconds: 120,
  }, [queueItem({})])

  assert.equal(result.todayDurationSeconds, 60)
  assert.equal(result.totalDurationSeconds, 120)
  assert.equal(result.pendingUploadCount, 1)
  assert.deepEqual(result.recordedSentenceIds, ['reading-test-segment-01'])
  assert.deepEqual(result.recordedReadingSegmentIds, ['reading-test-segment-01'])
  assert.deepEqual(result.recordedReadingRoundKeys, ['initial:reading-test-segment-01'])
})

test('merge progress advances the resume anchor from a local pending recording', () => {
  const result = mergeRecordingProgress({
    recordedSentenceIds: ['daily-1'],
    recordedReadingSegmentIds: [],
    recordedReadingRoundKeys: [],
    readingArticleRoundIds: {},
    lastRecordedExerciseIds: { 'category:日常与出行': 'daily-1' },
    todayDurationSeconds: 0,
    totalDurationSeconds: 0,
  }, [queueItem({
    sentenceId: 'daily-2',
    metadata: { exercise_category: '日常与出行' },
  })])

  assert.equal(result.lastRecordedExerciseIds['category:日常与出行'], 'daily-2')
})

test('recording progress request stops blocking after the bounded timeout', () => {
  assert.equal(isRecordingProgressRequestTimedOut(1_000, 8_999), false)
  assert.equal(isRecordingProgressRequestTimedOut(1_000, 9_000), true)
})

test('recording progress accepts only the current account request generation', () => {
  assert.equal(isCurrentRecordingProgressRequest('user-a', 3, 'user-a', 3), true)
  assert.equal(isCurrentRecordingProgressRequest('user-a', 3, 'user-b', 3), false)
  assert.equal(isCurrentRecordingProgressRequest('user-a', 2, 'user-a', 3), false)
})


test('clearing an overlapping local retry never decreases confirmed duration', () => {
  const cloud = {
    recordedSentenceIds: ['same-sentence'], recordedReadingSegmentIds: [],
    recordedReadingRoundKeys: [], readingArticleRoundIds: {}, lastRecordedExerciseIds: {},
    todayDurationSeconds: 30, totalDurationSeconds: 30,
  }
  const before = mergeRecordingProgress(cloud, [queueItem({}), queueItem({})])
  const after = mergeRecordingProgress(cloud, [])
  assert.equal(before.pendingUploadCount, 1)
  assert.equal(after.pendingUploadCount, 0)
  assert.equal(before.totalDurationSeconds, 30)
  assert.equal(after.totalDurationSeconds, before.totalDurationSeconds)
  assert.equal(after.todayDurationSeconds, before.todayDurationSeconds)
})

test('two fresh captures of the same sentence are two pending recordings, not retries', () => {
  const cloud = {
    recordedSentenceIds: [], recordedReadingSegmentIds: [], recordedReadingRoundKeys: [],
    readingArticleRoundIds: {}, lastRecordedExerciseIds: {},
    todayDurationSeconds: 0, totalDurationSeconds: 0,
  }
  const result = mergeRecordingProgress(cloud, [queueItem({}), queueItem({ recordingId: 'recording-2' })])
  assert.equal(result.pendingUploadCount, 2)
  assert.equal(result.totalDurationSeconds, 0)
  assert.equal(result.recordedSentenceIds.length, 1)
})
