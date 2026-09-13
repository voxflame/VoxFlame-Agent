import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getExercisesByCategory } from '@/lib/corpus/mandarin-training'
import {
  PHONOLOGY_GROUPS,
  DEFAULT_PHONOLOGY_GROUP_ID,
  filterExercisesByPhonologyGroup,
  getPhonologyExerciseTargets,
  getPhonologyFocusForGroup,
} from './phonology-groups'

test('targeted phonology recording opens on the machine-checked core gap group', () => {
  assert.equal(DEFAULT_PHONOLOGY_GROUP_ID, 'coverage-core')
})


test('phonology groups expose approved gaps, open research supplements, low-frequency reinforcement, eight specific subgroups, and the full pool', () => {
  assert.equal(PHONOLOGY_GROUPS.length, 14)
  assert.equal(PHONOLOGY_GROUPS[0].id, 'coverage-core')
  assert.equal(PHONOLOGY_GROUPS[1].id, 'coverage-open-research')
  assert.equal(PHONOLOGY_GROUPS[2].id, 'coverage-reinforcement')
  assert.equal(PHONOLOGY_GROUPS[5].id, 'all')
  assert.deepEqual(
    PHONOLOGY_GROUPS.slice(6).map((group) => group.id),
    [
      'labial',
      'tongue-tip-mid',
      'velar',
      'palatal',
      'sibilants',
      'nasal-finals',
      'compound-finals',
      'tones',
    ],
  )
})

test('each specific phonology group filters exercises by an actual indexed target', () => {
  const exercises = getExercisesByCategory('音系强化')

  for (const group of PHONOLOGY_GROUPS.slice(6)) {
    const filtered = filterExercisesByPhonologyGroup(exercises, group.id)
    assert.ok(filtered.length >= 100, `${group.label} should contain a substantial practice pool`)
    for (const exercise of filtered.slice(0, 100)) {
      assert.equal(
        getPhonologyExerciseTargets(exercise.id).some((target) => target.id === group.id),
        true,
        `${exercise.text} should carry ${group.label}`,
      )
      assert.ok(getPhonologyFocusForGroup(exercise.id, group.id))
    }
  }
})

test('core coverage group exposes recording-ready core gap prompts', () => {
  const exercises = getExercisesByCategory('音系强化')
  const filtered = filterExercisesByPhonologyGroup(exercises, 'coverage-core')
  assert.equal(filtered.length, 263)
  assert.equal(filtered.every((exercise) => (
    exercise.id.startsWith('coverage-recording-gap-') || exercise.id.startsWith('coverage-gap-')
  )), true)
})

test('reinforcement group exposes only active prompts selected by the low-frequency plan', () => {
  const exercises = getExercisesByCategory('all')
  const filtered = filterExercisesByPhonologyGroup(exercises, 'coverage-reinforcement')
  assert.ok(filtered.length >= 800)
  assert.equal(filtered.every((exercise) => getPhonologyFocusForGroup(exercise.id, 'coverage-reinforcement')), true)
})

test('open research group exposes all fourteen additive recording-ready prompts', () => {
  const exercises = getExercisesByCategory('音系强化')
  const filtered = filterExercisesByPhonologyGroup(exercises, 'coverage-open-research')
  assert.equal(filtered.length, 14)
  assert.equal(filtered.every((exercise) => getPhonologyFocusForGroup(exercise.id, 'coverage-open-research') === '开放研究补充（录音就绪）'), true)
})

test('the all group preserves the full phonology exercise pool', () => {
  const exercises = getExercisesByCategory('音系强化')
  assert.equal(filterExercisesByPhonologyGroup(exercises, 'all'), exercises)
})
