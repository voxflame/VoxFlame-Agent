#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import { buildMandarinCollectionEvidence } from './mandarin-collection-evidence-core.mjs'
import {
  parseRecordingManifestJsonl,
  resolveActiveRecordingManifestRows,
} from '../src/lib/corpus/recording-manifest-events.mjs'

function value(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function values(name) {
  return process.argv.flatMap((argument, index) => argument === name ? [process.argv[index + 1]] : []).filter(Boolean)
}

const referencePath = value('--reference')
const spokenPath = value('--spoken-review')
const outputPath = value('--output')
const manifestPaths = values('--manifest')
if (!referencePath || !outputPath) {
  throw new Error('usage: build-mandarin-collection-evidence --reference <reference.json> [--spoken-review <queue.json>] [--manifest <manifest.jsonl> ...] --output <evidence.json>')
}

function readJsonl(filePath) {
  return parseRecordingManifestJsonl(fs.readFileSync(filePath, 'utf8'), filePath)
}

const payload = buildMandarinCollectionEvidence({
  reference: JSON.parse(fs.readFileSync(referencePath, 'utf8')),
  spokenQueue: spokenPath ? JSON.parse(fs.readFileSync(spokenPath, 'utf8')) : null,
  manifestRows: resolveActiveRecordingManifestRows(manifestPaths.flatMap(readJsonl)),
})
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`wrote collection evidence: ${payload.review.coverage_eligible_recordings} eligible full-review recordings`)
