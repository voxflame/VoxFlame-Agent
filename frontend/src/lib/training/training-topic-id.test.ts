import assert from 'node:assert/strict'
import test from 'node:test'

import { isTrainingTopicId } from './training-topic-id.ts'

test('accepts only active training topic ids', () => {
  assert.equal(isTrainingTopicId('articulation-baseline'), true)
  assert.equal(isTrainingTopicId('daily-mobility'), true)
  assert.equal(isTrainingTopicId('unknown-topic'), false)
})
