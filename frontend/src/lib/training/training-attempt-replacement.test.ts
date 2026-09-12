import assert from 'node:assert/strict'
import test from 'node:test'

import { planTrainingAttemptReplacement } from '@/lib/training/training-attempt-replacement'

test('retry waits for an in-flight save so the uploaded sample can be withdrawn', () => {
  assert.equal(
    planTrainingAttemptReplacement('saving', true),
    'wait_for_save_then_discard',
  )
})

test('retry withdraws an existing local or uploaded sample before starting again', () => {
  assert.equal(planTrainingAttemptReplacement('uploaded', true), 'discard_then_start')
  assert.equal(planTrainingAttemptReplacement('local_only', true), 'discard_then_start')
  assert.equal(planTrainingAttemptReplacement('failed', true), 'discard_then_start')
})

test('retry can start immediately when there is no retained recording to replace', () => {
  assert.equal(planTrainingAttemptReplacement('idle', false), 'start_without_discard')
  assert.equal(planTrainingAttemptReplacement('discarded', true), 'start_without_discard')
})

test('retry does not start a second discard while withdrawal is already running', () => {
  assert.equal(planTrainingAttemptReplacement('discarding', true), 'wait_for_discard')
})
