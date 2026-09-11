import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRtcStartSessionResult as backend } from '../backend/src/contracts/rtc-session.ts'
import { parseRtcStartSessionResult as web } from '../frontend/src/lib/realtime-audio/generated/rtc-session.ts'
import { parseRtcStartSessionResult as mobile } from '../apps/mobile-workbench/src/contracts/generated/rtc-session.ts'

const fixture = () => ({
  requestId: 'test-request', channelName: 'test-room', executionBackend: 'livekit', joinTokenTtlSeconds: 120,
  transport: {
    provider: 'livekit', serverUrl: 'wss://rtc.example.test', roomName: 'test-room',
    participantIdentity: 'test-participant', participantName: 'Test', participantToken: 'test-token',
    participantMetadata: '{}', participantAttributes: {}, agentDispatch: null,
  },
  intent: {
    surface: 'mobile_workbench', mode: 'communication', sessionStrategy: 'heavy_realtime',
    requestedCapabilities: ['transport_send_control'], grantedCapabilities: ['transport_send_control'],
    scene: null, deviceContext: {},
  },
  readiness: {
    canStart: true, requestedStrategy: 'heavy_realtime', resolvedStrategy: 'heavy_realtime',
    recommendedStrategy: 'heavy_realtime', microphoneRequired: false, blockers: [], warnings: [],
    summary: { status: 'ready', label: 'Ready', detail: '', nextAction: '', blockerSummary: null, warningSummary: null },
  },
})

for (const [client, parse] of Object.entries({ backend, web, mobile })) {
  test(`${client}: nullable scene and populated transport survive HTTP serialization`, () => {
    const value = fixture()
    assert.deepEqual(parse(JSON.parse(JSON.stringify(value))), value)
    value.intent.scene = 'medical'
    value.intent.deviceContext = { secureContext: true, microphoneStatus: 'available' }
    value.transport.agentDispatch = { agentName: 'agent' }
    value.transport.participantAttributes = { 'vox.mode': 'communication' }
    assert.deepEqual(parse(value), value)
    assert.equal(Object.hasOwn(parse({ ...value, token: 'obsolete' }), 'token'), false)
  })
  test(`${client}: rejects missing required fields at every response level`, () => {
    for (const path of [[], ['transport'], ['intent'], ['readiness'], ['readiness', 'summary']]) {
      const original = path.reduce((value, key) => value[key], fixture())
      for (const field of Object.keys(original)) {
        const value = fixture()
        const target = path.reduce((current, key) => current[key], value)
        delete target[field]
        assert.throws(() => parse(value), /rtc_session_invalid_response/, [...path, field].join('.'))
      }
    }
  })
  test(`${client}: rejects malformed nested values and invalid credentials without disclosing payload`, () => {
    const mutations = [
      (v) => { v.intent.scene = 'invalid' },
      (v) => { v.intent.surface = 'unknown' },
      (v) => { v.intent.requestedCapabilities = ['admin'] },
      (v) => { v.intent.grantedCapabilities = 'admin' },
      (v) => { v.intent.deviceContext = [] },
      (v) => { v.intent.deviceContext.networkOnline = 'false' },
      (v) => { v.intent.deviceContext.microphoneStatus = 'other' },
      (v) => { v.readiness.summary.blockerSummary = 1 },
      (v) => { v.readiness.blockers = [null] },
      (v) => { v.transport.participantToken = ' ' },
      (v) => { v.transport.participantAttributes = { key: 1 } },
      (v) => { v.transport.agentDispatch = {} },
      (v) => { v.transport.serverUrl = 'https://rtc.example.test' },
      (v) => { v.transport.serverUrl = 'wss://user:secret@rtc.example.test' },
      (v) => { v.channelName = 'wrong-room' },
      ...[0, -1, NaN, Infinity, 1.5, '120'].map((ttl) => (v) => { v.joinTokenTtlSeconds = ttl }),
    ]
    for (const mutate of mutations) {
      const value = fixture()
      mutate(value)
      assert.throws(() => parse(value), { message: 'rtc_session_invalid_response' })
    }
    for (const value of [null, [], '', 42]) assert.throws(() => parse(value), /rtc_session_invalid_response/)
  })
}

// Exercise actual HTTP clients, not just their generated parsers.
test('Web/Mobile HTTP clients validate responses and Mobile enforces its surface', async () => {
  const { startRtcSession } = await import('../frontend/src/lib/realtime-audio/session-bootstrap.ts')
  const { startMobileRtcSession } = await import('../apps/mobile-workbench/src/api/mobile-workbench-client.ts')
  const originalFetch = globalThis.fetch
  const calls = []
  let response = fixture()
  let status = 200
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(response), { status })
  }
  const intent = { ...fixture().intent, scene: undefined }
  const options = { apiBaseUrl: 'https://backend.example.test/api', tokenProvider: { getAccessToken: async () => 'test-auth' } }
  try {
    assert.deepEqual(await startRtcSession('communication', intent, { accessToken: 'test-auth' }), response)
    assert.deepEqual(await startMobileRtcSession(intent, options), response)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(({ url }) => url.endsWith('/rtc/session/start')))
    assert.ok(calls.every(({ init }) => init.headers.Authorization === 'Bearer test-auth'))
    response = { ...fixture(), transport: {} }
    await assert.rejects(startRtcSession('communication', intent, { accessToken: 'test-auth' }), /invalid_response/)
    await assert.rejects(startMobileRtcSession(intent, options), /invalid_response/)
    response = fixture()
    response.intent.surface = 'communication_workspace'
    await assert.rejects(startMobileRtcSession(intent, options), /invalid_surface/)
    status = 503
    await assert.rejects(startRtcSession('communication', intent, { accessToken: 'test-auth' }), /start_503/)
    await assert.rejects(startMobileRtcSession(intent, options), /start_503/)
  } finally { globalThis.fetch = originalFetch }
})
