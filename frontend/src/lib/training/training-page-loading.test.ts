import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldBlockTrainingPageForProgress } from './training-page-loading'

test('ordinary training stays visible while account progress refreshes', () => {
  assert.equal(shouldBlockTrainingPageForProgress(false, true), false)
})

test('long-form reading waits for the account round on initial load', () => {
  assert.equal(shouldBlockTrainingPageForProgress(true, true), true)
  assert.equal(shouldBlockTrainingPageForProgress(true, false), false)
})
