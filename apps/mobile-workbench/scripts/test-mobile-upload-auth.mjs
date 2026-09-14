import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/api/mobile-upload-client.ts', import.meta.url), 'utf8')
const isolated = source.replace("import { File } from 'expo-file-system'", 'class File { exists = true; constructor(uri) { this.uri = uri } }')
  .replace("import { MOBILE_LEGAL_CONSENT_VERSION } from '../auth/legal-consent'", "const MOBILE_LEGAL_CONSENT_VERSION = 'test'")
const js = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const { finalizeMobileRecorderReferenceText, uploadMobileRecorderQueueItem } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const item = {
  recordingId: 'r1', contributorId: 'a', text: 'test', metadata: {}, consentScope: 'training_only',
  recording: { recordingId: 'r1', sessionId: 's', audio: { uri: 'local.wav', format: 'wav', durationSeconds: 2 } },
}
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

test.afterEach(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout })
for (const rejectedStage of ['sign', 'complete']) test(`native ${rejectedStage} 401 replays with fresh JWT and unchanged recording`, async () => {
  const calls = [], tokens = []
  let rejected = false
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith(`/${rejectedStage}`) && !rejected) { rejected = true; return new Response(null, { status: 401 }) }
    if (url.endsWith('/sign')) return Response.json({ url: 'https://oss.test/audio' })
    if (url.endsWith('/complete')) return Response.json({ success: true, recordingId: 'r1', contributionId: 'c1' })
    assert.equal(new Headers(init.headers).has('Authorization'), false, 'never send JWT to OSS')
    return new Response(null, { status: 200 })
  }
  let token = 'old'
  const receipt = await uploadMobileRecorderQueueItem(item, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken(options) {
      tokens.push(options)
      assert.equal(options.expectedUserId, 'a')
      if (options.rejectedToken === 'old') token = 'new'
      return token
    } },
  })
  assert.equal(receipt.recordingId, 'r1')
  const retries = calls.filter(c => c.url.endsWith(`/${rejectedStage}`))
  assert.equal(retries.length, 2)
  assert.equal(new Headers(retries[1].init.headers).get('Authorization'), 'Bearer new')
  assert.equal(retries[0].init.body, retries[1].init.body)
  assert.equal(tokens.filter(t => t.rejectedToken === 'old').length, 1)
  assert.equal(calls.filter(c => c.url.includes('oss.test')).length, 1)
})
test('native completion obtains a new token after PUT, independent of signing', async () => {
  let token = 'before-put'
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/sign')) return Response.json({ url: 'https://oss.test/audio' })
    if (url.includes('oss.test')) { token = 'after-put'; return new Response(null, { status: 200 }) }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer after-put')
    return Response.json({ success: true, recordingId: 'r1' })
  }
  await uploadMobileRecorderQueueItem(item, { apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken() { return token } } })
})
test('native initial upload keeps automatic text out of human spoken_text', async () => {
  let completePayload = null
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/sign')) return Response.json({ url: 'https://oss.test/audio' })
    if (url.includes('oss.test')) return new Response(null, { status: 200 })
    completePayload = JSON.parse(init.body)
    return Response.json({ success: true, recordingId: 'r1' })
  }
  await uploadMobileRecorderQueueItem({ ...item, recognizedText: '参考文字' }, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken() { return 'valid' } },
  })
  assert.equal(completePayload.metadata.spoken_text, undefined)
  assert.equal(completePayload.metadata.recognized_text, '参考文字')
  assert.equal(completePayload.metadata.reference_text_status, 'available')
})
test('native failed refresh does not send stale token again or upload to OSS', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 401 }) }
  await assert.rejects(uploadMobileRecorderQueueItem(item, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken(options) { return options.rejectedToken ? null : 'old' } },
  }), /mobile_auth_expired/)
  assert.equal(calls, 1)
})
test('native permanent rejection stops after one authentication retry', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 401 }) }
  await assert.rejects(uploadMobileRecorderQueueItem(item, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken(options) { return options.rejectedToken ? 'new' : 'old' } },
  }), /mobile_upload_sign_401/)
  assert.equal(calls, 2)
})
test('native stalled request is aborted so the local queue can report failure', async () => {
  globalThis.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, ms === 20_000 ? 5 : ms, ...args)
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
  })
  await assert.rejects(uploadMobileRecorderQueueItem(item, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken() { return 'valid' } },
  }), /timeout/)
})
test('native overload retry remains bounded and preserves payload', async () => {
  let attempts = 0
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 503, headers: { 'Retry-After': '0.001' } }) }
  await assert.rejects(uploadMobileRecorderQueueItem(item, {
    apiBaseUrl: 'https://api.test', tokenProvider: { async getAccessToken() { return 'valid' } },
  }), /mobile_upload_sign_503/)
  assert.equal(attempts, 3)
})

test('native final reference text uses the capture id and never writes spoken_text', async () => {
  let payload = null
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body)
    return Response.json({ success: true })
  }

  const updated = await finalizeMobileRecorderReferenceText({
    ...item,
    recognizedText: '林军请帮我拿下',
    metadata: {
      client_capture_id: 'capture-1',
      recognized_text: '林军请帮我拿下',
      spoken_text: '不应从 ASR 写入',
      feedback_status: 'retry',
    },
  }, {
    apiBaseUrl: 'https://api.test',
    tokenProvider: { async getAccessToken() { return 'valid' } },
  })

  assert.equal(updated, true)
  assert.equal(payload.clientCaptureId, 'capture-1')
  assert.equal(payload.recognizedText, '林军请帮我拿下')
  assert.equal(payload.metadata.spoken_text, undefined)
  assert.equal(payload.metadata.feedback_status, 'retry')
})
