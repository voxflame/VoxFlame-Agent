import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activeManifestContainsRecording,
  assignSpeakerDisjointSplits,
  assertSpeakerDisjoint,
  evaluateTrainingExportCandidate,
  type TrainingExportContributionRow,
} from './training-dataset-export.service'

const currentUserMetadata = {
  legal_consent: {
    privacy_accepted: true,
    sensitive_data_accepted: true,
    data_collection_accepted: true,
    commercial_use_accepted: true,
    accepted_at: '2026-09-04T01:00:00.000Z',
    version: '2026-09-06',
  },
}

const row: TrainingExportContributionRow = {
  id: 'contribution-1',
  contributor_id: 'account-a',
  audio_path: 'dataset/account-a/mobile-workbench/recording-1.m4a',
  transcript: '请带我去地铁站',
  sentence_id: 'sentence-1',
  duration_seconds: 1.5,
  created_at: '2026-09-04T02:00:00.000Z',
  metadata: {
    recording_id: 'recording-1',
    target_text: '请带我去地铁站',
    duration_ms: 1500,
    audio_format: 'audio/mp4',
    file_size_bytes: 2048,
    object_etag: 'etag-1',
    audio_quality_disposition: 'review',
    consent_scope: 'training_only',
    consent_version: '2026-09-06',
    consent_accepted_at: '2026-09-04T01:00:00.000Z',
    admission_status: 'admitted',
    admission_version: '2026-09-04.1',
    admission_verified_at: '2026-09-04T02:00:00.000Z',
    upload_receipt: {
      recording_id: 'recording-1',
      audio_path: 'dataset/account-a/mobile-workbench/recording-1.m4a',
      manifest_path: 'dataset/account-a/manifest.jsonl',
      manifest_synced: true,
    },
  },
}

const object = {
  contentLength: 2048,
  contentType: 'audio/mp4',
  etag: 'etag-1',
}

test('training export admits only a current, fully verified contribution', () => {
  const result = evaluateTrainingExportCandidate(row, object, currentUserMetadata)
  assert.equal(result.eligible, true)
  if (result.eligible) {
    assert.equal(result.sample.targetText, '请带我去地铁站')
    assert.equal(result.sample.consentScope, 'training_only')
    assert.equal(result.sample.objectEtag, 'etag-1')
  }
})

test('manifest membership requires the recording id and audio path on the same active row', () => {
  assert.equal(activeManifestContainsRecording([
    { recording_id: 'recording-1', audio: { path: 'dataset/account-a/other.m4a' } },
    { recording_id: 'other', audio: { path: row.audio_path } },
  ], 'recording-1', row.audio_path), false)
  assert.equal(activeManifestContainsRecording([
    { recording_id: 'recording-1', audio: { path: row.audio_path } },
  ], 'recording-1', row.audio_path), true)
})

test('training export rejects stale consent, unadmitted rows, changed objects, and unusable quality', () => {
  const result = evaluateTrainingExportCandidate({
    ...row,
    metadata: {
      ...row.metadata,
      admission_status: 'pending',
      consent_scope: 'evaluation_only',
      audio_quality_disposition: 'low_confidence',
    },
  }, {
    ...object,
    contentLength: 4096,
    etag: 'changed-etag',
  }, {
    legal_consent: {
      ...currentUserMetadata.legal_consent,
      commercial_use_accepted: false,
    },
  })

  assert.equal(result.eligible, false)
  if (!result.eligible) {
    assert.deepEqual(new Set(result.reasons), new Set([
      'current_legal_consent_required',
      'not_server_admitted',
      'consent_scope_not_allowed_for_training',
      'audio_quality_not_training_ready',
      'audio_object_size_changed',
      'audio_object_etag_changed',
    ]))
  }
})

test('training export accepts a valid consent snapshot after same-version re-consent but requires a complete artifact receipt', () => {
  const result = evaluateTrainingExportCandidate({
    ...row,
    metadata: {
      ...row.metadata,
      consent_accepted_at: '2026-09-03T01:00:00.000Z',
      upload_receipt: {
        recording_id: 'recording-1',
        manifest_synced: true,
      },
    },
  }, object, currentUserMetadata)

  assert.equal(result.eligible, false)
  if (!result.eligible) {
    assert.deepEqual(result.reasons, ['upload_artifact_not_fully_synced'])
  }
})

test('speaker split assignment is deterministic and keeps every contributor in one split', () => {
  const contributors = Array.from({ length: 20 }, (_, index) => `speaker-${index}`)
  const first = assignSpeakerDisjointSplits(contributors)
  const second = assignSpeakerDisjointSplits([...contributors].reverse())
  assert.deepEqual(first, second)

  const samples = contributors.flatMap((contributorId) => ([
    { contributorId, split: first.get(contributorId)! },
    { contributorId, split: first.get(contributorId)! },
  ]))
  assert.doesNotThrow(() => assertSpeakerDisjoint(samples))
  assert.throws(() => assertSpeakerDisjoint([
    { contributorId: 'speaker-overlap', split: 'train' },
    { contributorId: 'speaker-overlap', split: 'test' },
  ]), /speaker_split_overlap/)
  assert.equal(Array.from(first.values()).filter((split) => split === 'train').length, 16)
  assert.equal(Array.from(first.values()).filter((split) => split === 'validation').length, 2)
  assert.equal(Array.from(first.values()).filter((split) => split === 'test').length, 2)
})
