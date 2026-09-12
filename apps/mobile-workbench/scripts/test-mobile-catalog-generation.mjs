import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/training/use-mobile-training-catalog.ts')
const source = await readFile(sourcePath, 'utf8')
const helperMatch = source.match(/export function isCurrentMobileCatalogRequest[\s\S]*?\n}/)
assert.ok(helperMatch, 'catalog generation helper must remain exported')
const transpiled = ts.transpileModule(helperMatch[0], {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'voxflame-catalog-generation-'))
const outputPath = path.join(outputDirectory, 'catalog-generation.mjs')
await writeFile(outputPath, transpiled)
const { isCurrentMobileCatalogRequest } = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`)

assert.equal(isCurrentMobileCatalogRequest(2, 2), true)
assert.equal(isCurrentMobileCatalogRequest(1, 2), false)

console.log('mobile catalog generation tests passed')
