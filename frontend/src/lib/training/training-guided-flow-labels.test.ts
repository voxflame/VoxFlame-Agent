import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(
  new URL('../../app/contribute/page.tsx', import.meta.url),
  'utf8',
)

const guidedFlowStart = pageSource.indexOf('if (usesGuidedCollectionFlow(isAssessmentTopic))')
const guidedFlowEnd = pageSource.indexOf('\n  return (\n    <div className="min-h-dvh bg-stone-50">', guidedFlowStart)
const guidedFlowSource = pageSource.slice(guidedFlowStart, guidedFlowEnd)

test('guided collection keeps one task hierarchy instead of repeating progress labels', () => {
  assert.ok(guidedFlowStart >= 0)
  assert.ok(guidedFlowEnd > guidedFlowStart)

  for (const redundantLabel of [
    '数据录入进度',
    '第 1 步',
    '第 2 步',
    '这个账号的句子记录',
    '本次任务',
    '录音成功',
  ]) {
    assert.doesNotMatch(guidedFlowSource, new RegExp(redundantLabel))
  }

  assert.match(guidedFlowSource, /准备好后再开始/)
  assert.match(guidedFlowSource, /读出这一句/)
  assert.match(guidedFlowSource, /这条不收录/)
})
