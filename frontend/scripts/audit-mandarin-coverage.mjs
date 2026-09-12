#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import { auditEntries } from './mandarin-coverage-core.mjs'
import { collectionEligibility } from './mandarin-collection-evidence-core.mjs'
import {
  reviewEntriesFromQueue,
  validateMandarinSpokenTextReviewQueue,
} from './mandarin-spoken-text-review-core.mjs'
import { resolveActiveRecordingManifestRows } from '../src/lib/corpus/recording-manifest-events.mjs'

function values(name) {
  return process.argv.flatMap((value, index) => value === name ? [process.argv[index + 1]] : []).filter(Boolean)
}

function value(name) {
  return values(name)[0]
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`)
      }
    })
}

function count(valuesToCount) {
  const result = {}
  for (const item of valuesToCount) result[item] = (result[item] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function corpusEntries(filePath) {
  if (!filePath) return []
  const payload = readJson(filePath)
  if (Array.isArray(payload.items)) return payload.items
  if (payload.categories) {
    return Object.values(payload.categories).flatMap((category) => category.items ?? [])
  }
  throw new Error(`unsupported corpus payload: ${filePath}`)
}

function manifestReport(paths) {
  const rows = resolveActiveRecordingManifestRows(paths.flatMap(readJsonl))
  const uniqueRows = new Map()
  for (const row of rows) {
    const key = row.recording_id ?? row.metadata?.recording_id ?? `${row.audio?.path}:${row.created_at}`
    if (!uniqueRows.has(key)) uniqueRows.set(key, row)
  }
  const deduped = [...uniqueRows.values()]
  const entries = deduped.flatMap((row) => {
    const text = row.prompt?.text ?? row.metadata?.target_text ?? row.metadata?.exercise_text
    return text ? [{ text, category: row.prompt?.category ?? row.metadata?.exercise_category ?? '未分区' }] : []
  })
  const eligibleRows = deduped.map((row) => ({ row, eligibility: collectionEligibility(row) }))
  const validAudioEntries = eligibleRows
    .filter(({ eligibility }) => eligibility.eligible)
    .map(({ eligibility }) => ({
      text: eligibility.target,
      category: eligibility.category,
      quality_status: eligibility.quality_status,
      coverage_targets: eligibility.coverage_targets,
      recording_readiness: 'ready_for_recording',
    }))
  const explicitSpokenText = deduped.filter((row) => typeof row.metadata?.spoken_text === 'string' && row.metadata.spoken_text.trim()).length
  const rawTranscript = deduped.filter((row) => typeof row.transcript?.raw === 'string' && row.transcript.raw.trim()).length
  const audioDurationMs = deduped.reduce((total, row) => total + Number(row.audio?.duration_ms ?? row.metadata?.duration_ms ?? 0), 0)
  const speakers = new Set(deduped.map((row) => row.user_id).filter(Boolean))
  const sessions = new Set(deduped.map((row) => row.session_id).filter(Boolean))

  return {
    entries,
    quality: {
      manifest_files: paths.length,
      rows_before_recording_id_deduplication: rows.length,
      unique_recordings: deduped.length,
      duplicate_rows: rows.length - deduped.length,
      anonymous_speaker_count: speakers.size,
      session_count: sessions.size,
      audio_hours: Number((audioDurationMs / 3_600_000).toFixed(3)),
      target_text_present: entries.length,
      target_text_present_ratio: ratio(entries.length, deduped.length),
      raw_asr_transcript_present: rawTranscript,
      raw_asr_transcript_present_ratio: ratio(rawTranscript, deduped.length),
      explicit_human_spoken_text_present: explicitSpokenText,
      explicit_human_spoken_text_present_ratio: ratio(explicitSpokenText, deduped.length),
      consent_scopes: count(deduped.map((row) => row.consent?.scope ?? row.metadata?.consent_scope ?? 'missing')),
      feedback_statuses: count(deduped.map((row) => row.evaluation?.clarity_signals?.feedback_status ?? row.metadata?.feedback_status ?? 'missing')),
      audio_quality_dispositions: count(deduped.map((row) => row.metadata?.audio_quality_disposition ?? 'missing')),
      capture_transports: count(deduped.map((row) => row.audio?.capture_transport ?? row.metadata?.capture_transport ?? 'missing')),
      categories: count(entries.map((entry) => entry.category)),
      valid_audio_with_target: validAudioEntries.length,
      collection_eligibility_rejections: count(
        eligibleRows.flatMap(({ eligibility }) => eligibility.reasons),
      ),
      quality_statuses: count(validAudioEntries.map((entry) => entry.quality_status)),
    },
    collectionCoverageEntries: validAudioEntries,
  }
}

function qualityStatus(row) {
  const metadata = row.metadata ?? {}
  const reasons = Array.isArray(metadata.audio_quality_reasons) ? metadata.audio_quality_reasons : []
  const errorTags = Array.isArray(row.evaluation?.error_tags) ? row.evaluation.error_tags : []
  if (reasons.includes('speech_too_short_or_too_quiet') || reasons.includes('input_level_quiet')) return 'unusable_audio'
  if (reasons.includes('too_much_silence') || Number(metadata.silence_ratio ?? 0) >= 0.72) return 'long_silence'
  if (errorTags.some((tag) => String(tag).startsWith('missing:'))) return 'suspected_omission'
  if (errorTags.some((tag) => String(tag).startsWith('extra:'))) return 'suspected_misread'
  return 'valid'
}

function modelManifestReport(paths) {
  const rows = paths.flatMap(readJsonl)
  const entries = rows.flatMap((row) => {
    const text = row.text ?? row.target ?? row.transcript ?? row.messages?.find?.((message) => message.role === 'assistant')?.content
    return typeof text === 'string' && text.trim()
      ? [{ text, category: row.source ?? row.dataset ?? row.task ?? 'model-training' }]
      : []
  })
  const stableIds = rows.map((row) => row.key ?? row.utt_id ?? row.id).filter(Boolean)
  const speakers = new Set(rows.map((row) => row.speaker ?? row.speaker_id ?? row.group).filter(Boolean))
  return {
    entries,
    quality: {
      manifest_files: paths.length,
      rows: rows.length,
      rows_with_text: entries.length,
      rows_with_text_ratio: ratio(entries.length, rows.length),
      stable_id_present: stableIds.length,
      stable_id_present_ratio: ratio(stableIds.length, rows.length),
      duplicate_stable_ids: stableIds.length - new Set(stableIds.map(String)).size,
      speaker_or_group_count: speakers.size,
      categories: count(entries.map((entry) => entry.category)),
    },
  }
}

const corpusPath = value('--corpus')
const referencePath = value('--reference')
const outputPath = value('--output')
const manifestPaths = values('--manifest')
const modelManifestPaths = values('--model-manifest')
const spokenReviewPaths = values('--spoken-review')
const recordingCorpusPaths = values('--recording-corpus')
const minimumHits = Number(value('--minimum-hits') ?? 20)

if (!referencePath || !outputPath || (!corpusPath && manifestPaths.length === 0 && modelManifestPaths.length === 0 && spokenReviewPaths.length === 0 && recordingCorpusPaths.length === 0)) {
  throw new Error('usage: audit-mandarin-coverage --reference <json> --output <json> [--corpus <json>] [--recording-corpus <json> ...] [--manifest <app-jsonl> ...] [--spoken-review <queue.json> ...] [--model-manifest <train-jsonl> ...] [--minimum-hits <n>]')
}

const reference = readJson(referencePath)
const report = {
  kind: 'voxflame_mandarin_coverage_audit',
  generated_at: new Date().toISOString(),
  reference: reference.source,
  interpretation: {
    complete_means: [
      'core initial and normalized final inventory',
      'common-character syllable and syllable-tone baseline',
      'citation tones, neutral tone, tone pairs and connected-speech phenomena',
      'task and communication-scene coverage assessed separately from phonology',
    ],
    does_not_mean: 'Every item appearing once. Presence and robust repeated coverage are reported separately.',
  },
}

if (corpusPath) {
  const entries = corpusEntries(corpusPath)
  report.prompt_corpus = auditEntries(entries, reference, { minimumHits })
}

if (recordingCorpusPaths.length > 0) {
  const entries = recordingCorpusPaths.flatMap(corpusEntries)
  report.recording_ready_corpus = {
    quality: {
      corpus_files: recordingCorpusPaths.length,
      items: entries.length,
      unique_texts: new Set(entries.map((entry) => String(entry.text ?? '').trim()).filter(Boolean)).size,
      explicit_target_items: entries.filter((entry) => Array.isArray(entry.coverage_targets) && entry.coverage_targets.length > 0).length,
      source_files: recordingCorpusPaths,
    },
    coverage: auditEntries(entries, reference, { minimumHits }),
  }
}

if (manifestPaths.length > 0) {
  const manifest = manifestReport(manifestPaths)
  report.collected_manifests = {
    quality: manifest.quality,
    coverage: auditEntries(manifest.entries, reference, { minimumHits }),
    collection_coverage: auditEntries(manifest.collectionCoverageEntries, reference, { minimumHits }),
  }
}

if (spokenReviewPaths.length > 0) {
  const queues = spokenReviewPaths.map((filePath) => readJson(filePath))
  const validation = queues.map(validateMandarinSpokenTextReviewQueue)
  const invalid = validation.flatMap((result, index) => result.valid ? [] : result.errors.map((error) => `${spokenReviewPaths[index]}: ${error}`))
  if (invalid.length > 0) {
    throw new Error(`invalid spoken_text review queue:\n${invalid.join('\n')}`)
  }
  const reviewedByRecording = new Map()
  for (const queue of queues) {
    for (const entry of reviewEntriesFromQueue(queue)) {
      if (entry.recording_id && !reviewedByRecording.has(entry.recording_id)) {
        reviewedByRecording.set(entry.recording_id, entry)
      }
    }
  }
  const entries = [...reviewedByRecording.values()]
  report.human_spoken_text_reviews = {
    quality: {
      queue_files: spokenReviewPaths.length,
      queue_items: queues.reduce((total, queue) => total + queue.items.length, 0),
      coverage_eligible_items: entries.length,
      duplicate_reviewed_recordings: queues.flatMap(reviewEntriesFromQueue).length - entries.length,
      training_import_allowed: false,
    },
    coverage: auditEntries(entries, reference, { minimumHits }),
  }
}

if (modelManifestPaths.length > 0) {
  const modelManifest = modelManifestReport(modelManifestPaths)
  report.model_manifests = {
    quality: modelManifest.quality,
    coverage: auditEntries(modelManifest.entries, reference, { minimumHits }),
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`wrote coverage audit to ${outputPath}`)
