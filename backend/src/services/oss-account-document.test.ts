import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOssAccountDocument, ossAccountDocumentPath, accountDocumentOwners, accountDocumentNeedsRefresh } from './oss-account-document'
import type { AuthAccountIdentity } from './oss-account-identity'
const id = '00000000-0000-4000-8000-000000000001'
const user: AuthAccountIdentity = { id, phone: '8613800000000', email: null, phoneVerified: true, emailVerified: false, anonymous: false }
test('OSS sidecar stores phone and email separately from a stable UUID', () => {
  const doc = buildOssAccountDocument(id, user, new Date('2026-09-08T05:00:00Z'))
  assert.equal(doc.contacts.phone?.value, user.phone)
  assert.equal(doc.contacts.email, null)
  assert.equal(doc.contact_type, 'phone')
  assert.equal(doc.canonical_account_id, id)
  assert.equal(doc.expires_at, '2026-09-08T06:00:00.000Z')
  const both = buildOssAccountDocument(id, { ...user, email: '13800000000@example.invalid' })
  assert.equal(both.contact_type, 'email_and_phone')
  assert.equal(both.contacts.email?.value, '13800000000@example.invalid')
  assert.notEqual(doc.revision, both.revision)
  assert.equal(doc.canonical_account_id, both.canonical_account_id)
})
test('deleted/missing and anonymous accounts export no contacts', () => {
  const gone = buildOssAccountDocument(id, undefined)
  assert.equal(gone.identity_status, 'auth_missing')
  assert.deepEqual(gone.contacts, { email: null, phone: null })
  assert.equal(gone.canonical_account_id, null)
  const guest = buildOssAccountDocument(id, { ...user, anonymous: true })
  assert.deepEqual(guest.contacts, { email: null, phone: null })
  assert.equal(buildOssAccountDocument('v_legacy', undefined).identity_status, 'legacy')
})
test('mapping destination and revision are deterministic, contact rotation updates revision', () => {
  assert.equal(ossAccountDocumentPath(id), `dataset/${id}/account.json`)
  assert.throws(() => ossAccountDocumentPath('../other'), /invalid_account_owner/)
  const a = buildOssAccountDocument(id, user, new Date(0))
  const b = buildOssAccountDocument(id, user, new Date(1))
  assert.equal(a.revision, b.revision)
  assert.notEqual(a.synced_at, b.synced_at)
  assert.notEqual(a.revision, buildOssAccountDocument(id, { ...user, phone: '8613900000000' }).revision)
})

test('new registrations get a sidecar without any OSS audio; removed accounts remain reconciled', () => {
  const users = new Map([[id, user]])
  assert.deepEqual(accountDocumentOwners(users, []), [id])
  assert.deepEqual(accountDocumentOwners(users, [id, 'v_old']), [id, 'v_old'])
  assert.deepEqual(accountDocumentOwners(new Map(), [id]), [id])
})
test('unchanged sync is idempotent, contact updates immediate, heartbeat and stale clock bounded', () => {
  const now = Date.parse('2026-09-08T05:00:00Z')
  const doc = buildOssAccountDocument(id, user, new Date(now))
  assert.equal(accountDocumentNeedsRefresh(doc, doc, now + 60_000), false)
  assert.equal(accountDocumentNeedsRefresh(doc, doc, now + 15 * 60_000), true)
  assert.equal(accountDocumentNeedsRefresh(doc, doc, now - 1), true)
  assert.equal(accountDocumentNeedsRefresh(null, doc, now), true)
  assert.equal(accountDocumentNeedsRefresh(doc, buildOssAccountDocument(id, undefined), now), true)
  assert.equal(accountDocumentNeedsRefresh(doc, buildOssAccountDocument(id, { ...user, email: 'changed@example.invalid' }), now), true)
})
