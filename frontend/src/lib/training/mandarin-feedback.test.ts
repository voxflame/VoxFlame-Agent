import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeMandarinAttempt } from './mandarin-feedback.ts'

const exercise = {
  id: 'user-first-copy',
  text: '请帮我开门',
  category: '日常与出行',
} as const

test('missing reference text does not tell the user that the system failed to hear them', () => {
  const feedback = analyzeMandarinAttempt(exercise, '')

  assert.equal(feedback.status, 'unclear')
  assert.match(feedback.summary, /录音已经保存/)
  assert.match(feedback.pronunciationSummary, /不代表录音里没有声音/)
  assert.doesNotMatch(
    [feedback.summary, feedback.pronunciationSummary, ...feedback.suggestions].join(' '),
    /系统.*听清|建议.*重录|再慢一点说/,
  )
})

test('generated text is framed as a reference instead of a verdict on the speaker', () => {
  const feedback = analyzeMandarinAttempt(exercise, '请帮我开门')

  assert.equal(feedback.status, 'excellent')
  assert.match(feedback.summary, /参考文字/)
  assert.match(feedback.summary, /回听确认/)
})

test('reference-text differences keep the user in control instead of correcting their voice', () => {
  const feedback = analyzeMandarinAttempt(exercise, '请帮我关门')
  const copy = [feedback.summary, feedback.pronunciationSummary, ...feedback.suggestions].join(' ')

  assert.match(copy, /参考文字/)
  assert.match(copy, /回听/)
  assert.doesNotMatch(copy, /嘴巴动作|张口|系统.*听|建议.*重录/)
})
