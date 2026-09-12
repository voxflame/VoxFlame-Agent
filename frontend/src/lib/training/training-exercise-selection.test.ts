import assert from 'node:assert/strict'
import test from 'node:test'

import { selectTrainingExercises } from '@/lib/training/training-exercise-selection'

const EXERCISES = [
  { id: 'a', text: '第一句' },
  { id: 'b', text: '第二句' },
  { id: 'c', text: '第三句' },
]

test('selectTrainingExercises prefers sentences the user has not recorded yet', () => {
  const result = selectTrainingExercises({
    exercises: EXERCISES,
    recordedExerciseIds: ['a'],
    sessionExerciseIds: ['b'],
  })

  assert.equal(result.stage, 'unrecorded')
  assert.equal(result.unrecordedCount, 1)
  assert.deepEqual(result.exercises.map((exercise) => exercise.id), ['c'])
})

test('selectTrainingExercises avoids repeats in the current round after everything has been recorded', () => {
  const result = selectTrainingExercises({
    exercises: EXERCISES,
    recordedExerciseIds: ['a', 'b', 'c'],
    sessionExerciseIds: ['a'],
  })

  assert.equal(result.stage, 'unrepeated')
  assert.equal(result.unrecordedCount, 0)
  assert.equal(result.unrepeatedCount, 2)
  assert.deepEqual(result.exercises.map((exercise) => exercise.id), ['b', 'c'])
})

test('selectTrainingExercises falls back to the full set only after the whole round is exhausted', () => {
  const result = selectTrainingExercises({
    exercises: EXERCISES,
    recordedExerciseIds: ['a', 'b', 'c'],
    sessionExerciseIds: ['a', 'b', 'c'],
  })

  assert.equal(result.stage, 'revisit')
  assert.deepEqual(result.exercises.map((exercise) => exercise.id), ['a', 'b', 'c'])
})

test('selectTrainingExercises resumes after the last cloud-backed exercise instead of restarting', () => {
  const result = selectTrainingExercises({
    exercises: EXERCISES,
    recordedExerciseIds: ['a', 'b', 'c'],
    resumeAfterExerciseId: 'b',
  })

  assert.equal(result.stage, 'unrepeated')
  assert.deepEqual(result.exercises.map((exercise) => exercise.id), ['c', 'a', 'b'])
})

test('selectTrainingExercises finds the next unrecorded exercise after the resume anchor', () => {
  const result = selectTrainingExercises({
    exercises: EXERCISES,
    recordedExerciseIds: ['a'],
    resumeAfterExerciseId: 'c',
  })

  assert.equal(result.stage, 'unrecorded')
  assert.deepEqual(result.exercises.map((exercise) => exercise.id), ['b', 'c'])
})
