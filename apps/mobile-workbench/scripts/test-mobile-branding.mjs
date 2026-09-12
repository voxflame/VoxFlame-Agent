import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/config/mobile-branding.ts')
const source = await readFile(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'mobile-branding-'))
const outputPath = path.join(outputDirectory, 'mobile-branding.mjs')
await writeFile(outputPath, transpiled)
const { getMobileBranding } = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`)

const previousName = process.env.EXPO_PUBLIC_APP_BRAND_NAME
const previousAccent = process.env.EXPO_PUBLIC_APP_BRAND_ACCENT
process.env.EXPO_PUBLIC_APP_BRAND_NAME = '语音共建平台'
process.env.EXPO_PUBLIC_APP_BRAND_ACCENT = '#236B5B'
assert.deepEqual(getMobileBranding(), {
  name: '语音共建平台',
  mark: '语',
  accentColor: '#236B5B',
})

process.env.EXPO_PUBLIC_APP_BRAND_ACCENT = 'red; color: black'
assert.equal(getMobileBranding().accentColor, '#C65D2E')

delete process.env.EXPO_PUBLIC_APP_BRAND_NAME
assert.deepEqual(getMobileBranding('Main App'), {
  name: 'Main App',
  mark: 'M',
  accentColor: '#C65D2E',
})

if (previousName === undefined) delete process.env.EXPO_PUBLIC_APP_BRAND_NAME
else process.env.EXPO_PUBLIC_APP_BRAND_NAME = previousName
if (previousAccent === undefined) delete process.env.EXPO_PUBLIC_APP_BRAND_ACCENT
else process.env.EXPO_PUBLIC_APP_BRAND_ACCENT = previousAccent

console.log('mobile branding tests passed')
