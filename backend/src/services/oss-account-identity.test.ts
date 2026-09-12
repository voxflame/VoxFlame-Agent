import assert from 'node:assert/strict'
import test from 'node:test'
import { extractOssAccountKey, resolveOssAccountIdentity, type AuthAccountIdentity } from './oss-account-identity'

const id = '00000000-0000-4000-8000-000000000001'
function resolve(overrides: Partial<AuthAccountIdentity> = {}) {
  const account: AuthAccountIdentity = { id, email: null, phone: null, emailVerified: false, phoneVerified: false, anonymous: false, ...overrides }
  return resolveOssAccountIdentity(id, new Map([[id, account]]))
}

test('phone-only Auth account resolves, instead of being labeled unknown_user', () => {
  const result = resolve({ phone: '8613800000000', phoneVerified: true })
  assert.equal(result.status, 'resolved')
  assert.equal(result.contactType, 'phone')
  assert.equal(result.phoneDisplay, '***0000')
  assert.equal(result.emailDisplay, null)
  assert.equal(result.phoneVerified, true)
  assert.equal(result.canonicalAccountId, id)
})
test('numeric email remains an email, not a phone number', () => {
  const result = resolve({ email: '13800000000@example.invalid', emailVerified: true })
  assert.equal(result.contactType, 'email')
  assert.equal(result.phoneDisplay, null)
  assert.equal(result.emailDisplay, '13***@example.invalid')
})
test('contact updates and dual identities never change account storage identity', () => {
  const email = resolve({ email: 'name@example.invalid' })
  const phone = resolve({ phone: '8613800000000' })
  const both = resolve({ email: 'new@example.invalid', phone: '8613900000000' })
  assert.equal(email.storageKey, phone.storageKey)
  assert.equal(both.storageKey, phone.storageKey)
  assert.equal(both.contactType, 'email_and_phone')
})
test('same email prefix at different domains or same masked phone cannot merge users', () => {
  const first = { id, email: 'same@a.invalid', phone: '8613800000000', emailVerified: true, phoneVerified: true, anonymous: false }
  const second = { ...first, id: '00000000-0000-4000-8000-000000000002', email: 'same@b.invalid', phone: '8613900000000' }
  const accounts = new Map([[first.id, first], [second.id, second]])
  assert.notEqual(resolveOssAccountIdentity(first.id, accounts).storageKey, resolveOssAccountIdentity(second.id, accounts).storageKey)
})
test('unknown UUID, legacy owner and ownerless object are separate quarantine states', () => {
  const accounts = new Map<string, AuthAccountIdentity>()
  assert.equal(resolveOssAccountIdentity(id, accounts).status, 'auth_missing')
  assert.equal(resolveOssAccountIdentity('v_legacy', accounts).status, 'legacy')
  const a = resolveOssAccountIdentity(null, accounts, 'misc/one.wav')
  const b = resolveOssAccountIdentity(null, accounts, 'misc/two.wav')
  assert.equal(a.status, 'unassigned')
  assert.equal(a.canonicalAccountId, null)
  assert.notEqual(a.storageKey, b.storageKey)
  assert.equal(resolve({ anonymous: true }).status, 'anonymous')
  assert.equal(resolve().status, 'contact_missing')
})
test('known owner layouts agree and random nested UUID is never guessed as account', () => {
  assert.equal(extractOssAccountKey(`dataset/${id}/r.wav`), id)
  assert.equal(extractOssAccountKey(`supervised/mandarin/2026/${id}/r.wav`), id)
  assert.equal(extractOssAccountKey(`weak-supervision/dialogue/${id}/s/r.wav`), id)
  assert.equal(extractOssAccountKey('unlabeled/v_legacy/r.wav'), 'v_legacy')
  assert.equal(extractOssAccountKey(`misc/session/${id}/r.wav`), null)
  assert.equal(extractOssAccountKey('dataset/../r.wav'), null)
})
