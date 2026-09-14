import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeArticulationBaseline } from './articulation-baseline-report'

test('summarizeArticulationBaseline reports reference-text agreement without severity bands', () => {
  const summary = summarizeArticulationBaseline([
    {
      exerciseId: 'mandarin_articulation_baseline_001',
      targetText: '包',
      heardText: '包',
      normalizedTarget: '包',
      normalizedHeard: '包',
    },
    {
      exerciseId: 'mandarin_articulation_baseline_002',
      targetText: '抛',
      heardText: '包',
      normalizedTarget: '抛',
      normalizedHeard: '包',
    },
  ], 2)

  assert.equal(summary.completedCount, 2)
  assert.equal(summary.referenceTextAgreementRatio, 0.5)
  assert.equal(summary.status, 'complete')
  assert.equal(summary.statusLabel, '基线已完成')
  assert.equal(summary.reviewItems[0]?.targetText, '抛')
  assert.equal('severityBand' in summary, false)
  assert.equal('severityLabel' in summary, false)
  assert.doesNotMatch(JSON.stringify(summary), /支持需求/)
  assert.doesNotMatch(summary.statusSummary, /系统听懂|听清率/)
})

test('summarizeArticulationBaseline keeps an incomplete run descriptive', () => {
  const summary = summarizeArticulationBaseline([
    {
      exerciseId: 'mandarin_articulation_baseline_001',
      targetText: '包',
      heardText: '',
      normalizedTarget: '包',
      normalizedHeard: '',
    },
  ], 50)

  assert.equal(summary.remainingCount, 49)
  assert.equal(summary.isComplete, false)
  assert.equal(summary.status, 'in_progress')
  assert.match(summary.statusSummary, /1\/50/)
})
