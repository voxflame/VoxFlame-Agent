import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionTransportEventHandlers } from './session-effects.ts'
import { createInitialRtcAgentState } from './session-state.ts'

test('released or superseded room callbacks cannot overwrite current session state', () => {
  let current = true
  let state = { ...createInitialRtcAgentState(), isConnected: true, isRecording: true }
  const events = createSessionTransportEventHandlers((update) => {
    state = typeof update === 'function' ? update(state) : update
  }, () => current)
  events.onRemoteAudioStart()
  assert.equal(state.isSpeaking, true)
  current = false
  const before = state
  events.onRemoteAudioStop()
  events.onRtcDisconnected()
  events.onRtmStatus({ newState: 'DISCONNECTED' })
  assert.equal(state, before)
  current = true
  events.onRemoteAudioStop()
  events.onRtmStatus({ newState: 'DISCONNECTED' })
  events.onRtcDisconnected()
  assert.equal(state.isConnected, false)
  assert.equal(state.isRecording, false)
  assert.equal(state.isSpeaking, false)
  assert.match(state.error ?? '', /连接已断开/)
})
