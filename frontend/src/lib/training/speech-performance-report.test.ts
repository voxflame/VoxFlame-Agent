import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSpeechPerformanceReport } from './speech-performance-report'

test('buildSpeechPerformanceReport combines recognition, acoustic and personalization signals', () => {
  const report = buildSpeechPerformanceReport([
    {
      exerciseId: '1',
      targetText: '爸爸',
      heardText: '妈妈',
      normalizedTarget: '爸爸',
      normalizedHeard: '妈妈',
      missingChars: ['爸', '爸'],
      extraChars: ['妈', '妈'],
      durationMs: 2_000,
      speechDurationMs: 1_200,
      silenceRatio: 0.4,
      inputLevelRms: 0.02,
      inputLevelPeak: 0.1,
      qualityDisposition: 'review',
    },
    {
      exerciseId: '2',
      targetText: '开门',
      heardText: '开门',
      normalizedTarget: '开门',
      normalizedHeard: '开门',
      missingChars: [],
      extraChars: [],
      durationMs: 2_000,
      speechDurationMs: 1_000,
      silenceRatio: 0.5,
      inputLevelRms: 0.04,
      inputLevelPeak: 0.12,
      qualityDisposition: 'high_confidence',
    },
  ])

  assert.equal(report.referenceTextAgreementPercent, 50)
  assert.equal(report.personalizationSeconds, 4)
  assert.equal(report.captureLabel, '收音可优化')
  assert.ok(report.patterns.some((pattern) => pattern.label === '双唇与唇齿音'))
  assert.match(report.boundary, /不诊断疾病/)
  assert.match(report.boundary, /参考文字可能有误/)
  assert.doesNotMatch(JSON.stringify(report), /系统听清率|系统本轮如何听到/)
})
