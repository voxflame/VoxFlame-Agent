import assert from 'node:assert/strict'
import test from 'node:test'

import { parseReviewerAllowlist } from './quality-reviewer.middleware'

test('reviewer allowlist is exact, normalized and closed by default', () => {
  assert.deepEqual([...parseReviewerAllowlist(undefined)], [])
  assert.deepEqual(
    [...parseReviewerAllowlist('A@Example.com; b@example.com\nA@example.com')],
    ['a@example.com', 'b@example.com'],
  )
})
