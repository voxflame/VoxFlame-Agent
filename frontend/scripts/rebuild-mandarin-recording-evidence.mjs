#!/usr/bin/env node

/**
 * Rebuild all Mandarin recording evidence from the immutable local manifests.
 * This command deliberately writes only derived evidence and product-status
 * JSON; it never edits audio, manifests, prompts, or source snapshots.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { buildCoverageProductStatus } from './mandarin-coverage-product-status-core.mjs'
import { buildMandarinCollectionEvidence } from './mandarin-collection-evidence-core.mjs'
import { auditEntries } from './mandarin-coverage-core.mjs'
import { buildMandarinSpeakerDisjointSplit } from './mandarin-speaker-disjoint-split-core.mjs'
import {
  parseRecordingManifestJsonl,
  resolveActiveRecordingManifestRows,
} from '../src/lib/corpus/recording-manifest-events.mjs'

const frontendRoot = process.cwd()
const repoRoot = path.resolve(frontendRoot, '..')
const generatedRoot = path.join(frontendRoot, 'src/lib/corpus/generated')
const evidenceRoot = path.join(repoRoot, 'research/speech-health/evidence/mandarin-collection-coverage-2026-08-22')

function values(name) {
  return process.argv.flatMap((argument, index) => argument === name ? [process.argv[index + 1]] : []).filter(Boolean)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath) {
  return parseRecordingManifestJsonl(fs.readFileSync(filePath, 'utf8'), filePath)
}

function collectManifestFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectManifestFiles(entryPath))
    else if (entry.isFile() && entry.name === 'manifest.jsonl') files.push(entryPath)
  }
  return files.sort()
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const explicitManifestFiles = values('--manifest').map((filePath) => path.resolve(repoRoot, filePath))
const manifestFiles = (explicitManifestFiles.length > 0
  ? explicitManifestFiles
  : collectManifestFiles(path.join(repoRoot, 'artifacts/oss-by-account'))
    .concat(collectManifestFiles(path.join(repoRoot, 'artifacts/oss-by-account-after-20260524-refresh-20260614'))))
  .filter((filePath, index, files) => files.indexOf(filePath) === index)
if (manifestFiles.length === 0) throw new Error('no local artifacts/**/manifest.jsonl files found')
for (const manifestFile of manifestFiles) {
  if (!fs.existsSync(manifestFile)) throw new Error(`manifest does not exist: ${manifestFile}`)
}

const manifestRows = resolveActiveRecordingManifestRows(manifestFiles.flatMap(readJsonl))
const uniqueManifestRecordings = new Set(manifestRows.map((row) => {
  const stableId = row?.recording_id ?? row?.metadata?.recording_id
  if (typeof stableId === 'string' && stableId.trim()) return `recording:${stableId}`
  return `fallback:${row?.audio?.path ?? row?.metadata?.audio_path ?? ''}:${row?.created_at ?? row?.metadata?.timestamp ?? ''}`
}))
const reference = readJson(path.join(generatedRoot, 'mandarin-common-syllable-reference.json'))
const spokenQueue = readJson(path.join(evidenceRoot, 'mandarin-spoken-text-review-queue.json'))
const collectionEvidence = buildMandarinCollectionEvidence({ reference, spokenQueue, manifestRows })
writeJson(path.join(evidenceRoot, 'mandarin-collection-evidence.json'), collectionEvidence)

const recordingCorpora = [
  readJson(path.join(generatedRoot, 'mandarin-recording-core-gap-corpus.json')),
  readJson(path.join(generatedRoot, 'mandarin-recording-reinforcement-corpus.json')),
  readJson(path.join(generatedRoot, 'mandarin-recording-open-research-corpus.json')),
]
const recordingReadyEntries = recordingCorpora.flatMap((corpus) => corpus.items ?? [])
const recordingCoverage = {
  kind: 'voxflame_mandarin_coverage_audit',
  generated_at: new Date().toISOString(),
  reference: reference.source,
  interpretation: {
    complete_means: ['core initial and normalized final inventory', 'common-character syllable and syllable-tone baseline', 'citation tones, neutral tone, tone pairs and connected-speech phenomena', 'task and communication-scene coverage assessed separately from phonology'],
    does_not_mean: 'Every item appearing once. Presence and robust repeated coverage are reported separately.',
  },
  recording_ready_corpus: {
    quality: {
      corpus_files: recordingCorpora.length,
      items: recordingReadyEntries.length,
      unique_texts: new Set(recordingReadyEntries.map((entry) => String(entry.text ?? '').trim()).filter(Boolean)).size,
      explicit_target_items: recordingReadyEntries.filter((entry) => Array.isArray(entry.coverage_targets) && entry.coverage_targets.length > 0).length,
      source_files: recordingCorpora.map((corpus) => corpus.generated_from ?? corpus.kind),
    },
    coverage: auditEntries(recordingReadyEntries, reference),
  },
  collected_manifests: {
    quality: {
      manifest_files: manifestFiles.length,
      rows_before_recording_id_deduplication: manifestRows.length,
      unique_recordings: uniqueManifestRecordings.size,
      valid_audio_with_target: collectionEvidence.review.coverage_eligible_recordings,
    },
    collection_coverage: collectionEvidence.coverage.collected_audio_with_target,
  },
}
writeJson(path.join(evidenceRoot, 'mandarin-recording-ready-coverage.json'), recordingCoverage)

const split = buildMandarinSpeakerDisjointSplit({ rows: manifestRows })
const sourceHash = crypto.createHash('sha256')
for (const filePath of manifestFiles) sourceHash.update(fs.readFileSync(filePath))
split.input.source_manifest_count = manifestFiles.length
split.input.source_manifest_sha256 = sourceHash.digest('hex')
writeJson(path.join(evidenceRoot, 'mandarin-speaker-disjoint-split.json'), { ...split, split_rows: undefined })

const productStatus = buildCoverageProductStatus({
  ledger: readJson(path.join(generatedRoot, 'mandarin-coverage-target-ledger.json')),
  review: readJson(path.join(evidenceRoot, 'mandarin-core-gap-phase1-review.json')),
  approved: readJson(path.join(generatedRoot, 'mandarin-approved-core-gap-corpus.json')),
  reinforcement: readJson(path.join(generatedRoot, 'mandarin-below-minimum-reinforcement-plan.json')),
  recordingCoreGap: recordingCorpora[0],
  recordingReinforcement: recordingCorpora[1],
  recordingOpenResearch: recordingCorpora[2],
  collectionEvidence,
})
writeJson(path.join(generatedRoot, 'mandarin-coverage-product-status.json'), productStatus)

console.log(JSON.stringify({
  manifest_files: manifestFiles.length,
  manifest_rows: manifestRows.length,
  collection_eligible_recordings: collectionEvidence.review.coverage_eligible_recordings,
  explicit_recording_targets: collectionEvidence.coverage.collected_audio_with_target.coverage.explicit_recording_targets,
  recording_ready_items: recordingReadyEntries.length,
  speaker_split: split.split_summary,
  outputs: [
    'mandarin-collection-evidence.json',
    'mandarin-recording-ready-coverage.json',
    'mandarin-speaker-disjoint-split.json',
    'mandarin-coverage-product-status.json',
  ],
}, null, 2))
