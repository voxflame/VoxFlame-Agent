import assert from 'node:assert/strict'
import test from 'node:test'

import type { VoxFlameRecorderQueueItem } from './recording-contract'
import {
  selectRecorderQueueItemsForAccount,
  selectRecorderQueueItemsForSync,
} from './recorder-sync-policy'

function queueItem(overrides: Partial<VoxFlameRecorderQueueItem>): VoxFlameRecorderQueueItem {
  return {
    recordingId: 'recording-1',
    contributorId: 'account-a',
    text: '测试句子',
    metadata: {},
    consentScope: 'training_only',
    syncStatus: 'local_only',
    syncAttempts: 0,
    createdAt: '2026-08-28T10:00:00.000Z',
    recording: {
      recordingId: 'recording-1',
      sessionId: 'session-1',
      mode: 'training',
      sourceSurface: 'web',
      collectionMode: 'supervised',
      createdAt: '2026-08-28T10:00:00.000Z',
      startedAt: '2026-08-28T10:00:00.000Z',
      stoppedAt: '2026-08-28T10:00:01.000Z',
      audio: {
        blob: new Blob(),
        format: 'audio/wav',
        sampleRate: 16_000,
        channelCount: 1,
        durationMs: 1_000,
        durationSeconds: 1,
        fileSizeBytes: 44,
        captureTransport: 'browser_media_recorder',
      },
    },
    ...overrides,
  }
}

test('background sync never uploads another account queue', () => {
  const selected = selectRecorderQueueItemsForSync([
    queueItem({ recordingId: 'a', contributorId: 'account-a' }),
    queueItem({ recordingId: 'b', contributorId: 'account-b' }),
  ], 'account-a')

  assert.deepEqual(selected.map((item) => item.recordingId), ['a'])
})

test('local progress exposes only the active account queue and survives sign-out', () => {
  const items = [
    queueItem({ recordingId: 'a', contributorId: 'account-a' }),
    queueItem({ recordingId: 'b', contributorId: 'account-b' }),
  ]

  assert.deepEqual(
    selectRecorderQueueItemsForAccount(items, 'account-a').map((item) => item.recordingId),
    ['a'],
  )
  assert.deepEqual(selectRecorderQueueItemsForAccount(items, null), [])
  assert.equal(items.length, 2)
})

test('background sync applies exponential cooldown while explicit sync can force a retry', () => {
  const item = queueItem({
    syncAttempts: 3,
    lastAttemptAt: '2026-08-28T10:00:00.000Z',
  })

  assert.equal(
    selectRecorderQueueItemsForSync([item], 'account-a', Date.parse('2026-08-28T10:01:59.000Z')).length,
    0,
  )
  assert.equal(
    selectRecorderQueueItemsForSync([item], 'account-a', Date.parse('2026-08-28T10:02:00.000Z')).length,
    1,
  )
  assert.equal(
    selectRecorderQueueItemsForSync([item], 'account-a', Date.parse('2026-08-28T10:00:01.000Z'), true).length,
    1,
  )
})
