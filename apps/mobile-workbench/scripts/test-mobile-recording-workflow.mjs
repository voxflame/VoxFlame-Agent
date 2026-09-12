import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/training/mobile-recording-workflow.ts')
const source = await readFile(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'voxflame-mobile-workflow-'))
const outputPath = path.join(outputDirectory, 'mobile-recording-workflow.mjs')
await writeFile(outputPath, transpiled)
const { buildMobileSpeechVariantMetadata, captureStillBelongsToContributor, createMobileSerialExecutor, createMobileUtterancePairId, decideMobileAdvance, reconcileMobileExerciseSelection, shouldOfferMobileDialectPair } = await import(
  `${pathToFileURL(outputPath).href}?v=${Date.now()}`
)

const exercises = [
  { id: 'a', text: '第一句', category: '测试' },
  { id: 'b', text: '第二句', category: '测试' },
]

assert.deepEqual(decideMobileAdvance({ currentIndex: 0, loadedCount: 2, totalCount: 3 }), {
  kind: 'select_loaded',
  index: 1,
})
assert.deepEqual(decideMobileAdvance({ currentIndex: 1, loadedCount: 2, totalCount: 3 }), {
  kind: 'load_more',
  nextIndex: 2,
})
assert.deepEqual(decideMobileAdvance({ currentIndex: 1, loadedCount: 2, totalCount: 2 }), {
  kind: 'complete',
})
assert.deepEqual(reconcileMobileExerciseSelection(exercises, 'b'), {
  exercise: exercises[1],
  index: 1,
})
assert.deepEqual(reconcileMobileExerciseSelection([...exercises, { id: 'c', text: '第三句', category: '测试' }], 'b'), {
  exercise: exercises[1],
  index: 1,
})
assert.equal(captureStillBelongsToContributor({ contributorId: 'account-a' }, 'account-a'), true)
assert.equal(captureStillBelongsToContributor({ contributorId: 'account-a' }, 'account-b'), false)
assert.equal(captureStillBelongsToContributor({ contributorId: 'account-a' }, null), false)

const pairId = createMobileUtterancePairId(1_000, 0.5)
assert.equal(shouldOfferMobileDialectPair({ hasDialect: true, dialectName: '粤语', isAssessment: false }), true)
assert.equal(shouldOfferMobileDialectPair({ hasDialect: true, dialectName: '粤语', isAssessment: true }), false)
assert.deepEqual(buildMobileSpeechVariantMetadata({ speechVariant: 'dialect', utterancePairId: pairId, dialectName: '粤语' }), {
  speech_variant: 'dialect',
  prompt_language: 'zh-CN',
  spoken_language: 'zh-dialect',
  utterance_pair_id: pairId,
  dialect_name: '粤语',
    label_source: 'user_reported',
})

const runSerially = createMobileSerialExecutor()
const executionOrder = []
await Promise.all([
  runSerially(async () => {
    executionOrder.push('first:start')
    await Promise.resolve()
    executionOrder.push('first:end')
  }),
  runSerially(async () => {
    executionOrder.push('second:start')
    executionOrder.push('second:end')
  }),
])
assert.deepEqual(executionOrder, ['first:start', 'first:end', 'second:start', 'second:end'])

const uploadClientSource = await readFile(path.resolve('src/api/mobile-upload-client.ts'), 'utf8')
for (const requiredField of [
  'sample_rate:',
  'channel_count:',
  'duration_ms:',
  'file_size_bytes:',
  'capture_transport:',
  'source_surface:',
  'collection_mode:',
  'consent_version:',
  'audio_quality_disposition:',
  "'speech_variant'",
  "'utterance_pair_id'",
  'fetchUploadApiWithRetry',
  "response.status !== 429 && response.status !== 503",
]) {
  assert.equal(
    uploadClientSource.includes(requiredField),
    true,
    `mobile upload metadata must include ${requiredField}`,
  )
}

const appSource = await readFile(path.resolve('App.tsx'), 'utf8')
assert.match(appSource, /consentReady\s*&&\s*hasCurrentLegalConsent/)

const legalConsentSource = await readFile(path.resolve('src/auth/legal-consent.ts'), 'utf8')
assert.match(legalConsentSource, /hasCurrentMobileLegalConsent/)

console.log('mobile recording workflow tests passed')

const dialectOrigin = { dialectName: '四川话', dialectRegion: '四川成都' }
assert.equal(buildMobileSpeechVariantMetadata({ ...dialectOrigin, speechVariant: 'dialect' }).dialect_region, '四川成都')
assert.equal('dialect_region' in buildMobileSpeechVariantMetadata({ ...dialectOrigin, speechVariant: 'mandarin' }), false)
assert.equal('dialect_name' in buildMobileSpeechVariantMetadata({ ...dialectOrigin, speechVariant: 'mandarin' }), false)
