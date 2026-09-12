import assert from 'node:assert/strict'
import test from 'node:test'

import { uploadPathBelongsToContributor } from './upload-path-policy'

test('upload paths accept only supported prefixes owned by the authenticated contributor', () => {
  const contributorId = 'account-a'
  assert.equal(uploadPathBelongsToContributor('dataset/account-a/mobile-workbench/rec.m4a', contributorId), true)
  assert.equal(uploadPathBelongsToContributor('supervised/mandarin/daily/account-a/rec.wav', contributorId), true)
  assert.equal(uploadPathBelongsToContributor('weak-supervision/dialogue/account-a/session/rec.webm', contributorId), true)
})

test('upload paths reject another account, traversal, and unknown prefixes', () => {
  const contributorId = 'account-a'
  assert.equal(uploadPathBelongsToContributor('dataset/account-b/mobile-workbench/rec.m4a', contributorId), false)
  assert.equal(uploadPathBelongsToContributor('dataset/account-a/../account-b/rec.m4a', contributorId), false)
  assert.equal(uploadPathBelongsToContributor('/dataset/account-a/mobile-workbench/rec.m4a', contributorId), false)
  assert.equal(uploadPathBelongsToContributor('arbitrary/account-a/rec.wav', contributorId), false)
})
