import assert from 'node:assert/strict'
import test from 'node:test'

import { getNextExerciseAfterAcceptedRecording } from './training-attempt-navigation'

const EXERCISES = [
  { id: 'a', text: '第一句' },
  { id: 'b', text: '第二句' },
  { id: 'c', text: '第三句' },
]

test('an accepted recording advances without consulting ASR alignment quality', () => {
  const next = getNextExerciseAfterAcceptedRecording({
    accepted: true,
    currentExerciseId: 'a',
    activeExercises: EXERCISES,
  })

  assert.equal(next?.id, 'b')
})

test('an incomplete recording keeps the current exercise available for retry', () => {
  const next = getNextExerciseAfterAcceptedRecording({
    accepted: false,
    currentExerciseId: 'a',
    activeExercises: EXERCISES,
  })

  assert.equal(next, null)
})

test('the cursor uses stable topic order when the active round has one item left', () => {
  const next = getNextExerciseAfterAcceptedRecording({
    accepted: true,
    currentExerciseId: 'c',
    activeExercises: [EXERCISES[2]],
    fallbackExercises: EXERCISES,
  })

  assert.equal(next?.id, 'a')
})
