import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseActiveRecordingManifestJsonl,
  resolveActiveRecordingManifestRows,
} from '../src/lib/corpus/recording-manifest-events.mjs'

test('discard event removes only the matching recording', () => {
  assert.deepEqual(resolveActiveRecordingManifestRows([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { recording_id: 'rec-2', audio: { path: 'dataset/u/rec-2.wav' } },
    { event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
  ]), [
    { recording_id: 'rec-2', audio: { path: 'dataset/u/rec-2.wav' } },
  ])
})

test('discard event is terminal even when a delayed duplicate row follows it', () => {
  assert.deepEqual(resolveActiveRecordingManifestRows([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
  ]), [])
})

test('a tombstone from a newer manifest snapshot hides an older snapshot row', () => {
  assert.deepEqual(resolveActiveRecordingManifestRows([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' }, snapshot: 'old' },
    { event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' }, snapshot: 'new' },
  ]), [])
})

test('strict parser reports the manifest source and broken line', () => {
  assert.throws(
    () => parseActiveRecordingManifestJsonl('{"recording_id":"rec-1"}\nnot-json\n', 'fixture.jsonl'),
    /fixture\.jsonl:2/,
  )
})
