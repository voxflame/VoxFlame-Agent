import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLoginPath,
  isProtectedPath,
  resolveExternalOrigin,
} from './navigation.ts'

test('buildLoginPath normalizes unsafe next values', () => {
  assert.equal(buildLoginPath('https://example.com/unsafe'), '/login?next=%2Fcontribute')
  assert.equal(buildLoginPath('//double-slash'), '/login?next=%2Fcontribute')
})

test('buildLoginPath sends a direct login into the recording task', () => {
  assert.equal(buildLoginPath(), '/login?next=%2Fcontribute')
})

test('resolveExternalOrigin prefers forwarded host and proto over internal request url', () => {
  const headers = new Headers({
    host: '127.0.0.1:3100',
    'x-forwarded-host': '111.230.35.89',
    'x-forwarded-proto': 'https',
  })

  assert.equal(
    resolveExternalOrigin('http://127.0.0.1:3100/contribute', headers),
    'https://111.230.35.89',
  )
})

test('resolveExternalOrigin falls back to request origin when forwarded headers are absent', () => {
  const headers = new Headers({
    host: '127.0.0.1:3100',
  })

  assert.equal(
    resolveExternalOrigin('http://127.0.0.1:3100/contribute', headers),
    'http://127.0.0.1:3100',
  )
})

test('isProtectedPath does not revive removed communication child routes', () => {
  assert.equal(isProtectedPath('/communicate'), false)
  assert.equal(isProtectedPath('/communicate/live'), false)
  assert.equal(isProtectedPath('/chat'), false)
})

test('isProtectedPath keeps active nested route trees behind authentication', () => {
  assert.equal(isProtectedPath('/contribute'), true)
  assert.equal(isProtectedPath('/contribute/topic/assessment-screening'), true)
  assert.equal(isProtectedPath('/communicate/assistant'), true)
  assert.equal(isProtectedPath('/corpus-review'), true)
  assert.equal(isProtectedPath('/corpus-review/core-gap'), true)
  assert.equal(isProtectedPath('/settings/account'), true)
  assert.equal(isProtectedPath('/settings-legacy'), false)
})

test('corpus spoken-text review remains a protected nested route', () => {
  assert.equal(isProtectedPath('/corpus-review/spoken-text'), true)
})
