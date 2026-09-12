import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchUploadRequest, fetchUploadRequestWithRetry } from './upload-request'

test('a stalled upload request is aborted at its deadline', async () => {
  const requestSignals: AbortSignal[] = []

  const stalledRequest = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const requestSignal = init?.signal
    if (requestSignal) {
      requestSignals.push(requestSignal)
    }

    return await new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
    })
  }

  await assert.rejects(
    fetchUploadRequest('/api/upload/sign', { method: 'POST' }, 5, stalledRequest),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.equal(requestSignals[0]?.aborted, true)
})

test('a completed upload request is returned unchanged', async () => {
  const expected = new Response(null, { status: 204 })
  const request = async (): Promise<Response> => expected

  const actual = await fetchUploadRequest(
    '/api/upload/complete',
    { method: 'POST' },
    20,
    request,
  )

  assert.equal(actual, expected)
})

test('overload responses are retried and eventually returned', async () => {
  let calls = 0
  const response = await fetchUploadRequestWithRetry('/api/upload/complete', {}, {
    attempts: 3,
    request: async () => {
      calls += 1
      return new Response('{}', {
        status: calls < 3 ? 503 : 200,
        headers: { 'Retry-After': '0.001' },
      })
    },
  })
  assert.equal(response.status, 200)
  assert.equal(calls, 3)
})

test('401 actually replays the identical body once with a fresh token and preserved Headers', async () => {
  const calls: RequestInit[] = []
  const body = JSON.stringify({ recordingId: 'stable' })
  const response = await fetchUploadRequestWithRetry('/api/upload/complete', {
    method: 'POST', body, headers: new Headers({ Authorization: 'Bearer old', 'Content-Type': 'application/json' }),
  }, {
    request: async (_url, init) => { calls.push(init ?? {}); return new Response(null, { status: calls.length === 1 ? 401 : 200 }) },
    onUnauthorized: async rejected => { assert.equal(rejected, 'old'); return 'new' },
  })
  assert.equal(response.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].body, body)
  assert.equal(new Headers(calls[1].headers).get('Authorization'), 'Bearer new')
  assert.equal(new Headers(calls[1].headers).get('Content-Type'), 'application/json')
})
test('permanent 401 refreshes only once; failed refresh never replays stale JWT', async () => {
  for (const replacement of ['new', 'old', null]) {
    let calls = 0, refreshes = 0
    const response = await fetchUploadRequestWithRetry('/api/upload/sign', { headers: { Authorization: 'Bearer old' } }, {
      request: async () => { calls++; return new Response(null, { status: 401 }) },
      onUnauthorized: async () => { refreshes++; return replacement },
    })
    assert.equal(response.status, 401)
    assert.equal(refreshes, 1)
    assert.equal(calls, replacement === 'new' ? 2 : 1)
  }
})
test('401 without refresh handler and 403 are not retried', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    await fetchUploadRequestWithRetry('/api/upload/sign', {}, {
      request: async () => { calls++; return new Response(null, { status }) },
    })
    assert.equal(calls, 1)
  }
})
