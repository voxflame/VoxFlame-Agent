import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePath = path.resolve('src/training/mobile-training-feedback.ts')
const source = await readFile(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'voxflame-mobile-training-'))
const outputPath = path.join(outputDirectory, 'mobile-training-feedback.mjs')
await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, transpiled))
const { analyzeMobileTrainingAttempt, summarizeMobileArticulationBaseline } = await import(
  `${pathToFileURL(outputPath).href}?v=${Date.now()}`
)

const feedback = analyzeMobileTrainingAttempt(
  { id: 'custom', text: '请帮我开门', category: '自定义练习' },
  '请帮我开门',
)
assert.equal(feedback.status, 'excellent')
assert.equal(feedback.summary, '参考文字和题目一致。')

const feedbackWithoutTranscript = analyzeMobileTrainingAttempt(
  { id: 'custom-empty', text: '请帮我开门', category: '自定义练习' },
  '',
)
assert.equal(feedbackWithoutTranscript.status, 'unclear')
assert.match(feedbackWithoutTranscript.summary, /录音已经保留/)
assert.doesNotMatch(feedbackWithoutTranscript.summary, /系统.*听清/)

const summary = summarizeMobileArticulationBaseline([
  {
    exerciseId: 'substitution',
    targetText: '医生',
    heardText: '衣生',
    normalizedTarget: '医生',
    normalizedHeard: '衣生',
    missingChars: ['医'],
    extraChars: ['衣'],
    durationMs: 2_000,
  },
  {
    exerciseId: 'insertion',
    targetText: '爸爸',
    heardText: '爸爸好',
    normalizedTarget: '爸爸',
    normalizedHeard: '爸爸好',
    missingChars: [],
    extraChars: ['好'],
    durationMs: 2_000,
  },
], 2)

assert.equal(summary.referenceTextAgreementPercent, 50)
assert.equal(summary.label, '基线已完成')
assert.match(summary.summary, /参考文字与题面一致/)
assert.match(summary.summary, /不评价你的声音/)
assert.doesNotMatch(JSON.stringify(summary), /系统听懂|系统听清率/)
assert.equal(summary.personalizationSeconds, 4)
assert.ok(summary.patterns.some((pattern) => pattern.label === '“医”'))

console.log('mobile training feedback tests passed')
