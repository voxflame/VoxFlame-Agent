import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldDisableTrainingRecordingControl } from './training-recording-control.ts'

test('background persistence is not a recording control dependency', () => {
  assert.equal(shouldDisableTrainingRecordingControl({
    isProcessing: false,
    isReadingAssistancePlaying: false,
    status: 'idle',
  }), false)
})

test('recording remains blocked only during capture preparation or finalization', () => {
  assert.equal(shouldDisableTrainingRecordingControl({
    isProcessing: true,
    isReadingAssistancePlaying: false,
    status: 'idle',
  }), true)
  assert.equal(shouldDisableTrainingRecordingControl({
    isProcessing: false,
    isReadingAssistancePlaying: true,
    status: 'idle',
  }), true)
  assert.equal(shouldDisableTrainingRecordingControl({
    isProcessing: false,
    isReadingAssistancePlaying: false,
    status: 'connecting',
  }), true)
})
