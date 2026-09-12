import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import OSS from 'ali-oss'

import {
  activeManifestContainsRecording,
  assertSpeakerDisjoint,
  assignSpeakerDisjointSplits,
  evaluateTrainingExportCandidate,
  TRAINING_EXPORT_POLICY_VERSION,
  TRAINING_SNAPSHOT_SCHEMA_VERSION,
  TRAINING_SPEAKER_SPLIT_POLICY,
  type DatasetSplit,
  type TrainingExportContributionRow,
  type TrainingExportEligibleSample,
} from '../src/services/training-dataset-export.service'
import type { UploadObjectInspection } from '../src/services/upload-admission.service'
import { requireCurrentLegalConsent } from '../src/services/upload-admission.service'
import { resolveActiveManifestRows } from '../src/services/upload-artifact.service'

dotenv.config({ path: path.join(__dirname, '../.env') })

type JsonRecord = Record<string, unknown>

interface ScriptOptions {
  email?: string
  userId?: string
  limit: number
  outputDir?: string
  snapshotId?: string
}

interface SnapshotSampleRow {
  schema_version: string
  snapshot_id: string
  contribution_id: string
  recording_id: string
  speaker_id: string
  split: DatasetSplit
  audio: string
  target: string
  duration_ms: number
  format: string
  sample_rate: number | null
  channel_count: number | null
  file_size_bytes: number
  object_etag: string
  audio_sha256: string
  created_at: string
  labels: {
    condition: string | null
    etiology: string | null
    severity: string | null
    speech_variant: string | null
    dialect_name: string | null
    language_tag: string | null
  }
  lineage: {
    sentence_id: string | null
    exercise_id: string | null
    prompt_group_key: string | null
    prompt_fingerprint: string | null
    utterance_pair_id: string | null
    reading_article_id: string | null
    reading_article_version: string | null
    reading_segment_id: string | null
    source: string | null
  }
  admission: { version: string; verified_at: string }
  consent: { scope: string; version: string; accepted_at: string }
}

interface SnapshotRejectionRow {
  contribution_id: string
  recording_id: string | null
  speaker_id: string
  reasons: string[]
}

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = { limit: 500 }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--email' && next) {
      options.email = next
      index += 1
    } else if (arg === '--user-id' && next) {
      options.userId = next
      index += 1
    } else if (arg === '--limit' && next) {
      const parsed = Number(next)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
        throw new Error('--limit must be an integer between 1 and 100000')
      }
      options.limit = parsed
      index += 1
    } else if (arg === '--output-dir' && next) {
      options.outputDir = next
      index += 1
    } else if ((arg === '--snapshot-id' || arg === '--batch-id') && next) {
      options.snapshotId = next
      index += 1
    } else if (arg === '--include-pending') {
      throw new Error('--include-pending is no longer allowed: training export is fail closed')
    } else {
      throw new Error(`unknown or incomplete argument: ${arg}`)
    }
  }

  return options
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for training dataset export`)
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEtag(value: string | null): string | null {
  return value?.trim().replace(/^"|"$/g, '') || null
}

function stableSpeakerId(contributorId: string): string {
  return `spk_${createHash('sha256')
    .update(`voxflame-speaker-v1:${contributorId}`)
    .digest('hex')
    .slice(0, 24)}`
}

function buildJsonLines(rows: readonly unknown[]): string {
  return rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : ''
}

function parseJsonLines(content: string | null, sourcePath: string): JsonRecord[] {
  if (!content) return []
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      throw new Error(`invalid manifest JSONL at ${sourcePath}:${index + 1}`)
    }
    if (!isRecord(parsed)) {
      throw new Error(`invalid manifest object at ${sourcePath}:${index + 1}`)
    }
    return [parsed]
  })
}

function buildManifestIndex(rows: JsonRecord[]): JsonRecord[] {
  return resolveActiveManifestRows(rows)
}

function manifestContainsSample(rows: JsonRecord[], sample: TrainingExportEligibleSample): boolean {
  return activeManifestContainsRecording(rows, sample.recordingId, sample.audioPath)
}

function isOssNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.status === 404
    || error.statusCode === 404
    || error.code === 'NoSuchKey'
    || error.code === 'NoSuchObject'
}

async function inspectObject(client: OSS, objectPath: string): Promise<UploadObjectInspection | null> {
  try {
    const result = await client.head(objectPath)
    const headers = (result as {
      res?: { headers?: Record<string, string | number | string[] | undefined> }
    }).res?.headers ?? {}
    return {
      contentLength: Number(headers['content-length']),
      contentType: String(headers['content-type'] ?? '').trim(),
      etag: typeof headers.etag === 'string' ? headers.etag.trim() || null : null,
    }
  } catch (error: unknown) {
    if (isOssNotFoundError(error)) return null
    throw error
  }
}

async function readTextObject(client: OSS, objectPath: string): Promise<string | null> {
  try {
    const result = await client.get(objectPath)
    return Buffer.isBuffer(result.content)
      ? result.content.toString('utf8')
      : Buffer.from(result.content).toString('utf8')
  } catch (error: unknown) {
    if (isOssNotFoundError(error)) return null
    throw error
  }
}

async function resolveUserId(
  supabase: SupabaseClient,
  email: string,
): Promise<string | null> {
  let page = 1
  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const matched = data.users.find((user) => user.email === email)
    if (matched) return matched.id
    if (data.users.length < 200) return null
    page += 1
  }
  throw new Error('user lookup exceeded 10000 accounts; use --user-id')
}

async function readCurrentUserMetadata(
  supabase: SupabaseClient,
  contributorId: string,
): Promise<JsonRecord | null> {
  const { data, error } = await supabase.auth.admin.getUserById(contributorId)
  if (error) throw error
  if (!data.user) return null
  return isRecord(data.user.user_metadata) ? data.user.user_metadata : {}
}

async function fetchCandidateRows(
  supabase: SupabaseClient,
  contributorId: string | null,
  cutoff: string,
  limit: number,
): Promise<TrainingExportContributionRow[]> {
  const rows: TrainingExportContributionRow[] = []
  const pageSize = 500

  while (rows.length <= limit) {
    const offset = rows.length
    const end = offset + Math.min(pageSize, limit + 1 - offset) - 1
    let query = supabase
      .from('voice_contributions')
      .select('id, contributor_id, audio_path, transcript, sentence_id, duration_seconds, created_at, metadata')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, end)
    if (contributorId) query = query.eq('contributor_id', contributorId)

    const { data, error } = await query
    if (error) throw error
    const page = (data || []) as TrainingExportContributionRow[]
    rows.push(...page)
    if (page.length < end - offset + 1) break
  }

  return rows
}

function snapshotAudioPath(sample: TrainingExportEligibleSample, split: DatasetSplit): string {
  const extension = path.extname(sample.audioPath).toLowerCase()
  return path.posix.join('audio', split, stableSpeakerId(sample.contributorId), `${sample.recordingId}${extension}`)
}

function buildSnapshotSample(
  sample: TrainingExportEligibleSample,
  snapshotId: string,
  split: DatasetSplit,
): SnapshotSampleRow {
  const metadata = sample.metadata
  return {
    schema_version: TRAINING_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: snapshotId,
    contribution_id: sample.contributionId,
    recording_id: sample.recordingId,
    speaker_id: stableSpeakerId(sample.contributorId),
    split,
    audio: snapshotAudioPath(sample, split),
    target: sample.targetText,
    duration_ms: sample.durationMs,
    format: sample.format,
    sample_rate: sample.sampleRate,
    channel_count: sample.channelCount,
    file_size_bytes: sample.fileSizeBytes,
    object_etag: sample.objectEtag,
    audio_sha256: '',
    created_at: sample.createdAt,
    labels: {
      condition: readString(metadata, 'condition'),
      etiology: readString(metadata, 'etiology'),
      severity: readString(metadata, 'severity'),
      speech_variant: readString(metadata, 'speech_variant'),
      dialect_name: readString(metadata, 'dialect_name'),
      language_tag: readString(metadata, 'language_tag'),
    },
    lineage: {
      sentence_id: sample.sentenceId,
      exercise_id: readString(metadata, 'exercise_id'),
      prompt_group_key: readString(metadata, 'prompt_group_key'),
      prompt_fingerprint: readString(metadata, 'prompt_fingerprint'),
      utterance_pair_id: readString(metadata, 'utterance_pair_id'),
      reading_article_id: readString(metadata, 'reading_article_id'),
      reading_article_version: readString(metadata, 'reading_article_version'),
      reading_segment_id: readString(metadata, 'reading_segment_id'),
      source: readString(metadata, 'source'),
    },
    admission: { version: sample.admissionVersion, verified_at: sample.admissionVerifiedAt },
    consent: {
      scope: sample.consentScope,
      version: sample.consentVersion,
      accepted_at: sample.consentAcceptedAt,
    },
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const now = new Date()
  const snapshotId = options.snapshotId || `voxflame_training_${now.toISOString().replace(/[:.]/g, '-')}`
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) throw new Error('invalid snapshot id')

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const ossClient = new OSS({
    region: process.env.OSS_REGION?.trim() || 'oss-cn-hangzhou',
    accessKeyId: requireEnv('OSS_ACCESS_KEY_ID'),
    accessKeySecret: requireEnv('OSS_ACCESS_KEY_SECRET'),
    bucket: requireEnv('OSS_BUCKET'),
    secure: true,
  })

  let contributorId = options.userId || null
  if (!contributorId && options.email) {
    contributorId = await resolveUserId(supabase, options.email)
    if (!contributorId) throw new Error(`no user found for ${options.email}`)
  }

  const outputDir = path.resolve(options.outputDir || path.join('/tmp', snapshotId))
  const stagingDir = path.join(path.dirname(outputDir), `.${path.basename(outputDir)}.staging-${process.pid}`)
  if (await pathExists(outputDir)) throw new Error(`snapshot output already exists: ${outputDir}`)
  if (await pathExists(stagingDir)) throw new Error(`snapshot staging path already exists: ${stagingDir}`)
  await fs.mkdir(stagingDir, { recursive: true })

  try {
    const cutoff = now.toISOString()
    const rows = await fetchCandidateRows(supabase, contributorId, cutoff, options.limit)
    if (rows.length > options.limit) {
      throw new Error(
        `candidate scope exceeds --limit ${options.limit}; increase the explicit limit or filter one contributor`,
      )
    }
    const metadataByContributor = new Map<string, JsonRecord | null>()
    const manifestByContributor = new Map<string, JsonRecord[]>()
    const eligible: TrainingExportEligibleSample[] = []
    const rejected: SnapshotRejectionRow[] = []

    for (const row of rows) {
      if (!metadataByContributor.has(row.contributor_id)) {
        metadataByContributor.set(
          row.contributor_id,
          await readCurrentUserMetadata(supabase, row.contributor_id),
        )
      }
      if (!manifestByContributor.has(row.contributor_id)) {
        const manifestPath = `dataset/${row.contributor_id}/manifest.jsonl`
        manifestByContributor.set(
          row.contributor_id,
          buildManifestIndex(parseJsonLines(await readTextObject(ossClient, manifestPath), manifestPath)),
        )
      }
      const result = evaluateTrainingExportCandidate(
        row,
        await inspectObject(ossClient, row.audio_path),
        metadataByContributor.get(row.contributor_id),
      )
      if (
        result.eligible
        && manifestContainsSample(manifestByContributor.get(row.contributor_id)!, result.sample)
      ) {
        eligible.push(result.sample)
      } else {
        const metadata = isRecord(row.metadata) ? row.metadata : {}
        rejected.push({
          contribution_id: row.id,
          recording_id: readString(metadata, 'recording_id'),
          speaker_id: stableSpeakerId(row.contributor_id),
          reasons: result.eligible ? ['manifest_recording_not_active'] : result.reasons,
        })
      }
    }

    if (eligible.length === 0) {
      throw new Error(`no samples passed the training export gate (${rejected.length} rejected)`)
    }

    const assignments = assignSpeakerDisjointSplits(eligible.map((sample) => sample.contributorId))
    const snapshotRows = eligible.map((sample) => {
      const split = assignments.get(sample.contributorId)
      if (!split) throw new Error(`missing speaker split for ${sample.contributorId}`)
      return buildSnapshotSample(sample, snapshotId, split)
    }).sort((left, right) => (
      left.split.localeCompare(right.split)
      || left.speaker_id.localeCompare(right.speaker_id)
      || left.recording_id.localeCompare(right.recording_id)
    ))

    assertSpeakerDisjoint(snapshotRows.map((row) => ({
      contributorId: row.speaker_id,
      split: row.split,
    })))

    const eligibleByContribution = new Map(eligible.map((sample) => [sample.contributionId, sample]))
    for (const snapshotRow of snapshotRows) {
      const sample = eligibleByContribution.get(snapshotRow.contribution_id)
      if (!sample) throw new Error(`missing source sample ${snapshotRow.contribution_id}`)
      const currentManifest = buildManifestIndex(parseJsonLines(
        await readTextObject(ossClient, `dataset/${sample.contributorId}/manifest.jsonl`),
        `dataset/${sample.contributorId}/manifest.jsonl`,
      ))
      if (!manifestContainsSample(currentManifest, sample)) {
        throw new Error(`manifest recording changed during snapshot: ${sample.recordingId}`)
      }
      const localAudioPath = path.join(stagingDir, ...snapshotRow.audio.split('/'))
      await fs.mkdir(path.dirname(localAudioPath), { recursive: true })
      await ossClient.get(sample.audioPath, localAudioPath)
      const [downloaded, afterDownload] = await Promise.all([
        fs.stat(localAudioPath),
        inspectObject(ossClient, sample.audioPath),
      ])
      if (
        downloaded.size !== sample.fileSizeBytes
        || !afterDownload
        || afterDownload.contentLength !== sample.fileSizeBytes
        || normalizeEtag(afterDownload.etag) !== normalizeEtag(sample.objectEtag)
      ) {
        throw new Error(`audio object changed during snapshot: ${sample.recordingId}`)
      }
      snapshotRow.audio_sha256 = createHash('sha256')
        .update(await fs.readFile(localAudioPath))
        .digest('hex')
    }

    for (const currentContributorId of new Set(eligible.map((sample) => sample.contributorId))) {
      requireCurrentLegalConsent(await readCurrentUserMetadata(supabase, currentContributorId))
      const manifestPath = `dataset/${currentContributorId}/manifest.jsonl`
      const finalManifest = buildManifestIndex(parseJsonLines(
        await readTextObject(ossClient, manifestPath),
        manifestPath,
      ))
      for (const sample of eligible.filter((item) => item.contributorId === currentContributorId)) {
        if (!manifestContainsSample(finalManifest, sample)) {
          throw new Error(`manifest recording changed before snapshot publish: ${sample.recordingId}`)
        }
        const finalObject = await inspectObject(ossClient, sample.audioPath)
        if (
          !finalObject
          || finalObject.contentLength !== sample.fileSizeBytes
          || normalizeEtag(finalObject.etag) !== normalizeEtag(sample.objectEtag)
        ) {
          throw new Error(`audio object changed before snapshot publish: ${sample.recordingId}`)
        }
      }
    }

    const samplesContent = buildJsonLines(snapshotRows)
    const rejectionsContent = buildJsonLines(rejected)
    const splitContents = Object.fromEntries(
      (['train', 'validation', 'test'] as const).map((split) => [
        split,
        buildJsonLines(snapshotRows.filter((row) => row.split === split)),
      ]),
    ) as Record<DatasetSplit, string>
    const countLines = (content: string): number => content ? content.trimEnd().split('\n').length : 0
    const sha256Text = (content: string): string => createHash('sha256').update(content).digest('hex')
    const rejectionReasons = rejected.flatMap((row) => row.reasons).reduce<Record<string, number>>(
      (counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }),
      {},
    )
    const snapshot = {
      schema_version: TRAINING_SNAPSHOT_SCHEMA_VERSION,
      snapshot_id: snapshotId,
      created_at: cutoff,
      immutable: true,
      source: {
        table: 'voice_contributions',
        created_at_lte: cutoff,
        requested_limit: options.limit,
        contributor_filter: contributorId ? stableSpeakerId(contributorId) : null,
      },
      policy: {
        export_version: TRAINING_EXPORT_POLICY_VERSION,
        speaker_split: TRAINING_SPEAKER_SPLIT_POLICY,
      },
      counts: {
        candidates: rows.length,
        samples: snapshotRows.length,
        rejected: rejected.length,
        speakers: new Set(snapshotRows.map((row) => row.speaker_id)).size,
        samples_by_split: Object.fromEntries(
          Object.entries(splitContents).map(([split, content]) => [split, countLines(content)]),
        ),
        speakers_by_split: Object.fromEntries(
          (['train', 'validation', 'test'] as const).map((split) => [
            split,
            new Set(snapshotRows.filter((row) => row.split === split).map((row) => row.speaker_id)).size,
          ]),
        ),
      },
      totals: {
        duration_ms: snapshotRows.reduce((sum, row) => sum + row.duration_ms, 0),
        audio_bytes: snapshotRows.reduce((sum, row) => sum + row.file_size_bytes, 0),
      },
      hashes: {
        samples_jsonl_sha256: sha256Text(samplesContent),
        rejections_jsonl_sha256: sha256Text(rejectionsContent),
        train_jsonl_sha256: sha256Text(splitContents.train),
        validation_jsonl_sha256: sha256Text(splitContents.validation),
        test_jsonl_sha256: sha256Text(splitContents.test),
      },
      rejection_reasons: rejectionReasons,
    }

    await Promise.all([
      fs.writeFile(path.join(stagingDir, 'samples.jsonl'), samplesContent, { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(path.join(stagingDir, 'rejections.jsonl'), rejectionsContent, { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(path.join(stagingDir, 'train.jsonl'), splitContents.train, { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(path.join(stagingDir, 'validation.jsonl'), splitContents.validation, { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(path.join(stagingDir, 'test.jsonl'), splitContents.test, { encoding: 'utf8', flag: 'wx' }),
      fs.writeFile(path.join(stagingDir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
    ])
    await fs.rename(stagingDir, outputDir)

    console.log(
      `[export_audio_target_dataset] snapshot=${snapshotId} samples=${snapshotRows.length} rejected=${rejected.length} speakers=${snapshot.counts.speakers} outputDir=${outputDir}`,
    )
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[export_audio_target_dataset] failed:', message)
  process.exit(1)
})
