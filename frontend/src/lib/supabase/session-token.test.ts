import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getSessionAccessToken, type SessionTokenAuth } from './session-token'

function fixture(seconds = 3600) {
  let session: { access_token: string; expires_at: number; user: { id: string } } | null = {
    access_token: 'old', expires_at: Math.floor(Date.now() / 1000) + seconds, user: { id: 'a' },
  }
  let refreshCount = 0
  const auth: SessionTokenAuth = {
    async getSession() { return { data: { session }, error: null } },
    async refreshSession() {
      refreshCount++
      session = { access_token: 'new', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'a' } }
      return { data: { session }, error: null }
    },
  }
  return { auth, set: (value: typeof session) => { session = value }, count: () => refreshCount }
}

test('Web and App token policy source stays identical', () => {
  const web = readFileSync(new URL('./session-token.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../../../apps/mobile-workbench/src/auth/session-token.ts', import.meta.url), 'utf8')
  assert.equal(web, app)
})
test('fresh token is reused; near-expiry token is proactively refreshed', async () => {
  const fresh = fixture()
  assert.equal(await getSessionAccessToken(fresh.auth, { expectedUserId: 'a' }), 'old')
  assert.equal(fresh.count(), 0)
  const expiring = fixture(60)
  assert.equal(await getSessionAccessToken(expiring.auth), 'new')
  assert.equal(expiring.count(), 1)
})
test('401 forces refresh even with a future expiry; already-rotated token is reused', async () => {
  const f = fixture()
  assert.equal(await getSessionAccessToken(f.auth, { rejectedToken: 'old' }), 'new')
  assert.equal(await getSessionAccessToken(f.auth, { rejectedToken: 'old' }), 'new')
  assert.equal(f.count(), 1)
})
test('refresh failure never returns the old JWT', async () => {
  const f = fixture(-1)
  f.auth.refreshSession = async () => ({ data: { session: null }, error: new Error('offline') })
  assert.equal(await getSessionAccessToken(f.auth), null)
})
test('missing session, wrong owner, and account switch during refresh fail closed', async () => {
  const f = fixture()
  assert.equal(await getSessionAccessToken(f.auth, { expectedUserId: 'b' }), null)
  f.set(null)
  assert.equal(await getSessionAccessToken(f.auth), null)
  const changed = fixture(-1)
  changed.auth.refreshSession = async () => {
    const session = { access_token: 'other', expires_at: Date.now() / 1000 + 3600, user: { id: 'b' } }
    changed.set(session)
    return { data: { session }, error: null }
  }
  assert.equal(await getSessionAccessToken(changed.auth, { expectedUserId: 'a' }), null)
})
test('concurrent rejected requests share one refresh', async () => {
  const f = fixture()
  const original = f.auth.refreshSession
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let started = 0
  f.auth.refreshSession = async () => { started++; await gate; return original() }
  const results = Array.from({ length: 5 }, () => getSessionAccessToken(f.auth, { rejectedToken: 'old' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(started, 1)
  release()
  assert.deepEqual(await Promise.all(results), ['new', 'new', 'new', 'new', 'new'])
})
test('stalled SDK operation times out instead of blocking the upload queue', async () => {
  const f = fixture()
  f.auth.getSession = () => new Promise(() => {})
  assert.equal(await getSessionAccessToken(f.auth, {}, 5), null)
})
