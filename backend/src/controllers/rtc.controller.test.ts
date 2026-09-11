import assert from 'node:assert/strict'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { TokenVerifier } from 'livekit-server-sdk'
import { parseRtcStartSessionResult } from '../contracts/rtc-session'

async function run(): Promise<void> {
  // Only local JWT signing and loopback HTTP; never load credentials or call providers.
  delete process.env.SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_ANON_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.NODE_ENV = 'test'
  process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880'
  process.env.LIVEKIT_BROWSER_URL = 'wss://rtc.example.test'
  process.env.LIVEKIT_API_KEY = 'test-key'
  process.env.LIVEKIT_API_SECRET = 'test-secret'
  process.env.LIVEKIT_AGENT_NAME = 'test-agent'
  process.env.RTC_ENABLE_LIVEKIT_EXPERIMENT = '1'
  // Stub the auth dependency, not the controller: this tests routing, not Supabase Auth.
  const auth = require('../middlewares/auth.middleware') as typeof import('../middlewares/auth.middleware')
  let skipIdentity = false
  const originalAuth = auth.authMiddleware
  auth.authMiddleware = async (req, res, next) => {
    if (req.headers.authorization !== 'Bearer test-auth') {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!skipIdentity) req.user = { id: 'trusted-user', email: '', userMetadata: {} }
    next()
  }
  const router = (await import('./rtc.controller')).default
  const app = express()
  app.use(express.json())
  app.use('/api/rtc', router)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rtc`
  const post = (path: string, body: unknown, authorized = true) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-auth' } : {}) },
    body: JSON.stringify(body),
  })
  try {
    assert.equal((await post('/session/start', {}, false)).status, 401)
    for (const path of ['/session/stop', '/session/ping']) {
      assert.equal((await post(path, { channelName: 'test-room' })).status, 404)
    }
    assert.equal((await fetch(`${base}/graphs`, { headers: { Authorization: 'Bearer test-auth' } })).status, 404)
    assert.equal((await fetch(`${base}/health`)).status, 200)
    const request = { intent: {
      surface: 'mobile_workbench', mode: 'communication', sessionStrategy: 'heavy_realtime',
      requestedCapabilities: ['transport_send_control'],
    } }
    skipIdentity = true
    assert.equal((await post('/session/start', request)).status, 401)
    skipIdentity = false
    for (const field of ['channelName', 'userUid', 'timeoutSeconds', 'requestId', 'authenticatedUserId',
      'asrAccountId', 'executionBackend', 'execution_backend', 'mode', 'graphName', 'properties']) {
      const rejected = await post('/session/start', { ...request, [field]: 'untrusted' })
      assert.equal(rejected.status, 400, field)
    }
    for (const body of [{}, { intent: {} }, { intent: { ...request.intent, mode: 'other' } },
      { intent: { ...request.intent, scene: null } },
      { intent: { ...request.intent, requestedCapabilities: ['admin'] } },
      { intent: { ...request.intent, deviceContext: { networkOnline: 'false' } } }]) {
      assert.equal((await post('/session/start', body)).status, 400)
    }
    const response = await post('/session/start', request)
    assert.equal(response.status, 200)
    const session = parseRtcStartSessionResult(await response.json())
    assert.equal(session.intent.scene, null)
    assert.equal(session.intent.surface, 'mobile_workbench')
    const grants = await new TokenVerifier('test-key', 'test-secret').verify(session.transport.participantToken)
    assert.equal(grants.video?.room, session.transport.roomName)
    assert.ok(Math.abs((grants.exp ?? 0) - Math.floor(Date.now() / 1000) - session.joinTokenTtlSeconds) <= 2)
    const second = parseRtcStartSessionResult(await (await post('/session/start', request)).json())
    assert.notEqual(second.transport.roomName, session.transport.roomName)
    assert.notEqual(second.transport.participantIdentity, session.transport.participantIdentity)
    const empty = parseRtcStartSessionResult(await (await post('/session/start', {
      intent: { ...request.intent, requestedCapabilities: [] },
    })).json())
    assert.deepEqual(empty.intent.grantedCapabilities, [])
    const denied = parseRtcStartSessionResult(await (await post('/session/start', {
      intent: { ...request.intent, requestedCapabilities: ['voice_profile_update'], sessionStrategy: 'light_voice' },
    })).json())
    assert.deepEqual(denied.intent.requestedCapabilities, ['voice_profile_update'])
    assert.deepEqual(denied.intent.grantedCapabilities, [])
    assert.equal(denied.readiness.requestedStrategy, 'light_voice')
    assert.equal(denied.readiness.resolvedStrategy, 'heavy_realtime')

    assert.equal(grants.video?.roomAdmin, undefined)
    assert.equal(grants.video?.roomList, undefined)
    assert.equal(session.transport.participantMetadata.includes('attacker'), false)
    assert.equal(session.transport.participantMetadata.includes('trusted-user'), false)
    const blocked = await post('/session/start', { intent: { ...request.intent, mode: 'training', deviceContext: { networkOnline: false } } })
    assert.equal(blocked.status, 400)
    console.log('rtc.controller HTTP tests passed (mock auth, local signing, removed routes, readiness)')
  } finally {
    auth.authMiddleware = originalAuth
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
