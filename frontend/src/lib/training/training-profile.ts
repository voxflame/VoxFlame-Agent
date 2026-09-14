'use client'

import {
  DEFAULT_TRAINING_GUIDANCE_PROFILE,
  type TrainingGuidanceProfile,
} from '@/lib/training/training-guidance-profile'

export type TrainingFeedbackStatus = 'excellent' | 'close' | 'retry' | 'unclear'
export type ImprovementDirection = 'improving' | 'stable' | 'declining'

export interface LabelCount {
  label: string
  count: number
}

export interface TrainingProfileTrendPoint {
  date: string
  uploadedCount: number
  excellent: number
  close: number
  retry: number
  unclear: number
  avgClarityScore: number
}

export interface UploadedTrainingRecord {
  id: string
  exerciseId: string
  exerciseCategory: string
  exerciseText: string
  status: TrainingFeedbackStatus
  clarityScore: number
  durationSeconds: number
  focusTags: string[]
  speechPatterns: string[]
  articulationTips: string[]
  keywords?: string[]
  pronunciationSummary: string
  createdAt: number
}

export interface TrainingProfileSnapshot {
  generatedAt: number
  totalUploadedRecordings: number
  totalDurationSeconds: number
  currentTrainingStreak: number
  bestTrainingStreak: number
  rollingClarityAverage: number
  improvementSlope: number
  improvementDirection: ImprovementDirection
  totalConfusionPatterns: number
  statusCounts: Record<TrainingFeedbackStatus, number>
  dominantCategories: LabelCount[]
  frequentFocus: LabelCount[]
  frequentSpeechPatterns: LabelCount[]
  frequentConfusions: LabelCount[]
  articulationTips: LabelCount[]
  hotwords: string[]
  trends: TrainingProfileTrendPoint[]
  nextStep: string
  lastPronunciationSummary: string | null
  profileReady: boolean
  uploadsUntilReady: number
}

export interface TrainingProfileSyncCandidate {
  snapshot: TrainingProfileSnapshot
  shouldSyncSummary: boolean
}

interface StoredTrainingProfileState {
  records: UploadedTrainingRecord[]
  lastSyncedUploadCount: number
}

export interface TrainingProfileMemorySummary {
  content: string
  metadata: Record<string, unknown>
}

const STORAGE_PREFIX = 'voxflame_training_profile_'
const MAX_RECORDS = 400
export const MIN_TRAINING_UPLOADS_FOR_PROFILE = 12
export const TRAINING_PROFILE_SYNC_INTERVAL = 50

function createEmptyStatusCounts(): Record<TrainingFeedbackStatus, number> {
  return {
    excellent: 0,
    close: 0,
    retry: 0,
    unclear: 0,
  }
}

function getStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

function safeParseState(userId: string): StoredTrainingProfileState {
  if (typeof window === 'undefined') {
    return { records: [], lastSyncedUploadCount: 0 }
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId))
    if (!raw) {
      return { records: [], lastSyncedUploadCount: 0 }
    }

    const parsed = JSON.parse(raw) as Partial<StoredTrainingProfileState>
    const records = Array.isArray(parsed.records) ? parsed.records : []
    const lastSyncedUploadCount =
      typeof parsed.lastSyncedUploadCount === 'number' && Number.isFinite(parsed.lastSyncedUploadCount)
        ? parsed.lastSyncedUploadCount
        : 0

    return {
      records,
      lastSyncedUploadCount,
    }
  } catch {
    return { records: [], lastSyncedUploadCount: 0 }
  }
}

function saveState(userId: string, state: StoredTrainingProfileState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(state))
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildLinearSlope(values: number[]): number {
  if (values.length < 2) {
    return 0
  }

  const n = values.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0

  for (let index = 0; index < n; index += 1) {
    sumX += index
    sumY += values[index]
    sumXY += index * values[index]
    sumXX += index * index
  }

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) {
    return 0
  }

  return (n * sumXY - sumX * sumY) / denominator
}

function getImprovementDirection(slope: number): ImprovementDirection {
  if (slope >= 0.03) {
    return 'improving'
  }

  if (slope <= -0.03) {
    return 'declining'
  }

  return 'stable'
}

function countValues(values: string[], limit?: number): LabelCount[] {
  const counts = new Map<string, number>()

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) {
      continue
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  const items = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  return typeof limit === 'number' ? items.slice(0, limit) : items
}

function buildTrainingStreaks(records: UploadedTrainingRecord[]): {
  currentTrainingStreak: number
  bestTrainingStreak: number
} {
  const dayKeys = Array.from(new Set(records.map((record) => toDayKey(record.createdAt)))).sort()

  if (dayKeys.length === 0) {
    return {
      currentTrainingStreak: 0,
      bestTrainingStreak: 0,
    }
  }

  let bestTrainingStreak = 1
  let running = 1

  for (let index = 1; index < dayKeys.length; index += 1) {
    const previous = new Date(`${dayKeys[index - 1]}T00:00:00.000Z`).getTime()
    const current = new Date(`${dayKeys[index]}T00:00:00.000Z`).getTime()
    const diffDays = Math.round((current - previous) / 86_400_000)

    if (diffDays === 1) {
      running += 1
      bestTrainingStreak = Math.max(bestTrainingStreak, running)
    } else if (diffDays > 1) {
      running = 1
    }
  }

  const latestDay = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`).getTime()
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const latestGap = Math.round((todayUtc - latestDay) / 86_400_000)

  if (latestGap > 1) {
    return {
      currentTrainingStreak: 0,
      bestTrainingStreak,
    }
  }

  let currentTrainingStreak = 1
  for (let index = dayKeys.length - 1; index > 0; index -= 1) {
    const current = new Date(`${dayKeys[index]}T00:00:00.000Z`).getTime()
    const previous = new Date(`${dayKeys[index - 1]}T00:00:00.000Z`).getTime()
    const diffDays = Math.round((current - previous) / 86_400_000)

    if (diffDays === 1) {
      currentTrainingStreak += 1
      continue
    }

    break
  }

  return {
    currentTrainingStreak,
    bestTrainingStreak,
  }
}

function buildTrendPoints(records: UploadedTrainingRecord[]): TrainingProfileTrendPoint[] {
  const points = new Map<
    string,
    TrainingProfileTrendPoint & {
      clarityTotal: number
      claritySamples: number
    }
  >()

  for (const record of records) {
    const key = toDayKey(record.createdAt)
    const point = points.get(key) ?? {
      date: key,
      uploadedCount: 0,
      excellent: 0,
      close: 0,
      retry: 0,
      unclear: 0,
      avgClarityScore: 0,
      clarityTotal: 0,
      claritySamples: 0,
    }

    point.uploadedCount += 1
    point[record.status] += 1
    point.clarityTotal += record.clarityScore
    point.claritySamples += 1
    points.set(key, point)
  }

  return Array.from(points.values())
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 8)
    .map((point) => ({
      date: point.date,
      uploadedCount: point.uploadedCount,
      excellent: point.excellent,
      close: point.close,
      retry: point.retry,
      unclear: point.unclear,
      avgClarityScore: point.claritySamples > 0 ? point.clarityTotal / point.claritySamples : 0,
    }))
}

function buildNextStep(
  frequentSpeechPatterns: LabelCount[],
  frequentFocus: LabelCount[],
  articulationTips: LabelCount[],
  improvementDirection: ImprovementDirection,
): string {
  if (frequentSpeechPatterns[0]) {
    return `下一步先继续盯住“${frequentSpeechPatterns[0].label}”，先做短句重复，再回到整句。`
  }

  if (frequentFocus[0]) {
    return `下一步先围绕 ${frequentFocus[0].label} 做短句重复，不要同时改太多点。`
  }

  if (articulationTips[0]) {
    return `如果这条提示对你有帮助，可以参考：${articulationTips[0].label}`
  }

  if (improvementDirection === 'declining') {
    return '最近的自动文字波动较大，可以先回听最熟的一条句子，再决定是否继续练习。'
  }

  return '可以先选一条最常用的句子；每次先回听录音，再按自己的需要决定是否继续。'
}

function normalizeClarityScore(status: TrainingFeedbackStatus, clarityScore: number): number {
  if (Number.isFinite(clarityScore) && clarityScore > 0) {
    return Math.max(0, Math.min(1, clarityScore))
  }

  if (status === 'excellent') {
    return 0.95
  }

  if (status === 'close') {
    return 0.75
  }

  if (status === 'retry') {
    return 0.45
  }

  return 0.2
}

function buildSnapshot(records: UploadedTrainingRecord[]): TrainingProfileSnapshot {
  const normalizedRecords = [...records].sort((left, right) => right.createdAt - left.createdAt)
  const statusCounts = createEmptyStatusCounts()

  for (const record of normalizedRecords) {
    statusCounts[record.status] += 1
  }

  const dominantCategories = countValues(normalizedRecords.map((record) => record.exerciseCategory), 4)
  const frequentFocus = countValues(normalizedRecords.flatMap((record) => record.focusTags), 6)
  const frequentSpeechPatterns = countValues(
    normalizedRecords.flatMap((record) => [
      ...record.speechPatterns,
      ...record.articulationTips,
    ]),
    8,
  )
  const articulationTips = countValues(normalizedRecords.flatMap((record) => record.articulationTips), 6)
  const hotwords = countValues(
    normalizedRecords.flatMap((record) => record.keywords ?? []),
    12,
  ).map((item) => item.label)
  const frequentConfusions = countValues(
    normalizedRecords.flatMap((record) => [
      ...record.speechPatterns,
      ...record.articulationTips,
    ]),
    10,
  )
  const clarityScores = normalizedRecords
    .slice()
    .reverse()
    .map((record) => normalizeClarityScore(record.status, record.clarityScore))
  const recentScores = clarityScores.slice(-7)
  const rollingClarityAverage = average(recentScores)
  const improvementSlope = Number(buildLinearSlope(clarityScores.slice(-12)).toFixed(4))
  const improvementDirection = getImprovementDirection(improvementSlope)
  const { currentTrainingStreak, bestTrainingStreak } = buildTrainingStreaks(normalizedRecords)
  const nextStep = buildNextStep(
    frequentSpeechPatterns,
    frequentFocus,
    articulationTips,
    improvementDirection,
  )

  return {
    generatedAt: Date.now(),
    totalUploadedRecordings: normalizedRecords.length,
    totalDurationSeconds: normalizedRecords.reduce((sum, record) => sum + record.durationSeconds, 0),
    currentTrainingStreak,
    bestTrainingStreak,
    rollingClarityAverage,
    improvementSlope,
    improvementDirection,
    totalConfusionPatterns: frequentConfusions.length,
    statusCounts,
    dominantCategories,
    frequentFocus,
    frequentSpeechPatterns,
    frequentConfusions,
    articulationTips,
    hotwords,
    trends: buildTrendPoints(normalizedRecords),
    nextStep,
    lastPronunciationSummary: normalizedRecords[0]?.pronunciationSummary || null,
    profileReady: normalizedRecords.length >= MIN_TRAINING_UPLOADS_FOR_PROFILE,
    uploadsUntilReady: Math.max(0, MIN_TRAINING_UPLOADS_FOR_PROFILE - normalizedRecords.length),
  }
}

function buildSummaryContent(snapshot: TrainingProfileSnapshot): string {
  const dominantCategory = snapshot.dominantCategories[0]?.label || '常用句'
  const confusion = snapshot.frequentConfusions[0]?.label || '整句节奏'
  return `训练画像更新：累计上传 ${snapshot.totalUploadedRecordings} 条训练语料，当前主要覆盖 ${dominantCategory}；最值得先盯住的是 ${confusion}。`
}

function toSerializableLabelCounts(items: LabelCount[]): Array<{ label: string; count: number }> {
  return items.map((item) => ({
    label: item.label,
    count: item.count,
  }))
}

function buildSummaryMetadata(snapshot: TrainingProfileSnapshot): Record<string, unknown> {
  return {
    kind: 'training_profile_summary',
    total_training_uploads: snapshot.totalUploadedRecordings,
    total_training_duration_seconds: snapshot.totalDurationSeconds,
    current_training_streak: snapshot.currentTrainingStreak,
    best_training_streak: snapshot.bestTrainingStreak,
    rolling_clarity_average: snapshot.rollingClarityAverage,
    improvement_slope: snapshot.improvementSlope,
    improvement_direction: snapshot.improvementDirection,
    total_confusion_patterns: snapshot.totalConfusionPatterns,
    status_counts: snapshot.statusCounts,
    dominant_categories: toSerializableLabelCounts(snapshot.dominantCategories),
    frequent_focus: toSerializableLabelCounts(snapshot.frequentFocus),
    speech_patterns: toSerializableLabelCounts(snapshot.frequentSpeechPatterns),
    frequent_confusions: toSerializableLabelCounts(snapshot.frequentConfusions),
    articulation_tips: toSerializableLabelCounts(snapshot.articulationTips),
    hotwords: snapshot.hotwords,
    trends: snapshot.trends,
    next_step: snapshot.nextStep,
    last_pronunciation_summary: snapshot.lastPronunciationSummary,
    generated_at: snapshot.generatedAt,
  }
}

export function buildTrainingProfileMemorySummary(
  snapshot: TrainingProfileSnapshot,
): TrainingProfileMemorySummary {
  return {
    content: buildSummaryContent(snapshot),
    metadata: buildSummaryMetadata(snapshot),
  }
}

export function buildTrainingVoiceProfilePayload(
  snapshot: TrainingProfileSnapshot,
  guidanceProfile?: TrainingGuidanceProfile | null,
): Record<string, unknown> {
  const etiology =
    guidanceProfile?.etiology !== DEFAULT_TRAINING_GUIDANCE_PROFILE.etiology
      ? guidanceProfile?.etiology
      : undefined
  const severity =
    guidanceProfile?.severity !== DEFAULT_TRAINING_GUIDANCE_PROFILE.severity
      ? guidanceProfile?.severity
      : undefined

  return {
    hotwords: snapshot.hotwords.slice(0, 8).map((word) => ({
      word,
      category: 'daily',
    })),
    speech_patterns: snapshot.frequentSpeechPatterns.slice(0, 8).map((item) => ({
      label: item.label,
      count: item.count,
    })),
    clarity_score: snapshot.rollingClarityAverage,
    preferences: {
      training_profile_summary: buildSummaryMetadata(snapshot),
      dominant_training_categories: snapshot.dominantCategories.map((item) => item.label),
      training_data_volume: {
        uploaded_recordings: snapshot.totalUploadedRecordings,
        duration_seconds: snapshot.totalDurationSeconds,
      },
      next_training_step: snapshot.nextStep,
      ...(etiology
        ? {
            etiology,
          }
        : {}),
      ...(severity
        ? {
            severity,
          }
        : {}),
    },
  }
}

export function getTrainingProfileSnapshot(userId: string): TrainingProfileSnapshot {
  return buildSnapshot(safeParseState(userId).records)
}

export function getUploadedTrainingExerciseIds(userId: string): string[] {
  const seen = new Set<string>()
  const exerciseIds: string[] = []

  for (const record of safeParseState(userId).records) {
    const exerciseId = typeof record.exerciseId === 'string' ? record.exerciseId.trim() : ''
    if (!exerciseId || seen.has(exerciseId)) {
      continue
    }

    seen.add(exerciseId)
    exerciseIds.push(exerciseId)
  }

  return exerciseIds
}

export function appendUploadedTrainingRecord(
  userId: string,
  record: Omit<UploadedTrainingRecord, 'id' | 'createdAt'> & Partial<Pick<UploadedTrainingRecord, 'id' | 'createdAt'>>,
): TrainingProfileSyncCandidate {
  const current = safeParseState(userId)
  const nextRecord: UploadedTrainingRecord = {
    ...record,
    id: record.id || `${record.exerciseId}_${Date.now()}`,
    createdAt: record.createdAt ?? Date.now(),
  }

  const records = [nextRecord, ...current.records].slice(0, MAX_RECORDS)
  const nextState: StoredTrainingProfileState = {
    ...current,
    records,
  }

  saveState(userId, nextState)
  const snapshot = buildSnapshot(records)
  const shouldSyncSummary =
    snapshot.totalUploadedRecordings - current.lastSyncedUploadCount >= TRAINING_PROFILE_SYNC_INTERVAL

  return {
    snapshot,
    shouldSyncSummary,
  }
}

export function removeUploadedTrainingRecord(
  userId: string,
  recordId: string,
): TrainingProfileSnapshot {
  const current = safeParseState(userId)
  const records = current.records.filter((record) => record.id !== recordId)
  saveState(userId, {
    ...current,
    records,
    lastSyncedUploadCount: Math.min(current.lastSyncedUploadCount, records.length),
  })

  return buildSnapshot(records)
}

export function markTrainingProfileSummarySynced(
  userId: string,
  totalUploadedRecordings: number,
): void {
  const current = safeParseState(userId)
  saveState(userId, {
    ...current,
    lastSyncedUploadCount: Math.max(current.lastSyncedUploadCount, totalUploadedRecordings),
  })
}
