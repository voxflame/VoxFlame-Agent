import assert from 'node:assert/strict'
import test from 'node:test'

import {
  admitCompletedUpload,
  requireCurrentLegalConsent,
  validateUploadSignInput,
} from './upload-admission.service'

const currentConsent = {
  legal_consent: {
    privacy_accepted: true,
    sensitive_data_accepted: true,
    data_collection_accepted: true,
    commercial_use_accepted: true,
    accepted_at: '2026-09-04T01:00:00.000Z',
    version: '2026-09-06',
  },
}

test('upload consent is accepted only from the current trusted auth snapshot', () => {
  assert.deepEqual(requireCurrentLegalConsent(currentConsent), {
    version: '2026-09-06',
    acceptedAt: '2026-09-04T01:00:00.000Z',
  })
  assert.throws(
    () => requireCurrentLegalConsent({ legal_consent: { ...currentConsent.legal_consent, commercial_use_accepted: false } }),
    /current_legal_consent_required/,
  )
  assert.throws(
    () => requireCurrentLegalConsent({ legal_consent: { ...currentConsent.legal_consent, version: 'old' } }),
    /current_legal_consent_required/,
  )
  assert.throws(
    () => requireCurrentLegalConsent({ legal_consent: { ...currentConsent.legal_consent, accepted_at: '' } }),
    /current_legal_consent_required/,
  )
})

test('sign admission binds supported content types to matching file extensions', () => {
  assert.deepEqual(
    validateUploadSignInput('dataset/user/mobile-workbench/rec-1.m4a', 'audio/mp4'),
    {
      filename: 'dataset/user/mobile-workbench/rec-1.m4a',
      contentType: 'audio/mp4',
    },
  )
  assert.throws(
    () => validateUploadSignInput('dataset/user/mobile-workbench/rec-1.wav', 'application/octet-stream'),
    /unsupported_audio_type/,
  )
  assert.throws(
    () => validateUploadSignInput('dataset/user/mobile-workbench/rec-1.exe', 'audio/wav'),
    /unsupported_audio_type/,
  )
})

test('completion admission replaces client file facts with verified OSS facts', () => {
  const admitted = admitCompletedUpload({
    audioPath: 'supervised/mandarin/daily/user/rec-1.wav',
    text: '请带我去地铁站',
    duration: 1.25,
    metadata: {
      recording_id: 'rec-1',
      audio_format: 'audio/wav',
      file_size_bytes: 2048,
      sample_rate: 16_000,
      channel_count: 1,
      duration_ms: 1250,
      consent_version: 'client-controlled-old-value',
    },
  }, {
    contentLength: 2048,
    contentType: 'audio/wav',
    etag: 'etag-1',
  }, requireCurrentLegalConsent(currentConsent), '2026-09-04T02:00:00.000Z')

  assert.equal(admitted.metadata.admission_status, 'admitted')
  assert.equal(admitted.metadata.admission_version, '2026-09-04.1')
  assert.equal(admitted.metadata.consent_version, '2026-09-06')
  assert.equal(admitted.metadata.consent_accepted_at, '2026-09-04T01:00:00.000Z')
  assert.equal(admitted.metadata.file_size_bytes, 2048)
  assert.equal(admitted.metadata.object_etag, 'etag-1')
})

test('completion admission rejects missing objects and conflicting client claims', () => {
  const input = {
    audioPath: 'dataset/user/mobile-workbench/rec-1.m4a',
    text: '你好',
    duration: 1.5,
    metadata: {
      recording_id: 'rec-1',
      audio_format: 'audio/mp4',
      file_size_bytes: 100,
    },
  }
  const consent = requireCurrentLegalConsent(currentConsent)

  assert.throws(() => admitCompletedUpload(input, null, consent), /uploaded_audio_not_found/)
  assert.throws(() => admitCompletedUpload(input, {
    contentLength: 101,
    contentType: 'audio/mp4',
    etag: null,
  }, consent), /audio_size_mismatch/)
  assert.throws(() => admitCompletedUpload({
    ...input,
    metadata: { ...input.metadata, recording_id: 'another-recording' },
  }, {
    contentLength: 100,
    contentType: 'audio/mp4',
    etag: null,
  }, consent), /recording_id_path_mismatch/)
  assert.throws(() => admitCompletedUpload({
    ...input,
    metadata: { ...input.metadata, consent_scope: 'arbitrary_future_use' },
  }, {
    contentLength: 100,
    contentType: 'audio/mp4',
    etag: null,
  }, consent), /invalid_consent_scope/)
})
