import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSpeechVariantMetadata,
  createUtterancePairId,
  shouldOfferDialectPair,
} from './dialect-collection'

test('dialect pairing is offered only to a named dialect profile outside assessment', () => {
  assert.equal(shouldOfferDialectPair({ hasDialect: true, dialectName: '粤语', isAssessment: false }), true)
  assert.equal(shouldOfferDialectPair({ hasDialect: true, dialectName: '', isAssessment: false }), false)
  assert.equal(shouldOfferDialectPair({ hasDialect: true, dialectName: '粤语', isAssessment: true }), false)
})

test('paired variants keep the same lineage while declaring their spoken form', () => {
  const pairId = createUtterancePairId(1_000, 0.5)
  assert.deepEqual(buildSpeechVariantMetadata({
    speechVariant: 'mandarin',
    utterancePairId: pairId,
    dialectName: '粤语',
  }), {
    speech_variant: 'mandarin',
    prompt_language: 'zh-CN',
    spoken_language: 'zh-CN',
    utterance_pair_id: pairId,
  })
  assert.deepEqual(buildSpeechVariantMetadata({
    speechVariant: 'dialect',
    utterancePairId: pairId,
    dialectName: '粤语',
  }), {
    speech_variant: 'dialect',
    prompt_language: 'zh-CN',
    spoken_language: 'zh-dialect',
    utterance_pair_id: pairId,
    dialect_name: '粤语',
    label_source: 'user_reported',
  })
})

test('origin belongs to the dialect recording only, never a Mandarin label', () => {
  const options = { dialectName: '四川话', dialectRegion: '四川成都' }
  const mandarin = buildSpeechVariantMetadata({ ...options, speechVariant: 'mandarin' })
  assert.equal('dialect_name' in mandarin, false)
  assert.equal('dialect_region' in mandarin, false)
  assert.equal('label_source' in mandarin, false)
  const dialect = buildSpeechVariantMetadata({ ...options, speechVariant: 'dialect' })
  assert.equal(dialect.dialect_region, '四川成都')
  assert.equal(dialect.label_source, 'user_reported')
})

test('capture labels survive background completion and replacements in both clients', async () => {
  const { readFileSync } = await import('node:fs')
  const web = readFileSync('src/app/contribute/page.tsx', 'utf8')
  assert.match(web, /const dialect = recordingDialectRef.current/)
  assert.match(web, /dialectName: attemptToPersist.dialect\?\.name/)
  assert.match(web, /recordingDialectRef.current = targetToRetry.dialect/)
  assert.doesNotMatch(web, /metadata\.dialect_name_user_reported\s*=/)
  const mobile = readFileSync('../apps/mobile-workbench/App.tsx', 'utf8')
  assert.match(mobile, /dialectName: captureSnapshot.dialect\?\.name/)
  assert.match(mobile, /dialectName: capture.dialect\?\.name/)
  assert.doesNotMatch(mobile, /dialect_name_user_reported:/)
})
