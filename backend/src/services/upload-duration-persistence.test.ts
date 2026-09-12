import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

// A loopback PostgREST stub: never use production credentials or OSS in this test.
test('upload success requires durable DB availability and receipt confirmation', async () => {
  let fail: 'ledger' | 'insert' | 'receipt' | 'missing-row' | 'none' = 'none'
  let receiptWrites = 0
  let rows = 0
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const path = request.url ?? ''
    if (path.includes('recording_duration_totals')) {
      response.statusCode = fail === 'ledger' ? 404 : 200
      response.end(fail === 'ledger' ? '{"message":"missing ledger"}' : '[]')
    } else if (request.method === 'POST') {
      response.statusCode = fail === 'insert' ? 500 : 201
      if (fail !== 'insert') rows += 1
      response.end(fail === 'insert' ? '{"message":"insert failed"}' : '{"id":"row-1","metadata":{}}')
    } else if (request.method === 'PATCH') {
      receiptWrites += 1
      response.statusCode = fail === 'receipt' ? 500 : fail === 'missing-row' ? 406 : 200
      response.end(fail === 'receipt' ? '{"message":"receipt failed"}'
        : fail === 'missing-row' ? '{"message":"receipt row missing"}' : '{"id":"row-1"}')
    } else {
      response.end(rows > 0 ? '[{"id":"row-1","metadata":{}}]' : '[]')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only'
  process.env.OSS_ACCESS_KEY_ID = ''
  process.env.OSS_ACCESS_KEY_SECRET = ''
  try {
    const { ossService } = await import('./oss.service')
    const { UploadArtifactService } = await import('./upload-artifact.service')
    const objects = new Map<string, string>()
    ossService.getTextObject = async (path) => objects.get(path) ?? null
    ossService.appendTextLog = async (path, line) => { objects.set(path, `${objects.get(path) ?? ''}${line}\n`) }
    const service = new UploadArtifactService()
    const payload = {
      contributorId: 'test-account', audioPath: 'dataset/test-account/r1.wav',
      text: 'same sentence', duration: 3, source: 'free_recording', metadata: { recording_id: 'r1' },
    }
    fail = 'ledger'
    await assert.rejects(service.persistCompletedUpload(payload), /recording_duration_migration_required/)
    assert.equal(rows, 0)
    fail = 'insert'
    await assert.rejects(service.persistCompletedUpload(payload), /insert failed/)
    assert.equal(objects.size, 0)
    fail = 'receipt'
    await assert.rejects(service.persistCompletedUpload(payload), /receipt failed/)
    assert.equal(rows, 1)
    assert.equal(receiptWrites, 1)
    assert.equal(objects.size, 1) // OSS exists, but caller must retain the local queue.
    fail = 'missing-row'
    await assert.rejects(service.persistCompletedUpload(payload), /receipt row missing/)
    fail = 'none'
    const result = await service.persistCompletedUpload(payload)
    assert.equal(result.contributionId, 'row-1')
    assert.equal(result.reusedContribution, true)
    assert.equal(result.manifestAlreadySynced, true)
    assert.equal(receiptWrites, 3)
    assert.equal(objects.get(result.manifestPath)?.trim().split('\n').length, 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
