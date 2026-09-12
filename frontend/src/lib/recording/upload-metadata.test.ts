import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeTrainingUploadMetadata } from './upload-metadata'

test('training upload metadata keeps useful labels and drops device/user details', () => {
  assert.deepEqual(
    sanitizeTrainingUploadMetadata({
      target_text: '你好',
      spoken_text: '泥好',
      severity: 'mild',
      disability_category: '言语残疾',
      condition: '言语残疾',
      etiology: 'stroke',
      speech_variant: 'dialect',
      dialect_name: '粤语',
      utterance_pair_id: 'pair-1',
      age_band: '60–69',
      sex: 'female',
      recording_id: 'rec-1',
      user_agent: 'browser-secret-details',
      microphone_label: 'USB microphone',
      audio_quality_reasons: ['kept for transport only'],
      pronunciation_targets: ['zang4'],
      reading_assistance_used: true,
    }),
    {
      target_text: '你好',
      spoken_text: '泥好',
      severity: 'mild',
      disability_category: '言语残疾',
      condition: '言语残疾',
      etiology: 'stroke',
      speech_variant: 'dialect',
      dialect_name: '粤语',
      utterance_pair_id: 'pair-1',
      age_band: '60–69',
      sex: 'female',
      pronunciation_targets: ['zang4'],
      reading_assistance_used: true,
    },
  )
})

test('training upload metadata keeps reading lineage but not the full article', () => {
  assert.deepEqual(
    sanitizeTrainingUploadMetadata({
      reading_material_kind: 'public_domain_classic',
      reading_article_id: 'luxun-test',
      reading_article_version: '2026-09-03-test',
      reading_segment_id: 'luxun-test-segment-0001',
      reading_segment_index: 0,
      reading_segment_count: 10,
      reading_round_id: 'round-1',
      reading_article_body: '这段正文不应重复上传',
    }),
    {
      reading_material_kind: 'public_domain_classic',
      reading_article_id: 'luxun-test',
      reading_article_version: '2026-09-03-test',
      reading_segment_id: 'luxun-test-segment-0001',
      reading_segment_index: 0,
      reading_segment_count: 10,
      reading_round_id: 'round-1',
    },
  )
})

test('recording dialect origin survives upload while residence and background stay private', () => {
  assert.deepEqual(sanitizeTrainingUploadMetadata({
    dialect_name: '四川话', dialect_region: '四川成都', province: '广东', city: '深圳',
    dialect_profiles: [{ name: '粤语', region: '广东广州' }],
  }), { dialect_name: '四川话', dialect_region: '四川成都' })
})
