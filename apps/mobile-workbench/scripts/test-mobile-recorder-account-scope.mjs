import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/queue/recorder-queue-policy.ts')
const source = await readFile(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'voxflame-mobile-queue-scope-'))
const outputPath = path.join(outputDirectory, 'recorder-queue-policy.mjs')
await writeFile(outputPath, transpiled)
const {
  recorderQueueItemBelongsToContributor,
  recorderQueueItemsForContributor,
} = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`)

const accountA = { recordingId: 'a', contributorId: 'account-a' }
const accountB = { recordingId: 'b', contributorId: 'account-b' }

assert.deepEqual(recorderQueueItemsForContributor([accountA, accountB], 'account-a'), [accountA])
assert.deepEqual(recorderQueueItemsForContributor([accountA, accountB], 'account-b'), [accountB])
assert.deepEqual(recorderQueueItemsForContributor([accountA, accountB], null), [])
assert.equal(recorderQueueItemBelongsToContributor(accountA, 'account-a'), true)
assert.equal(recorderQueueItemBelongsToContributor(accountA, 'account-b'), false)

console.log('mobile recorder account scope tests passed')
