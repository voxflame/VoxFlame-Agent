import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/memory/use-mobile-memory-editor.ts')
const source = await readFile(sourcePath, 'utf8')
const helperMatch = source.match(/export function isCurrentMobileMemoryOwner[\s\S]*?\n}/)
assert.ok(helperMatch, 'memory owner helper must remain exported')
const transpiled = ts.transpileModule(helperMatch[0], {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'voxflame-mobile-memory-owner-'))
const outputPath = path.join(outputDirectory, 'mobile-memory-owner.mjs')
await writeFile(outputPath, transpiled)
const { isCurrentMobileMemoryOwner } = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`)

assert.equal(isCurrentMobileMemoryOwner('account-a', 'account-a', 2, 2), true)
assert.equal(isCurrentMobileMemoryOwner('account-a', 'account-b', 2, 2), false)
assert.equal(isCurrentMobileMemoryOwner('account-a', 'account-a', 1, 2), false)

console.log('mobile memory account scope tests passed')
