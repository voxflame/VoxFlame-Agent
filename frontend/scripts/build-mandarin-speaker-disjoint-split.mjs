#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildMandarinSpeakerDisjointSplit } from './mandarin-speaker-disjoint-split-core.mjs'
import {
  parseRecordingManifestJsonl,
  resolveActiveRecordingManifestRows,
} from '../src/lib/corpus/recording-manifest-events.mjs'

function values(name) {
  return process.argv.flatMap((argument, index) => argument === name ? [process.argv[index + 1]] : []).filter(Boolean)
}

function value(name) {
  return values(name)[0]
}

function readJsonl(filePath) {
  return parseRecordingManifestJsonl(fs.readFileSync(filePath, 'utf8'), filePath)
}

const manifestPaths = values('--manifest')
const outputPath = value('--output')
const splitDir = value('--split-dir')
const seed = value('--seed') ?? 'voxflame-mandarin-speaker-disjoint-v1'
if (manifestPaths.length === 0 || !outputPath) {
  throw new Error('usage: build-mandarin-speaker-disjoint-split --manifest <manifest.jsonl> ... --output <evidence.json> [--split-dir <directory>] [--seed <seed>]')
}

const rows = resolveActiveRecordingManifestRows(manifestPaths.flatMap(readJsonl))
const evidence = buildMandarinSpeakerDisjointSplit({ rows, seed })
const sourceHash = crypto.createHash('sha256')
for (const filePath of [...manifestPaths].sort()) sourceHash.update(fs.readFileSync(filePath))
evidence.input.source_manifest_count = manifestPaths.length
evidence.input.source_manifest_sha256 = sourceHash.digest('hex')

if (splitDir) {
  fs.mkdirSync(splitDir, { recursive: true })
  for (const [split, splitRows] of Object.entries(evidence.split_rows)) {
    fs.writeFileSync(path.join(splitDir, `${split}.jsonl`), `${splitRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
  }
}
delete evidence.split_rows
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  input_rows: evidence.input.input_rows,
  eligible_rows: evidence.input.eligible_rows,
  speakers: evidence.input.speakers,
  split_summary: evidence.split_summary,
  output: outputPath,
}, null, 2))
