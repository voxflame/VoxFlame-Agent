import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isRepetitiveTranscriptNoise,
  mergeCaptureBoundResult,
  pickPreferredTrainingTranscriptCandidate,
} from './final-transcript.ts'

test('training transcript selection prefers final transcript over longer interim noise', () => {
  const selected = pickPreferredTrainingTranscriptCandidate({
    baseline: '',
    latestFinal: '请把地址发给我。',
    latestInterim: '请把地址发给我。大家好，这条线连着那一条线路。',
    bestObserved: '请把地址发给我。大家好，这条线连着那一条线路。',
  })

  assert.equal(selected, '请把地址发给我。')
})

test('training transcript selection falls back to the best observed interim when final is missing', () => {
  const selected = pickPreferredTrainingTranscriptCandidate({
    baseline: '',
    latestFinal: '',
    latestInterim: '请把地',
    bestObserved: '请把地址发给我。',
  })

  assert.equal(selected, '请把地址发给我。')
})

test('training transcript selection ignores unchanged baseline finals', () => {
  const selected = pickPreferredTrainingTranscriptCandidate({
    baseline: '上一次的句子',
    latestFinal: '上一次的句子',
    latestInterim: '',
    bestObserved: '',
  })

  assert.equal(selected, '')
})

test('training transcript selection drops repeated-character noise tails', () => {
  const selected = pickPreferredTrainingTranscriptCandidate({
    baseline: '',
    latestFinal: '我我我我我我我我我我我我我我我我我我我我',
    latestInterim: '我我我我我我我我我我我我我我我我我我我我',
    bestObserved: '我我我我我我我我我我我我我我我我我我我我',
  })

  assert.equal(selected, '')
})

test('repetitive transcript noise keeps normal short repetitions', () => {
  assert.equal(isRepetitiveTranscriptNoise('我想我想喝水。'), false)
  assert.equal(isRepetitiveTranscriptNoise('我我我我我我我我我我我我我我我我'), true)
})

test('a late transcript only updates the attempt with the same capture id', () => {
  const currentAttempt = {
    clientCaptureId: 'capture-2',
    transcript: '第二句',
  }
  const lateFirstAttempt = {
    clientCaptureId: 'capture-1',
    transcript: '第一句最终结果',
  }

  assert.equal(
    mergeCaptureBoundResult(currentAttempt, lateFirstAttempt),
    currentAttempt,
  )
  assert.deepEqual(
    mergeCaptureBoundResult(currentAttempt, {
      clientCaptureId: 'capture-2',
      transcript: '第二句最终结果',
    }),
    {
      clientCaptureId: 'capture-2',
      transcript: '第二句最终结果',
    },
  )
})
