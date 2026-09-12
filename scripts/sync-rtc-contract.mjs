#!/usr/bin/env node
// Checked-in generated contracts keep each Docker/EAS build self-contained.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = 'backend/src/contracts/rtc-session.ts'
const targets = [
  'frontend/src/lib/realtime-audio/generated/rtc-session.ts',
  'apps/mobile-workbench/src/contracts/generated/rtc-session.ts',
]
const expected = `// GENERATED from ${source}; run node scripts/sync-rtc-contract.mjs\n`
  + readFileSync(resolve(root, source), 'utf8')
const check = process.argv.includes('--check')
for (const target of targets) {
  const path = resolve(root, target)
  if (check) {
    let actual = ''
    try { actual = readFileSync(path, 'utf8') } catch { /* report missing output as drift */ }
    if (actual !== expected) {
      console.error(`RTC contract drift: ${target}; run node scripts/sync-rtc-contract.mjs`)
      process.exitCode = 1
    }
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, expected)
  }
}
if (!process.exitCode) console.log(check ? 'RTC contracts match canonical source' : 'RTC contracts generated')
