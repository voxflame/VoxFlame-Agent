import assert from 'node:assert/strict'
import test from 'node:test'

import { UploadCapacityService } from './upload-capacity.service'

test('capacity admission rejects excess work and release is idempotent', () => {
  const service = new UploadCapacityService({ sign: 1, complete: 1 })
  const release = service.acquire('sign')
  assert.equal(typeof release, 'function')
  assert.equal(service.acquire('sign'), null)
  assert.deepEqual(service.snapshot().operations.sign, { active: 1, limit: 1, rejected: 1 })
  release?.()
  release?.()
  assert.deepEqual(service.snapshot().operations.sign, { active: 0, limit: 1, rejected: 1 })
})
