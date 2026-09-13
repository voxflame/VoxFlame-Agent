'use client'

import { readDialectProfiles, type DialectProfile } from '@/lib/auth/dialect-profile'

import Link from 'next/link'
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Mic,
  PlayCircle,
  RotateCcw,
  Sparkles,
  UploadCloud,
  Volume2,
} from 'lucide-react'
import { MicrophoneInputFeedback } from '@/components/runtime/MicrophoneInputFeedback'
import { SiteBrandMark } from '@/components/branding/SiteBrandMark'
import { RecordingDurationSummary } from '@/components/recording/RecordingDurationSummary'
import { useAuth } from '@/hooks/useAuth'
import { useMandarinTrainingSession } from '@/hooks/useMandarinTrainingSession'
import { useRecordingProgress } from '@/hooks/useRecordingProgress'
import { useWorkspaceMemorySnapshot } from '@/hooks/useWorkspaceMemorySnapshot'
import { type UploadReceipt, useVoiceUpload } from '@/hooks/useVoiceUpload'
import {
  savePreparedExpressionAsset,
} from '@/lib/memory/workspace-client'
import {
  LEGAL_CONSENT_VERSION,
  hasRequiredLegalConsent,
} from '@/lib/auth/legal-consent'
import {
  MANDARIN_TRAINING_CATEGORIES,
  MANDARIN_TRAINING_CATEGORY_META,
  type MandarinTrainingExercise,
  getExercisesByCategory,
} from '@/lib/corpus/mandarin-training'
import { cn } from '@/lib/utils'
import { getSiteBrand } from '@/lib/site-branding'
import type {
  VoxFlameConsentScope,
  VoxFlameRecordingEnvelope,
} from '@/lib/recording/recording-contract'
import {
  getCollectionPlan,
  getCollectionPlanIdForTopic,
  isCollectionPreflightReady,
  type CollectionPlanId,
} from '@/lib/recording/collection-protocol'
import {
  MANDARIN_ARTICULATION_BASELINE_VERSION,
} from '@/lib/corpus/mandarin-training-data/articulation-baseline'
import {
  type MandarinTrainingFeedback,
  analyzeMandarinAttempt,
} from '@/lib/training/mandarin-feedback'
import { mergeCaptureBoundResult } from '@/lib/training/final-transcript'
import {
  appendUploadedTrainingRecord,
  getUploadedTrainingExerciseIds,
  removeUploadedTrainingRecord,
} from '@/lib/training/training-profile'
import {
  buildPreparedExpressionPracticeExercises,
  type PreparedExpressionPracticeExercise,
} from '@/lib/training/prepared-expression-practice'
import {
  getTrainingTopicHref,
  getTrainingTopicIdForCategory,
  resolveTrainingTopicSelection,
  type TrainingTopicId,
} from '@/lib/training/training-topic-route'
import {
  assessTrainingSampleQuality,
  type TrainingSampleQuality,
} from '@/lib/training/training-sample-quality'
import { getNextExerciseAfterAcceptedRecording } from '@/lib/training/training-attempt-navigation'
import {
  buildSpeechVariantMetadata,
  createUtterancePairId,
  shouldOfferDialectPair,
  type DialectCollectionTarget,
  type TrainingSpeechVariant,
} from '@/lib/training/dialect-collection'
import { shouldDisableTrainingRecordingControl } from '@/lib/training/training-recording-control'
import {
  calculateCharacterEditDistance,
  summarizeArticulationBaseline,
} from '@/lib/training/articulation-baseline-report'
import {
  DEFAULT_TRAINING_GUIDANCE_PROFILE,
  type TrainingSeverity,
} from '@/lib/training/training-guidance-profile'
import { buildTrainingSampleLineage } from '@/lib/training/training-sample-lineage'
import { selectTrainingExercises } from '@/lib/training/training-exercise-selection'
import {
  planTrainingAttemptReplacement,
  type TrainingAttemptUploadStatus,
} from '@/lib/training/training-attempt-replacement'
import {
  PHONOLOGY_GROUPS,
  MANDARIN_COVERAGE_PRODUCT_STATUS,
  DEFAULT_PHONOLOGY_GROUP_ID,
  filterExercisesByPhonologyGroup,
  getPhonologyExerciseTargets,
  getPhonologyFocusForGroup,
  getPhonologyGroupMeta,
  type PhonologyGroupId,
} from '@/lib/training/phonology-groups'
import type { WorkspaceMemorySnapshot } from '@/lib/memory/workspace-snapshot'
import type { MandarinReadingArticle } from '@/lib/corpus/reading-articles'
import { shouldBlockTrainingPageForProgress } from '@/lib/training/training-page-loading'

const siteBrand = getSiteBrand()

type AttemptSaveTrigger = 'auto' | 'manual'
type CollectionFlowStep = 'prepare' | 'record' | 'review'
type ExerciseStatusFilter = 'unread' | 'read' | 'all'

type PracticeSourceMode = 'prepared_content' | 'sentence_corpus'
type PracticeExercise = MandarinTrainingExercise | PreparedExpressionPracticeExercise

interface TrainingUploadLabels {
  disabilityCategory?: string
  condition?: string
  etiology?: string
  severity?: TrainingSeverity
  hasDialect?: boolean
  dialectName?: string
  dialectRegion?: string
}

interface PracticeAttempt {
  createdAt: number
  clientCaptureId: string
  exercise: PracticeExercise
  transcript: string
  transcriptStatus: 'pending' | 'complete'
  transcriptLatencyMs: number
  feedback: MandarinTrainingFeedback
  sampleQuality: TrainingSampleQuality
  readingAssistanceUsed: boolean
  recording: VoxFlameRecordingEnvelope | null
  uploadStatus: TrainingAttemptUploadStatus
  uploadReceipt: UploadReceipt | null
  speechVariant: TrainingSpeechVariant
  utterancePairId?: string
  dialect?: DialectProfile
}

interface NoticeState {
  tone: 'info' | 'success' | 'error'
  message: string
}

interface TrainingSummaryWindowView {
  summary: string
  sampleCount: number
  mismatchPairs: Array<{
    target: string
    heard: string
    occurrenceCount: number
  }>
  nextFocus: string[]
  stableWins: string[]
  pronunciationPatterns: string[]
  supportStrategies: string[]
  generatedAt: string
}

interface TrainingReportsView {
  dailySummary: TrainingSummaryWindowView | null
  weeklySummary: TrainingSummaryWindowView | null
}

type TrainingActivitySnapshot = WorkspaceMemorySnapshot['training_activity']

const DEFAULT_VISIBLE_SENTENCES = 60
const SEARCH_VISIBLE_SENTENCES = 80

const UPLOAD_STATUS_LABELS: Record<TrainingAttemptUploadStatus, string> = {
  idle: '这条录音还没进入保存流程',
  saving: '正在自动保存',
  uploaded: '已写入训练语料',
  local_only: '已安全保存在本机',
  auth_required: '需要重新登录恢复自动保存',
  failed: '保存失败',
  discarding: '正在撤回收录',
  discarded: '已不收录',
}

function dedupeStrings(values: Array<string | null | undefined>, limit?: number): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  values.forEach((value) => {
    if (typeof value !== 'string') {
      return
    }

    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    results.push(normalized)
  })

  return typeof limit === 'number' ? results.slice(0, limit) : results
}

function isPreparedExpressionExercise(
  exercise: PracticeExercise | null | undefined,
): exercise is PreparedExpressionPracticeExercise {
  return Boolean(
    exercise &&
    'practiceSource' in exercise &&
    exercise.practiceSource === 'prepared_expression',
  )
}

function getClarityScore(status: MandarinTrainingFeedback['status']): number {
  if (status === 'excellent') {
    return 0.95
  }

  if (status === 'close') {
    return 0.78
  }

  if (status === 'retry') {
    return 0.48
  }

  return 0.2
}

function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '')
}

function buildUploadMetadata(
  exercise: PracticeExercise,
  recording: VoxFlameRecordingEnvelope,
  transcript: string,
  feedback: MandarinTrainingFeedback,
  sampleQuality: TrainingSampleQuality,
  readingAssistanceUsed: boolean,
  uploadLabels?: TrainingUploadLabels | null,
  collectionPlanId?: CollectionPlanId,
  readingArticle?: MandarinReadingArticle | null,
  readingRoundId?: string | null,
  speechVariant: TrainingSpeechVariant = 'mandarin',
  utterancePairId?: string,
): Record<string, unknown> {
  const lineage = buildTrainingSampleLineage(exercise, recording)
  const metadata: Record<string, unknown> = {
    kind: 'training_result',
    // The model-facing labels stay deliberately small. These lineage fields
    // only support exact retry de-duplication and are not training features.
    sentence_id: exercise.id,
    exercise_id: exercise.id,
    exercise_category: exercise.category,
    target_text: exercise.text,
    ...(exercise.coverage_targets && exercise.coverage_targets.length > 0
      ? { pronunciation_targets: exercise.coverage_targets }
      : {}),
    spoken_text: transcript,
    feedback_status: feedback.status,
    clarity_score: getClarityScore(feedback.status),
    alignment_score: sampleQuality.score,
    missing_chars: feedback.missingChars,
    extra_chars: feedback.extraChars,
    speech_patterns: feedback.speechPatterns,
    articulation_tips: feedback.articulationTips,
    pronunciation_summary: feedback.pronunciationSummary,
    prompt_group_key: lineage.promptGroupKey,
    prompt_fingerprint: lineage.promptFingerprint,
    recording_dedupe_key: lineage.recordingDedupeKey,
    consent_version: LEGAL_CONSENT_VERSION,
    collection_plan_id: collectionPlanId,
    ...(collectionPlanId === 'mandarin_articulation_baseline'
      ? {
          baseline_protocol: 'mandarin_articulation_baseline',
          baseline_protocol_version: MANDARIN_ARTICULATION_BASELINE_VERSION,
        }
      : {}),
    reading_assistance_used: readingAssistanceUsed,
    ...buildSpeechVariantMetadata({
      speechVariant,
      utterancePairId,
      dialectName: uploadLabels?.dialectName,
      dialectRegion: uploadLabels?.dialectRegion,
    }),
  }

  if (readingArticle) {
    const segment = readingArticle.segments.find((item) => item.id === exercise.id)
    if (segment) {
      metadata.reading_material_kind = readingArticle.source.kind
      metadata.reading_article_id = readingArticle.id
      metadata.reading_article_version = readingArticle.version
      metadata.reading_segment_id = segment.id
      metadata.reading_segment_index = segment.index
      metadata.reading_segment_count = readingArticle.segments.length
      if (readingRoundId) {
        metadata.reading_round_id = readingRoundId
      }
    }
  }

  if (uploadLabels?.disabilityCategory) {
    metadata.disability_category = uploadLabels.disabilityCategory
  }
  if (uploadLabels?.condition) {
    metadata.condition = uploadLabels.condition
  }
  if (uploadLabels?.etiology && uploadLabels.etiology !== DEFAULT_TRAINING_GUIDANCE_PROFILE.etiology) {
    metadata.etiology = uploadLabels.etiology
  }

  if (uploadLabels?.severity && uploadLabels.severity !== DEFAULT_TRAINING_GUIDANCE_PROFILE.severity) {
    metadata.severity = uploadLabels.severity
  }
  for (const key of Object.keys(metadata)) {
    const value = metadata[key]
    if (Array.isArray(value) && value.length === 0) {
      delete metadata[key]
      continue
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      delete metadata[key]
    }
  }

  return metadata
}

function buildUploadedTrainingRecord(attempt: PracticeAttempt) {
  if (!attempt.recording) {
    return null
  }

  return {
    id: attempt.recording.recordingId,
    createdAt: new Date(attempt.recording.createdAt).getTime(),
    exerciseId: attempt.exercise.id,
    exerciseCategory: attempt.exercise.category,
    exerciseText: attempt.exercise.text,
    status: attempt.feedback.status,
    clarityScore: getClarityScore(attempt.feedback.status),
    durationSeconds: attempt.recording.audio.durationSeconds,
    focusTags: isPreparedExpressionExercise(attempt.exercise)
      ? [attempt.exercise.preparedExpressionSectionTitle, attempt.exercise.category]
      : [attempt.exercise.category],
    speechPatterns: attempt.feedback.speechPatterns,
    articulationTips: attempt.feedback.articulationTips,
    keywords: isPreparedExpressionExercise(attempt.exercise)
      ? attempt.exercise.preparedExpressionKeywords
      : undefined,
    pronunciationSummary: attempt.feedback.pronunciationSummary,
  }
}

function getRecorderStatusCopy(
  status: ReturnType<typeof useMandarinTrainingSession>['status'],
  sessionError: string | null,
  isArticulationBaseline: boolean = false,
): { label: string; description: string } {
  if (status === 'recording') {
    return {
      label: '正在录音',
      description: isArticulationBaseline
        ? '把当前字说完整，尾音稍微留半拍。'
        : '按正常节奏读完这句，然后点击停止。',
    }
  }

  if (status === 'processing') {
    return {
      label: '正在收结果',
      description: '正在整理这次录音。',
    }
  }

  if (status === 'ready') {
    return {
      label: '可以开始',
      description: isArticulationBaseline ? '点一次录音，读完当前字就停。' : '选好主题后，点一次录音就行。',
    }
  }

  if (status === 'connecting') {
    return {
      label: '正在连接',
      description: '正在准备麦克风。',
    }
  }

  if (status === 'error') {
    return {
      label: '需要处理',
      description: sessionError || '暂时无法开始，请重试。',
    }
  }

  return {
    label: '等待开始',
    description: isArticulationBaseline
      ? '准备好后直接从当前字开始。'
      : '先选一个训练主题，系统会给出当前要练的句子。',
  }
}

function getBaselineTranscriptNotice(
  transcript: string,
  hasRecording: boolean,
  transcriptStatus: PracticeAttempt['transcriptStatus'] = 'complete',
): {
  heardText: string
  helperText: string
  tone: 'sky' | 'amber'
} {
  if (transcriptStatus === 'pending') {
    return {
      heardText: '正在后台完成识别…',
      helperText: '录音已经收下，你可以继续操作，不需要等待识别完成。',
      tone: 'sky',
    }
  }

  if (transcript.trim()) {
    return {
      heardText: transcript,
      helperText: '识别完成，可以查看系统听到的内容。',
      tone: 'sky',
    }
  }

  if (hasRecording) {
    return {
      heardText: '录音已保存，但识别结果不完整。',
      helperText: '这不等于没录到声音。把字说慢一点，尾音留完整，再录一次更稳。',
      tone: 'amber',
    }
  }

  return {
    heardText: '这次还没有拿到可用录音。',
    helperText: '先确认浏览器麦克风权限，再重新录一遍。',
    tone: 'amber',
  }
}

function renderChips(
  items: string[],
  tone: 'stone' | 'amber' | 'sky' | 'emerald' = 'stone',
) {
  const toneClasses: Record<typeof tone, string> = {
    stone: 'bg-stone-100 text-stone-700',
    amber: 'bg-amber-100 text-amber-800',
    sky: 'bg-sky-100 text-sky-800',
    emerald: 'bg-emerald-100 text-emerald-800',
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full px-3 py-1 text-xs font-medium ${toneClasses[tone]}`}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function renderYesterdayTopContributors(activity: TrainingActivitySnapshot | null | undefined) {
  const topContributors = activity?.yesterday.top_contributors ?? []

  if (!topContributors.length) {
    return (
      <p className="text-sm leading-6 text-gray-600">
        昨天还没有可展示的训练记录。
      </p>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {topContributors.map((item) => (
        <div
          key={item.rank}
          className="rounded-[18px] bg-white px-4 py-3 ring-1 ring-stone-200"
        >
          <p className="text-sm font-medium text-gray-900">第 {item.rank} 名</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{item.recording_count} 句</p>
        </div>
      ))}
    </div>
  )
}

function mapTrainingReports(
  reports: {
    daily_summary: {
      summary: string
      sampleCount?: number
      sample_count?: number
      mismatchPairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      mismatch_pairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      nextFocus?: string[]
      next_focus?: string[]
      stableWins?: string[]
      stable_wins?: string[]
      pronunciationPatterns?: string[]
      pronunciation_patterns?: string[]
      supportStrategies?: string[]
      support_strategies?: string[]
      generated_at: string
    } | null
    weekly_summary: {
      summary: string
      sampleCount?: number
      sample_count?: number
      mismatchPairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      mismatch_pairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      nextFocus?: string[]
      next_focus?: string[]
      stableWins?: string[]
      stable_wins?: string[]
      pronunciationPatterns?: string[]
      pronunciation_patterns?: string[]
      supportStrategies?: string[]
      support_strategies?: string[]
      generated_at: string
    } | null
  } | null | undefined,
): TrainingReportsView | null {
  if (!reports) {
    return null
  }

  const mapWindow = (
    windowSummary: {
      summary: string
      sampleCount?: number
      sample_count?: number
      mismatchPairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      mismatch_pairs?: Array<{ target: string; heard: string; occurrenceCount: number }>
      nextFocus?: string[]
      next_focus?: string[]
      stableWins?: string[]
      stable_wins?: string[]
      pronunciationPatterns?: string[]
      pronunciation_patterns?: string[]
      supportStrategies?: string[]
      support_strategies?: string[]
      generated_at: string
    } | null,
  ): TrainingSummaryWindowView | null => {
    if (!windowSummary) {
      return null
    }

    return {
      summary: windowSummary.summary,
      sampleCount: windowSummary.sampleCount ?? windowSummary.sample_count ?? 0,
      mismatchPairs: windowSummary.mismatchPairs ?? windowSummary.mismatch_pairs ?? [],
      nextFocus: windowSummary.nextFocus ?? windowSummary.next_focus ?? [],
      stableWins: windowSummary.stableWins ?? windowSummary.stable_wins ?? [],
      pronunciationPatterns:
        windowSummary.pronunciationPatterns ?? windowSummary.pronunciation_patterns ?? [],
      supportStrategies:
        windowSummary.supportStrategies ?? windowSummary.support_strategies ?? [],
      generatedAt: windowSummary.generated_at,
    }
  }

  return {
    dailySummary: mapWindow(reports.daily_summary),
    weeklySummary: mapWindow(reports.weekly_summary),
  }
}

export default function ContributePage() {
  const { userId, isLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: '/contribute',
  })
  const { snapshot: workspaceSnapshot } = useWorkspaceMemorySnapshot({
    userId,
    isAuthenticated,
  })
  const { localQueueItems } = useVoiceUpload()
  const recordingProgress = useRecordingProgress(userId, isAuthenticated, localQueueItems)

  const preparedExpression = workspaceSnapshot?.prepared_expression ?? null
  const preparedExpressionExercises = useMemo(
    () => buildPreparedExpressionPracticeExercises(preparedExpression),
    [preparedExpression],
  )
  const trainingReports = useMemo(
    () => mapTrainingReports(workspaceSnapshot?.prepared_expression?.training_reports),
    [workspaceSnapshot?.prepared_expression?.training_reports],
  )
  const trainingActivity = workspaceSnapshot?.training_activity ?? null

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50">
        <div className="text-center text-sm text-gray-600">正在准备训练页...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <Link href="/practice" className="inline-flex min-h-11 items-center text-sm font-medium text-amber-700 hover:text-amber-800">
              ← 返回练习选择
            </Link>
            <h1 className="text-balance text-2xl font-semibold text-gray-900">录下你真正会说的话</h1>
            <p className="mt-1 text-sm text-gray-600 text-pretty">选择一种方式开始。</p>
          </div>
          <SiteBrandMark brand={siteBrand} compact />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8">
        <RecordingDurationSummary
          todayDurationSeconds={recordingProgress.todayDurationSeconds}
          totalDurationSeconds={recordingProgress.totalDurationSeconds}
          pendingUploadCount={recordingProgress.pendingUploadCount}
          isLoading={recordingProgress.isLoading}
          error={recordingProgress.error}
        />
        <section id="training-topics" className="scroll-mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href={preparedExpression ? getTrainingTopicHref('custom-material') : `${getTrainingTopicHref('custom-material')}?new=1`}
              className="group flex min-h-36 items-center justify-between gap-5 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                  <FileText className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-balance text-xl font-semibold text-stone-950">用自己的材料</span>
                  {preparedExpression ? (
                    <span className="mt-1 block truncate text-sm text-stone-500">《{preparedExpression.title}》</span>
                  ) : null}
                </span>
              </span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 group-hover:bg-amber-100 group-hover:text-amber-800">
                <ChevronRight className="size-5" aria-hidden="true" />
              </span>
            </Link>

            <Link
              href="/contribute/materials"
              className="group flex min-h-36 items-center justify-between gap-5 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <span className="min-w-0">
                <span className="block text-balance text-xl font-semibold text-stone-950">选择已有材料</span>
                <span className="mt-1 block text-sm text-stone-500 tabular-nums">9 个材料区</span>
              </span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 group-hover:bg-amber-100 group-hover:text-amber-800">
                <ChevronRight className="size-5" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </section>

        <details className="rounded-2xl border border-stone-200 bg-white">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500">
            <span>训练回顾</span>
            <span className="text-xs font-normal text-stone-500">今日、7 天与匿名活动</span>
          </summary>
          <div className="space-y-4 border-t border-stone-200 p-5 sm:p-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl bg-amber-50 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-amber-950">今日总结</h3>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-800">
                    {trainingReports?.dailySummary ? `${trainingReports.dailySummary.sampleCount} 条` : '待生成'}
                  </span>
                </div>
                <p className="mt-3 text-pretty text-sm leading-7 text-stone-700">
                  {trainingReports?.dailySummary?.summary ?? '今天还没有总结，先选一个主题录第一句。'}
                </p>
              </section>
              <section className="rounded-2xl bg-stone-100 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-stone-950">最近 7 天</h3>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-700">
                    {trainingReports?.weeklySummary ? `${trainingReports.weeklySummary.sampleCount} 条` : '待生成'}
                  </span>
                </div>
                <p className="mt-3 text-pretty text-sm leading-7 text-stone-700">
                  {trainingReports?.weeklySummary?.summary ?? '最近 7 天的稳定规律会在训练积累后自动更新。'}
                </p>
              </section>
            </div>
            <section className="rounded-2xl border border-stone-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-stone-950">昨日匿名活动</h3>
                  <p className="mt-1 text-pretty text-sm text-stone-600">只展示匿名名次和录音条数，不展示账号信息。</p>
                </div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-700">
                  昨天共 {trainingActivity?.yesterday.total_recordings ?? 0} 句
                </span>
              </div>
              <div className="mt-4">{renderYesterdayTopContributors(trainingActivity)}</div>
            </section>
          </div>
        </details>
      </main>
    </div>
  )
}

export function TrainingRecorderPage({
  topicId,
  wantsNewMaterial = false,
  exerciseOverride,
  readingArticle = null,
  allowRecordedExercises = false,
  readingRoundId = null,
  returnHrefOverride,
  returnLabelOverride,
  nextPathOverride,
}: {
  topicId: TrainingTopicId
  wantsNewMaterial?: boolean
  exerciseOverride?: MandarinTrainingExercise[]
  readingArticle?: MandarinReadingArticle | null
  allowRecordedExercises?: boolean
  readingRoundId?: string | null
  returnHrefOverride?: string
  returnLabelOverride?: string
  nextPathOverride?: string
}) {
  const topicSelection = useMemo(
    () => resolveTrainingTopicSelection(topicId),
    [topicId],
  )
  const returnHref = returnHrefOverride
    ?? (topicId === 'articulation-baseline' ? '/practice' : '/contribute')
  const returnLabel = returnLabelOverride
    ?? (topicId === 'articulation-baseline' ? '返回练习选择' : '返回主题选择')
  const { user, userId, session, isLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: nextPathOverride ?? (wantsNewMaterial
      ? `${getTrainingTopicHref(topicId)}?new=1`
      : getTrainingTopicHref(topicId)),
  })
  const {
    status,
    interimText,
    error: sessionError,
    isRecording,
    isProcessing,
    analyser,
    startRecording,
    stopRecording,
    disconnect,
  } = useMandarinTrainingSession({
    userId: userId ?? undefined,
    accessToken: session?.access_token,
    shortUtteranceMode: topicSelection.category === '普通话构音基线',
  })
  const {
    uploadRecording,
    discardUploadedRecording,
    refreshLocalQueueCount,
    localQueueItems,
  } = useVoiceUpload()
  const recordingProgress = useRecordingProgress(userId, isAuthenticated, localQueueItems)
  const {
    snapshot: workspaceSnapshot,
    refresh: refreshWorkspaceSnapshot,
  } = useWorkspaceMemorySnapshot({
    userId,
    isAuthenticated,
  })

  const [selectedExerciseId, setSelectedExerciseId] = useState(
    '',
  )
  const [exerciseStatusFilter, setExerciseStatusFilter] = useState<ExerciseStatusFilter>('unread')
  const [visibleInventoryLimit, setVisibleInventoryLimit] = useState(DEFAULT_VISIBLE_SENTENCES)
  const [selectedPhonologyGroupId, setSelectedPhonologyGroupId] = useState<PhonologyGroupId>(
    topicSelection.category === '音系强化' ? DEFAULT_PHONOLOGY_GROUP_ID : 'all',
  )
  const [exerciseQuery, setExerciseQuery] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [sessionPracticedExerciseIds, setSessionPracticedExerciseIds] = useState<string[]>([])
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null)
  const [baselineAttemptsByExercise, setBaselineAttemptsByExercise] = useState<
    Record<string, PracticeAttempt>
  >({})
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [isPreparedPreviewOpen, setIsPreparedPreviewOpen] = useState(false)
  const [attemptPlaybackUrl, setAttemptPlaybackUrl] = useState<string | null>(null)
  const [environmentReady, setEnvironmentReady] = useState(false)
  const [distanceReady, setDistanceReady] = useState(false)
  const [collectionFlowStep, setCollectionFlowStep] = useState<CollectionFlowStep>('prepare')
  const [pendingDialectTarget, setPendingDialectTarget] = useState<DialectCollectionTarget<PracticeExercise> | null>(null)
  const [isReplacingAttempt, setIsReplacingAttempt] = useState(false)
  const [isMaterialEditorOpen, setIsMaterialEditorOpen] = useState(wantsNewMaterial)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialContent, setMaterialContent] = useState('')
  const [materialSource, setMaterialSource] = useState('manual_input')
  const [materialStatus, setMaterialStatus] = useState<string | null>(null)
  const [isSavingMaterial, setIsSavingMaterial] = useState(false)
  const [isReadingAssistancePlaying, setIsReadingAssistancePlaying] = useState(false)
  const [readingAssistanceStatus, setReadingAssistanceStatus] = useState<string | null>(null)

  const disconnectRef = useRef(disconnect)
  disconnectRef.current = disconnect
  const discardedAttemptIdsRef = useRef<Set<number>>(new Set())
  const pendingReplacementExerciseRef = useRef<DialectCollectionTarget<PracticeExercise> | null>(null)
  const recordingExerciseRef = useRef<PracticeExercise | null>(null)
  const recordingDialectRef = useRef<DialectProfile | undefined>(undefined)
  const recordingSpeechVariantRef = useRef<TrainingSpeechVariant>('mandarin')
  const recordingUtterancePairIdRef = useRef<string | undefined>(undefined)
  const exerciseSelectionTouchedRef = useRef(false)
  const recordingReadingAssistanceRef = useRef(false)
  const readingAssistanceExerciseIdsRef = useRef<Set<string>>(new Set())
  const materialFileInputRef = useRef<HTMLInputElement | null>(null)

  const canSaveTrainingSample = hasRequiredLegalConsent(user)
  const collectionPreflightReady = isCollectionPreflightReady({
    environmentReady,
    distanceReady,
    understandsConsent: canSaveTrainingSample,
  })
  const preparedExpression = workspaceSnapshot?.prepared_expression ?? null
  const preparedExpressionExercises = useMemo(
    () => buildPreparedExpressionPracticeExercises(preparedExpression),
    [preparedExpression],
  )
  const hasPreparedContent = preparedExpressionExercises.length > 0
  const preparedExpressionDocument = preparedExpression?.document_content.trim() ?? ''
  const preparedExpressionPreview = useMemo(() => {
    if (preparedExpression?.summary?.trim()) {
      return preparedExpression.summary.trim()
    }

    if (!preparedExpressionDocument) {
      return '当前还没有同步到记忆区的参考材料。先去记忆区保存一份材料，再回来切句训练。'
    }

    return preparedExpressionDocument.length > 140
      ? `${preparedExpressionDocument.slice(0, 140)}…`
      : preparedExpressionDocument
  }, [preparedExpression?.summary, preparedExpressionDocument])
  const selectedCategory = topicSelection.category ?? MANDARIN_TRAINING_CATEGORIES[0]
  const practiceMode: PracticeSourceMode = topicSelection.practiceMode
  const showMaterialEditor = practiceMode === 'prepared_content'
    && (isMaterialEditorOpen || !hasPreparedContent)
  const collectionPlanId: CollectionPlanId = getCollectionPlanIdForTopic(topicId)
  const collectionPlan = getCollectionPlan(collectionPlanId)
  const isArticulationBaseline =
    practiceMode === 'sentence_corpus' && selectedCategory === '普通话构音基线'
  const isPhonologyTopic =
    practiceMode === 'sentence_corpus' && selectedCategory === '音系强化'

  const baseCategoryExercises = useMemo(
    () => (
      exerciseOverride
        ? exerciseOverride
        : practiceMode === 'prepared_content'
        ? preparedExpressionExercises
        : getExercisesByCategory(selectedCategory)
    ),
    [exerciseOverride, practiceMode, preparedExpressionExercises, selectedCategory],
  )
  const fullTrainingExercises = useMemo(
    () => getExercisesByCategory('all'),
    [],
  )
  const categoryExercises = useMemo(
    () => (
      isPhonologyTopic
        ? filterExercisesByPhonologyGroup(
            (selectedPhonologyGroupId === 'coverage-reinforcement'
              ? fullTrainingExercises
              : baseCategoryExercises) as MandarinTrainingExercise[],
            selectedPhonologyGroupId,
          )
        : baseCategoryExercises
    ),
    [baseCategoryExercises, fullTrainingExercises, isPhonologyTopic, selectedPhonologyGroupId],
  )
  const phonologyGroupOptions = useMemo(
    () => (
      isPhonologyTopic
        ? PHONOLOGY_GROUPS.map((group) => ({
            ...group,
            count: filterExercisesByPhonologyGroup(
              (group.id === 'coverage-reinforcement'
                ? fullTrainingExercises
                : baseCategoryExercises) as MandarinTrainingExercise[],
              group.id,
            ).length,
          }))
        : []
    ),
    [baseCategoryExercises, fullTrainingExercises, isPhonologyTopic],
  )
  const activePhonologyGroup = getPhonologyGroupMeta(selectedPhonologyGroupId)

  const recordedExerciseIds = useMemo(() => {
    const persistedExerciseIds = userId ? getUploadedTrainingExerciseIds(userId) : []
    return [...persistedExerciseIds, ...recordingProgress.recordedSentenceIds]
  }, [recordingProgress.recordedSentenceIds, userId])
  const recordedExerciseIdSet = useMemo(
    () => new Set(recordedExerciseIds),
    [recordedExerciseIds],
  )
  const recordedCategoryExerciseCount = useMemo(
    () => categoryExercises.reduce(
      (count, exercise) => count + (recordedExerciseIdSet.has(exercise.id) ? 1 : 0),
      0,
    ),
    [categoryExercises, recordedExerciseIdSet],
  )
  const unreadCategoryExerciseCount = Math.max(
    0,
    categoryExercises.length - recordedCategoryExerciseCount,
  )
  const effectiveReadingRoundId = readingArticle
    ? recordingProgress.readingArticleRoundIds[readingArticle.id] ?? readingRoundId
    : null
  const effectiveAllowRecordedExercises = allowRecordedExercises || Boolean(effectiveReadingRoundId)
  const resumeScopeKey = practiceMode === 'prepared_content' && preparedExpression?.id
    ? `prepared_expression:${preparedExpression.id}`
    : `category:${selectedCategory}`
  const resumeAfterExerciseId = readingArticle
    ? null
    : recordingProgress.lastRecordedExerciseIds[resumeScopeKey] ?? null

  const selectableExerciseState = useMemo(
    () => {
      if (readingArticle) {
        const recordedIds = effectiveAllowRecordedExercises && effectiveReadingRoundId
          ? new Set(recordingProgress.recordedReadingRoundKeys
              .filter((key) => key.startsWith(`${effectiveReadingRoundId}:`))
              .map((key) => key.slice(effectiveReadingRoundId.length + 1)))
          : new Set(recordedExerciseIds)
        const sessionIds = new Set(sessionPracticedExerciseIds)
        const exercises = categoryExercises.filter((exercise) => (
          !sessionIds.has(exercise.id)
          && (effectiveAllowRecordedExercises || !recordedIds.has(exercise.id))
        ))
        return {
          exercises,
          stage: 'unrecorded' as const,
          unrecordedCount: exercises.length,
          unrepeatedCount: exercises.length,
          totalCount: categoryExercises.length,
        }
      }

      return selectTrainingExercises({
        exercises: categoryExercises,
        recordedExerciseIds,
        sessionExerciseIds: sessionPracticedExerciseIds,
        resumeAfterExerciseId,
      })
    },
    [categoryExercises, effectiveAllowRecordedExercises, effectiveReadingRoundId, readingArticle, recordedExerciseIds, recordingProgress.recordedReadingRoundKeys, resumeAfterExerciseId, sessionPracticedExerciseIds],
  )

  const normalizedQuery = exerciseQuery.trim().toLowerCase()
  const matchingExercises = useMemo(() => {
    if (!normalizedQuery) {
      return selectableExerciseState.exercises
    }

    return selectableExerciseState.exercises.filter((exercise) => (
      exercise.text.toLowerCase().includes(normalizedQuery)
    ))
  }, [normalizedQuery, selectableExerciseState.exercises])

  const visibleExercises = useMemo(
    () => matchingExercises.slice(0, normalizedQuery ? SEARCH_VISIBLE_SENTENCES : DEFAULT_VISIBLE_SENTENCES),
    [matchingExercises, normalizedQuery],
  )

  const inventoryMatchingExercises = useMemo(() => {
    const byStatus = categoryExercises.filter((exercise) => {
      const isRecorded = recordedExerciseIdSet.has(exercise.id)
      if (exerciseStatusFilter === 'read') return isRecorded
      if (exerciseStatusFilter === 'unread') return !isRecorded
      return true
    })

    if (!normalizedQuery) return byStatus
    return byStatus.filter((exercise) => exercise.text.toLowerCase().includes(normalizedQuery))
  }, [categoryExercises, exerciseStatusFilter, normalizedQuery, recordedExerciseIdSet])
  const visibleInventoryExercises = useMemo(
    () => inventoryMatchingExercises.slice(0, visibleInventoryLimit),
    [inventoryMatchingExercises, visibleInventoryLimit],
  )

  const currentExercise = useMemo(
    () => (
      selectableExerciseState.exercises.find((exercise) => exercise.id === selectedExerciseId) ??
      (!readingArticle ? categoryExercises.find((exercise) => exercise.id === selectedExerciseId) : null) ??
      visibleExercises[0] ??
      selectableExerciseState.exercises[0] ??
      (!readingArticle ? categoryExercises[0] : null) ??
      null
    ),
    [categoryExercises, readingArticle, selectableExerciseState.exercises, selectedExerciseId, visibleExercises],
  )

  useEffect(() => {
    setVisibleInventoryLimit(normalizedQuery ? SEARCH_VISIBLE_SENTENCES : DEFAULT_VISIBLE_SENTENCES)
  }, [exerciseStatusFilter, normalizedQuery])

  useEffect(() => {
    setReadingAssistanceStatus(null)
    setIsReadingAssistancePlaying(false)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [currentExercise?.id])

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const currentPreparedAnchorLine = useMemo(
    () => (
      isPreparedExpressionExercise(currentExercise)
        ? currentExercise.preparedExpressionAnchorLine
        : null
    ),
    [currentExercise],
  )
  const currentPhonologyTarget = useMemo(() => {
    if (!isPhonologyTopic || !currentExercise) {
      return null
    }

    const targets = getPhonologyExerciseTargets(currentExercise.id)
    return selectedPhonologyGroupId === 'all'
      ? targets[0] ?? null
      : targets.find((target) => target.id === selectedPhonologyGroupId) ?? null
  }, [currentExercise, isPhonologyTopic, selectedPhonologyGroupId])
  const currentPhonologyTargetMeta = currentPhonologyTarget
    ? getPhonologyGroupMeta(currentPhonologyTarget.id)
    : null

  const currentExerciseTags = useMemo(
    () => dedupeStrings(
      isPreparedExpressionExercise(currentExercise)
        ? [
            currentExercise.preparedExpressionSectionTitle,
            ...currentExercise.preparedExpressionKeywords,
            ...currentExercise.preparedExpressionHighRiskPhrases,
          ]
        : isArticulationBaseline
          ? [currentExercise?.category ?? null, '50 字固定基线']
          : isPhonologyTopic && currentExercise
            ? [
                currentPhonologyTargetMeta?.label ?? activePhonologyGroup.label,
                currentPhonologyTarget?.focus ?? getPhonologyFocusForGroup(currentExercise.id, selectedPhonologyGroupId),
              ]
            : [currentExercise?.category ?? null],
      8,
    ),
    [activePhonologyGroup.label, currentExercise, currentPhonologyTarget?.focus, currentPhonologyTargetMeta?.label, isArticulationBaseline, isPhonologyTopic, selectedPhonologyGroupId],
  )

  const baselineSummary = useMemo(
    () => (
      isArticulationBaseline
        ? summarizeArticulationBaseline(
            Object.values(baselineAttemptsByExercise).map((savedAttempt) => ({
              exerciseId: savedAttempt.exercise.id,
              targetText: savedAttempt.exercise.text,
              heardText: savedAttempt.transcript,
              normalizedTarget: savedAttempt.feedback.normalizedTarget,
              normalizedHeard: savedAttempt.feedback.normalizedHeard,
            })),
            categoryExercises.length,
          )
        : null
    ),
    [baselineAttemptsByExercise, categoryExercises.length, isArticulationBaseline],
  )

  const dialectOptions = useMemo(() => readDialectProfiles(workspaceSnapshot?.registration_profile), [workspaceSnapshot?.registration_profile])
  const [selectedDialectKey, setSelectedDialectKey] = useState('')
  const selectedDialect = dialectOptions.find((entry) => JSON.stringify(entry) === selectedDialectKey)
    ?? (dialectOptions.length === 1 ? dialectOptions[0] : undefined)
  const trainingUploadLabels = useMemo<TrainingUploadLabels>(() => {
    return {
      disabilityCategory: workspaceSnapshot?.registration_profile?.disability_category,
      condition: workspaceSnapshot?.registration_profile?.condition,
      etiology: workspaceSnapshot?.user_profile_memory?.etiology,
      severity: isArticulationBaseline
        ? undefined
        : workspaceSnapshot?.user_profile_memory?.severity as TrainingSeverity | undefined,
      hasDialect: workspaceSnapshot?.registration_profile?.has_dialect,
      dialectName: selectedDialect?.name,
      dialectRegion: selectedDialect?.region,
    }
  }, [
    isArticulationBaseline,
    workspaceSnapshot?.registration_profile?.condition,
    workspaceSnapshot?.registration_profile?.disability_category,
    selectedDialect?.name,
    selectedDialect?.region,
    workspaceSnapshot?.registration_profile?.has_dialect,
    workspaceSnapshot?.user_profile_memory?.etiology,
    workspaceSnapshot?.user_profile_memory?.severity,
  ])
  const dialectPairEnabled = shouldOfferDialectPair({
    hasDialect: Boolean(trainingUploadLabels.hasDialect),
    dialectName: dialectOptions[0]?.name,
    isAssessment: isArticulationBaseline,
  })
  const activeSpeechVariant = pendingDialectTarget?.speechVariant ?? 'mandarin'
  const activeCollectionExercise = pendingDialectTarget?.exercise ?? currentExercise
  const activeSpeechVariantLabel = activeSpeechVariant === 'dialect'
    ? `${trainingUploadLabels.dialectName ?? '方言'}表达`
    : '普通话表达'
  const recorderStatus = getRecorderStatusCopy(status, sessionError, isArticulationBaseline)
  const currentAttemptUnderstandingRatio = useMemo(() => {
    if (!attempt || !isArticulationBaseline || attempt.feedback.normalizedTarget.length === 0) {
      return null
    }

    return Math.max(
      0,
      (attempt.feedback.normalizedTarget.length - calculateCharacterEditDistance(
        attempt.feedback.normalizedTarget,
        attempt.feedback.normalizedHeard,
      ))
      / attempt.feedback.normalizedTarget.length,
    )
  }, [attempt, isArticulationBaseline])
  const baselineTranscriptNotice = useMemo(
    () => (
      isArticulationBaseline && attempt
        ? getBaselineTranscriptNotice(
            attempt.transcript,
            Boolean(attempt.recording),
            attempt.transcriptStatus,
          )
        : null
    ),
    [attempt, isArticulationBaseline],
  )

  const exerciseSelectionHint = useMemo(() => {
    if (isArticulationBaseline) {
      return '固定 50 个单音节，按顺序逐字录制。'
    }

    if (selectableExerciseState.stage === 'unrecorded') {
      return `当前优先展示还没录过的句子，还剩 ${selectableExerciseState.unrecordedCount} 句。`
    }

    if (selectableExerciseState.stage === 'unrepeated') {
      return '这一组之前都录过了，当前先避开这轮已经练过的句子。'
    }

    return '这一组这轮都练过了，现在允许回看前面的句子继续复练。'
  }, [isArticulationBaseline, selectableExerciseState])

  useEffect(() => {
    if (!userId) {
      return
    }

    setSelectedDialectKey('')
    setSessionPracticedExerciseIds([])
    setBaselineAttemptsByExercise({})
    setSelectedPhonologyGroupId(topicSelection.category === '音系强化' ? DEFAULT_PHONOLOGY_GROUP_ID : 'all')
    setExerciseStatusFilter('unread')
    setVisibleInventoryLimit(DEFAULT_VISIBLE_SENTENCES)
    exerciseSelectionTouchedRef.current = false
    setAttempt(null)
    setPendingDialectTarget(null)
    setCollectionFlowStep('prepare')
    void refreshLocalQueueCount()
  }, [refreshLocalQueueCount, topicId, userId])

  useEffect(() => {
    return () => {
      disconnectRef.current()
    }
  }, [])

  useEffect(() => {
    const selectionPool = readingArticle ? visibleExercises : categoryExercises
    if (!selectionPool.length) {
      return
    }

    const stillVisible = selectionPool.some((exercise) => exercise.id === selectedExerciseId)
    const shouldApplyCloudResume = !recordingProgress.isLoading && !exerciseSelectionTouchedRef.current
    const nextDefaultExercise = visibleExercises[0] ?? selectableExerciseState.exercises[0]
    if ((!stillVisible || shouldApplyCloudResume) && nextDefaultExercise) {
      setSelectedExerciseId(nextDefaultExercise.id)
      if (shouldApplyCloudResume) {
        exerciseSelectionTouchedRef.current = true
      }
    }
  }, [categoryExercises, readingArticle, recordingProgress.isLoading, selectableExerciseState.exercises, selectedExerciseId, visibleExercises])

  useEffect(() => {
    if (!isRecording) {
      return
    }

    setRecordingSeconds(0)
    const timer = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1)
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [isRecording])

  useEffect(() => {
    if (!notice) {
      return
    }

    const timer = window.setTimeout(() => {
      setNotice(null)
    }, 4000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [notice])

  useEffect(() => {
    const blob = attempt?.recording?.audio.blob
    if (!blob) {
      setAttemptPlaybackUrl(null)
      return
    }

    const playbackUrl = URL.createObjectURL(blob)
    setAttemptPlaybackUrl(playbackUrl)

    return () => {
      URL.revokeObjectURL(playbackUrl)
    }
  }, [attempt?.recording?.audio.blob])

  const handleMaterialFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const content = await file.text()
      setMaterialContent(content)
      setMaterialSource(file.name)
      setMaterialTitle((current) => current.trim() || stripFileExtension(file.name))
      setMaterialStatus('材料已经读进来了，确认内容后保存即可。')
    } catch (error) {
      console.error('[contribute] read material failed:', error)
      setMaterialStatus('文件读取失败了，请换一个 .txt 或 .md 文件再试。')
    } finally {
      event.target.value = ''
    }
  }, [])

  const handleSaveMaterial = useCallback(async () => {
    if (!userId || !isAuthenticated) {
      setMaterialStatus('登录后才能保存材料。')
      return
    }

    const content = materialContent.trim()
    if (!content) {
      setMaterialStatus('先上传文件，或者粘贴一段想录的内容。')
      return
    }

    setIsSavingMaterial(true)
    setMaterialStatus(null)

    try {
      await savePreparedExpressionAsset(userId, {
        title: materialTitle.trim() || '我的训练材料',
        source: materialSource,
        content,
        make_active: true,
      })
      const refreshedSnapshot = await refreshWorkspaceSnapshot()
      const refreshedExercises = buildPreparedExpressionPracticeExercises(
        refreshedSnapshot?.prepared_expression,
      )
      setMaterialStatus(
        refreshedExercises.length > 0
          ? `已经自动切成 ${refreshedExercises.length} 句，可以开始录了。`
          : '材料已经保存，但还没有切出可录句子。可以补充完整句子后再试。',
      )
      if (refreshedExercises.length > 0) {
        setIsMaterialEditorOpen(false)
        setCollectionFlowStep('prepare')
        exerciseSelectionTouchedRef.current = true
        setSelectedExerciseId(refreshedExercises[0].id)
      }
    } catch (error) {
      console.error('[contribute] save material failed:', error)
      setMaterialStatus('材料保存失败了，请稍后再试。')
    } finally {
      setIsSavingMaterial(false)
    }
  }, [
    isAuthenticated,
    materialContent,
    materialSource,
    materialTitle,
    refreshWorkspaceSnapshot,
    userId,
  ])

  const moveExercise = useCallback((offset: number) => {
    if (isRecording || isProcessing || !visibleExercises.length || !currentExercise) {
      return
    }

    const currentIndex = visibleExercises.findIndex((exercise) => exercise.id === currentExercise.id)
    if (currentIndex < 0) {
      return
    }

    const nextIndex = (currentIndex + offset + visibleExercises.length) % visibleExercises.length
    exerciseSelectionTouchedRef.current = true
    setSelectedExerciseId(visibleExercises[nextIndex].id)
    setAttempt(null)
    setPendingDialectTarget(null)
  }, [currentExercise, isProcessing, isRecording, visibleExercises])

  const handleSelectExercise = useCallback((exerciseId: string) => {
    if (isRecording || isProcessing) {
      return
    }
    exerciseSelectionTouchedRef.current = true
    setSelectedExerciseId(exerciseId)
    setAttempt(null)
    setPendingDialectTarget(null)
  }, [isProcessing, isRecording])

  const handleSelectPhonologyGroup = useCallback((groupId: PhonologyGroupId) => {
    if (isRecording || isProcessing || groupId === selectedPhonologyGroupId) {
      return
    }

    setSelectedPhonologyGroupId(groupId)
    exerciseSelectionTouchedRef.current = false
    setSelectedExerciseId('')
    setExerciseQuery('')
    setAttempt(null)
    setPendingDialectTarget(null)
  }, [isProcessing, isRecording, selectedPhonologyGroupId])

  const handlePlayReadingAssistance = useCallback(() => {
    if (!currentExercise || isRecording || isProcessing) {
      return
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setReadingAssistanceStatus('当前浏览器暂不支持朗读，可以换一句。')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(currentExercise.text)
    utterance.lang = 'zh-CN'
    utterance.rate = 0.85
    setIsReadingAssistancePlaying(true)
    setReadingAssistanceStatus('正在准备朗读，听完后再开始录音。')
    utterance.onstart = () => {
      readingAssistanceExerciseIdsRef.current.add(currentExercise.id)
      setReadingAssistanceStatus('正在朗读，听完后再开始录音。')
    }
    utterance.onend = () => {
      setIsReadingAssistancePlaying(false)
      setReadingAssistanceStatus('朗读完成，请按你平时的方式说。')
    }
    utterance.onerror = () => {
      setIsReadingAssistancePlaying(false)
      setReadingAssistanceStatus('朗读没有完成，可以再点一次或换一句。')
    }
    window.speechSynthesis.speak(utterance)
  }, [currentExercise, isProcessing, isRecording])

  const handleStartRecording = useCallback(async () => {
    if (!activeCollectionExercise || isProcessing) {
      return
    }

    if (!collectionPreflightReady) {
      setNotice({
        tone: 'info',
        message: '先完成采集前确认：环境、距离和数据授权。',
      })
      return
    }

    if (isReadingAssistancePlaying) {
      setNotice({
        tone: 'info',
        message: '请等示例朗读结束后再开始录音。',
      })
      return
    }

    const collectionTarget: DialectCollectionTarget<PracticeExercise> = pendingDialectTarget ?? {
      exercise: activeCollectionExercise,
      speechVariant: 'mandarin',
      utterancePairId: dialectPairEnabled ? createUtterancePairId() : undefined,
    }
    if (collectionTarget.speechVariant === 'dialect' && !selectedDialect) {
      setNotice({ tone: 'info', message: '请先选择本次录音使用的方言，也可以跳过。' })
      return
    }
    recordingDialectRef.current = collectionTarget.speechVariant === 'dialect' ? selectedDialect : undefined
    setAttempt(null)
    setNotice(null)
    setCollectionFlowStep('record')
    recordingExerciseRef.current = collectionTarget.exercise
    recordingSpeechVariantRef.current = collectionTarget.speechVariant
    recordingUtterancePairIdRef.current = collectionTarget.utterancePairId
    recordingReadingAssistanceRef.current = readingAssistanceExerciseIdsRef.current.has(collectionTarget.exercise.id)

    try {
      await startRecording()
    } catch (error) {
      recordingExerciseRef.current = null
      recordingSpeechVariantRef.current = 'mandarin'
      recordingUtterancePairIdRef.current = undefined
      console.error('[contribute] start recording failed:', error)
      setNotice({
        tone: 'error',
        message: '录音失败，请重试。',
      })
    }
  }, [selectedDialect, activeCollectionExercise, collectionPreflightReady, dialectPairEnabled, isProcessing, isReadingAssistancePlaying, pendingDialectTarget, startRecording])

  const removeAttemptFromProgress = useCallback((attemptToRemove: PracticeAttempt) => {
    if (attemptToRemove.speechVariant === 'dialect') {
      return
    }
    setSessionPracticedExerciseIds((currentIds) => (
      currentIds.filter((exerciseId) => exerciseId !== attemptToRemove.exercise.id)
    ))
    if (isArticulationBaseline) {
      setBaselineAttemptsByExercise((current) => {
        const next = { ...current }
        delete next[attemptToRemove.exercise.id]
        return next
      })
    }
  }, [isArticulationBaseline])

  const startReplacementRecording = useCallback(async (targetToRetry: DialectCollectionTarget<PracticeExercise>) => {
    const exerciseToRetry = targetToRetry.exercise
    if (targetToRetry.speechVariant === 'dialect' && !targetToRetry.dialect) {
      setIsReplacingAttempt(false)
      setNotice({ tone: 'info', message: '请先选择本次录音使用的方言，再开始录音。' })
      return
    }
    recordingDialectRef.current = targetToRetry.dialect
    exerciseSelectionTouchedRef.current = true
    setSelectedExerciseId(exerciseToRetry.id)
    setAttempt(null)
    setCollectionFlowStep('record')
    recordingExerciseRef.current = exerciseToRetry
    recordingSpeechVariantRef.current = targetToRetry.speechVariant
    recordingUtterancePairIdRef.current = targetToRetry.utterancePairId
    recordingReadingAssistanceRef.current = readingAssistanceExerciseIdsRef.current.has(exerciseToRetry.id)

    try {
      await startRecording()
      setNotice({
        tone: 'info',
        message: '正在重新录这一句，完成后只保留新录音。',
      })
    } catch (error) {
      recordingExerciseRef.current = null
      recordingSpeechVariantRef.current = 'mandarin'
      recordingUtterancePairIdRef.current = undefined
      console.error('[contribute] retry recording failed:', error)
      setNotice({
        tone: 'error',
        message: '重新录音没有启动，请再点一次开始录音；之前的录音不会重复收录。',
      })
    } finally {
      pendingReplacementExerciseRef.current = null
      setIsReplacingAttempt(false)
    }
  }, [startRecording])

  const handleRetryCurrentExercise = useCallback(async () => {
    if (isRecording || isProcessing || isReplacingAttempt) {
      return
    }

    const attemptToReplace = attempt
    const exerciseToRetry = attemptToReplace?.exercise ?? currentExercise
    if (!exerciseToRetry) {
      return
    }

    if (!collectionPreflightReady) {
      setCollectionFlowStep('prepare')
      setNotice({
        tone: 'info',
        message: '先完成采集前确认：环境、距离和数据授权。',
      })
      return
    }

    const replacementPlan = planTrainingAttemptReplacement(
      attemptToReplace?.uploadStatus ?? 'idle',
      Boolean(attemptToReplace?.recording),
    )

    if (attemptToReplace?.transcriptStatus === 'pending') {
      discardedAttemptIdsRef.current.add(attemptToReplace.createdAt)
      removeAttemptFromProgress(attemptToReplace)
      setIsReplacingAttempt(true)
      await startReplacementRecording({
        exercise: exerciseToRetry,
        speechVariant: attemptToReplace.speechVariant,
        utterancePairId: attemptToReplace.utterancePairId,
        dialect: attemptToReplace.dialect,
      })
      return
    }

    if (replacementPlan === 'wait_for_discard') {
      setNotice({
        tone: 'info',
        message: '旧录音正在撤回，完成后请再点一次重录。',
      })
      return
    }

    if (replacementPlan === 'start_without_discard' || !attemptToReplace?.recording) {
      setIsReplacingAttempt(true)
      await startReplacementRecording({
        exercise: exerciseToRetry,
        speechVariant: attemptToReplace?.speechVariant ?? activeSpeechVariant,
        utterancePairId: attemptToReplace?.utterancePairId ?? pendingDialectTarget?.utterancePairId,
        dialect: attemptToReplace?.dialect ?? selectedDialect,
      })
      return
    }

    pendingReplacementExerciseRef.current = {
      exercise: exerciseToRetry,
      speechVariant: attemptToReplace?.speechVariant ?? activeSpeechVariant,
      utterancePairId: attemptToReplace?.utterancePairId ?? pendingDialectTarget?.utterancePairId,
      dialect: attemptToReplace?.dialect ?? selectedDialect,
    }
    setIsReplacingAttempt(true)
    discardedAttemptIdsRef.current.add(attemptToReplace.createdAt)
    setAttempt((current) => (
      current?.createdAt === attemptToReplace.createdAt
        ? { ...current, uploadStatus: 'discarding' }
        : current
    ))
    setNotice({
      tone: 'info',
      message: replacementPlan === 'wait_for_save_then_discard'
        ? '正在完成旧录音的撤回，完成后会自动重新录这一句。'
        : '正在撤回旧录音，完成后会自动重新录这一句。',
    })

    if (replacementPlan === 'wait_for_save_then_discard') {
      return
    }

    const result = await discardUploadedRecording({
      recordingId: attemptToReplace.recording.recordingId,
      contributionId: attemptToReplace.uploadReceipt?.contributionId ?? null,
      storagePath: attemptToReplace.uploadReceipt?.storagePath ?? null,
    })

    if (!result.ok) {
      discardedAttemptIdsRef.current.delete(attemptToReplace.createdAt)
      pendingReplacementExerciseRef.current = null
      setIsReplacingAttempt(false)
      setAttempt((current) => (
        current?.createdAt === attemptToReplace.createdAt
          ? { ...current, uploadStatus: attemptToReplace.uploadStatus }
          : current
      ))
      setNotice({
        tone: 'error',
        message: result.errorMessage || '旧录音撤回失败，系统没有开始重录，请稍后再试。',
      })
      return
    }

    if (userId) {
      removeUploadedTrainingRecord(userId, attemptToReplace.recording.recordingId)
    }

    discardedAttemptIdsRef.current.delete(attemptToReplace.createdAt)
    removeAttemptFromProgress(attemptToReplace)
    await startReplacementRecording({
      exercise: exerciseToRetry,
      speechVariant: attemptToReplace?.speechVariant ?? activeSpeechVariant,
      utterancePairId: attemptToReplace?.utterancePairId ?? pendingDialectTarget?.utterancePairId,
      dialect: attemptToReplace?.dialect ?? selectedDialect,
    })
  }, [
    attempt,
    selectedDialect,
    activeSpeechVariant,
    collectionPreflightReady,
    currentExercise,
    discardUploadedRecording,
    isProcessing,
    isRecording,
    isReplacingAttempt,
    pendingDialectTarget?.utterancePairId,
    removeAttemptFromProgress,
    startReplacementRecording,
    userId,
  ])

  const advanceAfterCompletedPair = useCallback((completedExercise: PracticeExercise) => {
    const nextExercise = getNextExerciseAfterAcceptedRecording({
      accepted: true,
      currentExerciseId: completedExercise.id,
      activeExercises: matchingExercises,
      fallbackExercises: !readingArticle && normalizedQuery.length === 0
        ? categoryExercises
        : [],
    })
    if (nextExercise && nextExercise.id !== completedExercise.id) {
      exerciseSelectionTouchedRef.current = true
      setSelectedExerciseId(nextExercise.id)
    }
    return nextExercise
  }, [categoryExercises, matchingExercises, normalizedQuery.length, readingArticle])

  const handleContinueAfterAttempt = useCallback(() => {
    if (attempt?.speechVariant === 'mandarin' && dialectPairEnabled && attempt.utterancePairId) {
      setPendingDialectTarget({
        exercise: attempt.exercise,
        speechVariant: 'dialect',
        utterancePairId: attempt.utterancePairId,
      })
      setAttempt(null)
      setNotice({
        tone: 'info',
        message: `接下来仍是同一句，请用${trainingUploadLabels.dialectName ?? '方言'}自然地说一遍。`,
      })
      setCollectionFlowStep('record')
      return
    }

    setPendingDialectTarget(null)
    setAttempt(null)
    setNotice(null)
    setCollectionFlowStep('record')
  }, [attempt, dialectPairEnabled, trainingUploadLabels.dialectName])

  const handleSkipDialect = useCallback(() => {
    if (!attempt || attempt.speechVariant !== 'mandarin') return
    const nextExercise = advanceAfterCompletedPair(attempt.exercise)
    setPendingDialectTarget(null)
    setAttempt(null)
    setCollectionFlowStep('record')
    setNotice({
      tone: 'success',
      message: nextExercise ? '已跳过方言录音，继续下一句。' : '已跳过方言录音，这一组已经完成。',
    })
  }, [advanceAfterCompletedPair, attempt])

  const persistTrainingAttempt = useCallback(async (
    attemptToPersist: PracticeAttempt,
    _saveTrigger: AttemptSaveTrigger,
  ) => {
    if (!attemptToPersist.recording) {
      setNotice({
        tone: 'error',
        message: '这次录音还没有完整音频文件，暂时无法保存。',
      })
      return
    }

    // The browser User object can have stale metadata after a re-consent. The
    // Backend is the authority for consent; always attempt durable upload and
    // let its explicit 403 keep the local queue safe when consent is missing.

    setAttempt((current) => {
      if (!current || current.createdAt !== attemptToPersist.createdAt) {
        return current
      }

      return {
        ...current,
        uploadStatus: 'saving',
      }
    })

    const consentScope: VoxFlameConsentScope = 'training_only'
    const result = await uploadRecording(attemptToPersist.recording.audio.blob, {
      text: attemptToPersist.exercise.text,
      recognizedText: attemptToPersist.transcript,
      source: 'guided_recording',
      sentenceId: attemptToPersist.exercise.id,
      recording: attemptToPersist.recording,
      consentScope,
      metadata: buildUploadMetadata(
        attemptToPersist.exercise,
        attemptToPersist.recording,
        attemptToPersist.transcript,
        attemptToPersist.feedback,
        attemptToPersist.sampleQuality,
        attemptToPersist.readingAssistanceUsed,
        { ...trainingUploadLabels, dialectName: attemptToPersist.dialect?.name, dialectRegion: attemptToPersist.dialect?.region },
        collectionPlanId,
        readingArticle,
        effectiveReadingRoundId,
        attemptToPersist.speechVariant,
        attemptToPersist.utterancePairId,
      ),
    })
    void recordingProgress.refresh()
    const wasDiscarded = discardedAttemptIdsRef.current.has(attemptToPersist.createdAt)

    if (wasDiscarded) {
      const discardResult = await discardUploadedRecording({
        recordingId: attemptToPersist.recording.recordingId,
        contributionId: result.receipt?.contributionId ?? null,
        storagePath: result.receipt?.storagePath ?? null,
      })

      if (!discardResult.ok) {
        discardedAttemptIdsRef.current.delete(attemptToPersist.createdAt)
        pendingReplacementExerciseRef.current = null
        setIsReplacingAttempt(false)
        setAttempt((current) => {
          if (!current || current.createdAt !== attemptToPersist.createdAt) {
            return current
          }

          return {
            ...current,
            uploadStatus: result.status,
            uploadReceipt: result.receipt ?? null,
          }
        })
        setNotice({
          tone: 'error',
          message: discardResult.errorMessage || '旧录音撤回失败，系统没有开始重录，请稍后再试。',
        })
        return
      }

      if (userId) {
        removeUploadedTrainingRecord(userId, attemptToPersist.recording.recordingId)
      }
      void recordingProgress.refresh()

      const replacementExercise = pendingReplacementExerciseRef.current
      if (replacementExercise) {
        discardedAttemptIdsRef.current.delete(attemptToPersist.createdAt)
        removeAttemptFromProgress(attemptToPersist)
        await startReplacementRecording(replacementExercise)
        return
      }

      setAttempt((current) => {
        if (!current || current.createdAt !== attemptToPersist.createdAt) {
          return current
        }

        return {
          ...current,
          uploadStatus: 'discarded',
          uploadReceipt: null,
        }
      })
      setNotice({
        tone: 'success',
        message: '已撤回，这条不会进入训练语料。',
      })
      return
    }

    setAttempt((current) => {
      if (!current || current.createdAt !== attemptToPersist.createdAt) {
        return current
      }

      return {
        ...current,
        uploadStatus: result.status,
        uploadReceipt: result.receipt ?? null,
      }
    })

    if (result.status === 'uploaded' && userId) {
      const uploadedRecord = buildUploadedTrainingRecord(attemptToPersist)
      if (uploadedRecord) {
        appendUploadedTrainingRecord(userId, uploadedRecord)
      }

      setNotice({
        tone: 'success',
        message: '这条录音已经进入训练语料，只保留标签和系统听到的结果。',
      })
      return
    }

    if (result.status === 'local_only') {
      setNotice({
        tone: 'info',
        message: '录音已安全保存在本机；网络或服务恢复后会在明确的恢复事件上继续同步。',
      })
      return
    }

    if (result.status === 'auth_required') {
      setNotice({
        tone: 'error',
        message: result.errorMessage || '登录状态已失效，请重新登录后再保存。',
      })
      return
    }

    setNotice({
      tone: 'error',
      message: result.errorMessage || '保存训练样本失败，请稍后重试。',
    })
  }, [
    canSaveTrainingSample,
    collectionPlanId,
    discardUploadedRecording,
    removeAttemptFromProgress,
    startReplacementRecording,
    trainingUploadLabels,
    uploadRecording,
    userId,
    readingArticle,
    effectiveReadingRoundId,
    recordingProgress,
  ])

  const handleDiscardAttempt = useCallback(async () => {
    if (!attempt?.recording) {
      setAttempt(null)
      setNotice({
        tone: 'success',
        message: '已忽略这次结果。',
      })
      return
    }

    if (attempt.transcriptStatus === 'pending') {
      discardedAttemptIdsRef.current.add(attempt.createdAt)
      removeAttemptFromProgress(attempt)
      setAttempt((current) => (
        current?.createdAt === attempt.createdAt
          ? { ...current, uploadStatus: 'discarded' }
          : current
      ))
      setNotice({
        tone: 'success',
        message: '已取消收录，后台识别完成后也不会上传这条录音。',
      })
      return
    }

    setAttempt((current) => (
      current?.createdAt === attempt.createdAt
        ? {
            ...current,
            uploadStatus: current.uploadStatus === 'saving' ? 'discarding' : current.uploadStatus,
          }
        : current
    ))

    if (attempt.uploadStatus === 'saving') {
      discardedAttemptIdsRef.current.add(attempt.createdAt)
      setNotice({
        tone: 'info',
        message: '已标记不收录；如果上传已经开始，完成后会自动撤回。',
      })
      return
    }

    const result = await discardUploadedRecording({
      recordingId: attempt.recording.recordingId,
      contributionId: attempt.uploadReceipt?.contributionId ?? null,
      storagePath: attempt.uploadReceipt?.storagePath ?? null,
    })

    if (result.ok) {
      removeAttemptFromProgress(attempt)
      if (userId) {
        removeUploadedTrainingRecord(userId, attempt.recording.recordingId)
      }
      void recordingProgress.refresh()
      setAttempt((current) => (
        current?.createdAt === attempt.createdAt
          ? {
              ...current,
              uploadStatus: 'discarded',
              uploadReceipt: null,
            }
          : current
      ))
      setNotice({
        tone: 'success',
        message: '已撤回，这条不会进入训练语料。',
      })
      return
    }

    setAttempt((current) => (
      current?.createdAt === attempt.createdAt
        ? {
            ...current,
            uploadStatus: attempt.uploadStatus,
          }
        : current
    ))
    setNotice({
      tone: 'error',
      message: result.errorMessage || '撤回失败，请稍后再试。',
    })
  }, [attempt, discardUploadedRecording, recordingProgress, removeAttemptFromProgress, userId])

  const handleStopRecording = useCallback(async () => {
    const recordedExercise = recordingExerciseRef.current
    if (!recordedExercise) {
      setNotice({
        tone: 'error',
        message: '这次录音缺少开始时的题目标识，系统已阻止评分和上传，请重新录制。',
      })
      return
    }

    const dialect = recordingDialectRef.current
    const speechVariant = recordingSpeechVariantRef.current
    const utterancePairId = recordingUtterancePairIdRef.current
    const readingAssistanceUsed = recordingReadingAssistanceRef.current

    try {
      const result = await stopRecording()
      const createdAt = Date.now()
      const buildAttempt = (
        transcript: string,
        transcriptLatencyMs: number,
        transcriptStatus: PracticeAttempt['transcriptStatus'],
      ): PracticeAttempt => {
        const feedback = analyzeMandarinAttempt(recordedExercise, transcript)
        const sampleQuality = assessTrainingSampleQuality({
          feedback,
          recording: result.recording,
          transcriptLatencyMs,
        })

        return {
          createdAt,
          clientCaptureId: result.clientCaptureId,
          exercise: recordedExercise,
          transcript,
          transcriptStatus,
          transcriptLatencyMs,
          feedback,
          sampleQuality,
          readingAssistanceUsed,
          recording: result.recording,
          uploadStatus: result.recording
            ? canSaveTrainingSample
              ? 'saving'
              : 'auth_required'
            : 'idle',
          uploadReceipt: null,
          speechVariant,
          dialect,
          utterancePairId,
        }
      }
      const nextAttempt = buildAttempt(
        result.immediateTranscript.trim(),
        0,
        'pending',
      )

      if (!isArticulationBaseline && result.recording) {
        setSessionPracticedExerciseIds((currentIds) => (
          currentIds.includes(recordedExercise.id)
            ? currentIds
            : [...currentIds, recordedExercise.id]
        ))
      }
      setAttempt(nextAttempt)
      // Upload the captured audio immediately. Final ASR is best-effort metadata
      // and must never block durable storage of the original recording.
      if (nextAttempt.recording) {
        void persistTrainingAttempt(nextAttempt, 'auto')
      }
      if (!isArticulationBaseline) {
        setCollectionFlowStep(result.recording ? 'review' : 'record')
      }
      const shouldWaitForDialect = Boolean(result.recording)
        && speechVariant === 'mandarin'
        && dialectPairEnabled
      const nextExercise = shouldWaitForDialect
        ? null
        : getNextExerciseAfterAcceptedRecording({
            accepted: Boolean(result.recording),
            currentExerciseId: recordedExercise.id,
            activeExercises: matchingExercises,
            fallbackExercises: !readingArticle && normalizedQuery.length === 0
              ? categoryExercises
              : [],
          })

      if (nextExercise && nextExercise.id !== recordedExercise.id) {
        exerciseSelectionTouchedRef.current = true
        setSelectedExerciseId(nextExercise.id)
      }

      setNotice({
        tone: !result.recording
          ? 'error'
          : canSaveTrainingSample && result.recording
            ? 'info'
            : 'success',
        message: !result.recording
          ? '这次没有生成完整录音文件，请重新录一次。'
          : shouldWaitForDialect
          ? `普通话录音已经收下，识别和保存会在后台完成。确认后可继续录${trainingUploadLabels.dialectName ?? '方言'}，也可以跳过。`
          : canSaveTrainingSample && result.recording
          ? nextExercise
            ? '录音已经收下，识别和保存正在后台进行，并且已经切到下一句。'
            : '录音已经收下，识别和保存正在后台进行。'
          : nextExercise
            ? '录音已经收下，已经切到下一句继续练。'
            : '录音已经收下，识别结果会在后台补上。',
      })

      void result.transcriptCompletion.then(({ transcript, transcriptLatencyMs }) => {
        if (discardedAttemptIdsRef.current.has(createdAt)) {
          discardedAttemptIdsRef.current.delete(createdAt)
          return
        }

        const finalizedAttempt = buildAttempt(
          transcript.trim(),
          transcriptLatencyMs,
          'complete',
        )
        const hasUsableBaselineTranscript = !isArticulationBaseline || transcript.trim().length > 0

        setAttempt((current) => (
          mergeCaptureBoundResult(current, finalizedAttempt)
        ))
        if (isArticulationBaseline && hasUsableBaselineTranscript) {
          setSessionPracticedExerciseIds((currentIds) => (
            currentIds.includes(recordedExercise.id)
              ? currentIds
              : [...currentIds, recordedExercise.id]
          ))
          setBaselineAttemptsByExercise((current) => ({
            ...current,
            [recordedExercise.id]: finalizedAttempt,
          }))
        }

        // Upload already started immediately after capture. Do not wait for ASR
        // or issue a second upload for the same recording ID.
      }).catch((completionError: unknown) => {
        console.error('[contribute] transcript finalization failed:', completionError)
        setAttempt((current) => (
          current?.clientCaptureId === result.clientCaptureId
            ? { ...current, transcriptStatus: 'complete' }
            : current
        ))
      })
    } catch (error) {
      console.error('[contribute] stop recording failed:', error)
      setNotice({
        tone: 'error',
        message: '录音失败，请重试。',
      })
    } finally {
      recordingExerciseRef.current = null
      recordingSpeechVariantRef.current = 'mandarin'
      recordingUtterancePairIdRef.current = undefined
      recordingReadingAssistanceRef.current = false
    }
  }, [
    canSaveTrainingSample,
    categoryExercises,
    dialectPairEnabled,
    isArticulationBaseline,
    matchingExercises,
    normalizedQuery.length,
    persistTrainingAttempt,
    readingArticle,
    stopRecording,
    trainingUploadLabels.dialectName,
  ])

  if (isLoading || shouldBlockTrainingPageForProgress(Boolean(readingArticle), recordingProgress.isLoading)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50">
        <div className="text-center text-sm text-gray-600">正在准备训练页...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const materialEditor = showMaterialEditor ? (
    <section aria-labelledby="material-editor-heading" className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-amber-800">我的材料</p>
          <h2 id="material-editor-heading" className="mt-2 text-balance text-2xl font-semibold text-stone-950">上传或粘贴，自动切成逐句录音</h2>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-stone-600">
            适合演讲稿、就医说明、工作汇报或想反复练习的一段话。保存后会成为当前材料。
          </p>
        </div>
        {hasPreparedContent ? (
          <button
            type="button"
            onClick={() => setIsMaterialEditorOpen(false)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
          >
            返回当前材料
          </button>
        ) : null}
      </div>

      {materialStatus ? (
        <div role="status" aria-live="polite" className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {materialStatus}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-800">材料名称</span>
          <input
            value={materialTitle}
            onChange={(event) => setMaterialTitle(event.target.value)}
            placeholder="例如：下周汇报 / 就医说明"
            className="h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-sm text-stone-950 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </label>
        <button
          type="button"
          onClick={() => materialFileInputRef.current?.click()}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-5 py-3 text-sm font-semibold text-stone-800 hover:border-amber-300 hover:bg-amber-50"
        >
          <UploadCloud className="size-4" aria-hidden="true" />
          上传 .txt / .md
        </button>
        <input
          ref={materialFileInputRef}
          type="file"
          accept=".md,.txt,.text"
          onChange={(event) => void handleMaterialFileChange(event)}
          className="hidden"
        />
      </div>

      <label className="mt-4 block space-y-2">
        <span className="text-sm font-medium text-stone-800">材料内容</span>
        <textarea
          value={materialContent}
          onChange={(event) => {
            setMaterialContent(event.target.value)
            setMaterialSource('manual_input')
          }}
          placeholder="把你真正想说、想练的一段内容粘贴在这里。"
          className="min-h-56 w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-4 text-sm leading-7 text-stone-950 outline-none focus:border-amber-500 focus:bg-white focus:ring-1 focus:ring-amber-500"
        />
      </label>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-sm text-stone-500">系统会按标点和段落切句；保存后仍可在记忆区继续管理原文。</p>
        <button
          type="button"
          onClick={() => void handleSaveMaterial()}
          disabled={isSavingMaterial || !materialContent.trim()}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isSavingMaterial ? '正在切分材料…' : '保存并生成录音句子'}
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  ) : null

  if (showMaterialEditor) {
    return (
      <div className="min-h-dvh bg-stone-50">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
            <Link href={returnHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {returnLabel}
            </Link>
            <h1 className="mt-1 text-balance text-2xl font-semibold text-stone-950">用自己的材料录音</h1>
            <p className="mt-1 text-pretty text-sm text-stone-600">把原文带进来，系统会自动切句，再进入同一个录音流程。</p>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          {materialEditor}
        </main>
      </div>
    )
  }

  if (!currentExercise) {
    if (readingArticle) {
      return (
        <div className="min-h-dvh bg-stone-50">
          <header className="border-b border-stone-200 bg-white">
            <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
              <Link href={returnHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {returnLabel}
              </Link>
              <h1 className="mt-1 text-balance text-2xl font-semibold text-stone-950">{readingArticle.title}</h1>
            </div>
          </header>
          <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
            <RecordingDurationSummary
              compact
              todayDurationSeconds={recordingProgress.todayDurationSeconds}
              totalDurationSeconds={recordingProgress.totalDurationSeconds}
              pendingUploadCount={recordingProgress.pendingUploadCount}
              isLoading={recordingProgress.isLoading}
              error={recordingProgress.error}
            />
            <section className="rounded-3xl border border-emerald-200 bg-white px-6 py-8 text-center shadow-sm">
              <CheckCircle2 className="mx-auto size-10 text-emerald-700" aria-hidden="true" />
              <h2 className="mt-4 text-balance text-2xl font-semibold text-stone-950">
                {effectiveAllowRecordedExercises ? '这一轮已经读完' : '这篇已经全部录过'}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-7 text-stone-600">
                系统已经停止继续出题，不会自动重复。返回文章页可以查看每句状态，想再读时再主动开启新一轮。
              </p>
              <Link href={returnHref} className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white">
                查看文章进度
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </section>
          </main>
        </div>
      )
    }

    return (
      <div className="min-h-dvh bg-stone-50">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <div>
              <Link href={returnHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
                <ArrowLeft className="h-4 w-4" />
                {returnLabel}
              </Link>
              <h1 className="mt-2 text-2xl font-semibold text-gray-900">{topicSelection.label}</h1>
              <p className="mt-1 text-sm text-gray-600">{topicSelection.description}</p>
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
          <section className="rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-8 shadow-sm">
            <h2 className="text-balance text-xl font-semibold text-gray-900">当前主题还没准备好可录句子</h2>
            <p className="mt-3 text-pretty text-sm leading-7 text-gray-600">这一组主题暂时还没有可用句子。</p>
            <Link href={returnHref} className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-700">
              回到主题选择
            </Link>
          </section>
        </main>
      </div>
    )
  }

  const itemUnit = isArticulationBaseline ? '字' : '句'
  const targetLabel = isArticulationBaseline ? '目标字' : '目标句'

  return (
      <div className="min-h-dvh bg-stone-50">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <Link
                href={returnHref}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {returnLabel}
              </Link>
              <h1 className="mt-1 text-balance text-2xl font-semibold text-gray-900">{topicSelection.label}</h1>
              <p className="mt-1 text-pretty text-sm text-gray-600">{isArticulationBaseline ? '一次只读一个字，录完再确认结果。' : '一次只做一步，录完再确认结果。'}</p>
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">

          {notice ? (
            <div
              role={notice.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={cn(
                'rounded-2xl border px-4 py-3 text-sm font-medium',
                notice.tone === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : notice.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              {notice.message}
            </div>
          ) : null}

          {collectionFlowStep === 'prepare' ? (
            <section aria-labelledby="collection-prepare-heading" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id="collection-prepare-heading" className="text-balance text-2xl font-semibold text-stone-950">
                    准备好后再开始
                  </h2>
                </div>
                {practiceMode === 'prepared_content' ? (
                  <button
                    type="button"
                    onClick={() => setIsMaterialEditorOpen(true)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:border-amber-300 hover:bg-amber-50"
                  >
                    <UploadCloud className="size-4" aria-hidden="true" />
                    换一份材料
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-pretty text-sm leading-6 text-stone-600">
                {isArticulationBaseline ? '只确认两件事。请保持设备和距离稳定，按平时说话的方式逐字录。' : '只确认两件事。构音方式不是重录理由，按你平时说话的方式录就好。'}
              </p>

              <div className="mt-6 space-y-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2">
                  <input
                    type="checkbox"
                    checked={environmentReady}
                    onChange={(event) => setEnvironmentReady(event.target.checked)}
                    className="mt-0.5 size-5 accent-amber-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-stone-950">周围比较安静</span>
                    <span className="mt-1 block text-pretty text-sm leading-6 text-stone-600">没有持续的电视声、谈话声或明显风声。</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2">
                  <input
                    type="checkbox"
                    checked={distanceReady}
                    onChange={(event) => setDistanceReady(event.target.checked)}
                    className="mt-0.5 size-5 accent-amber-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-stone-950">麦克风位置稳定</span>
                    <span className="mt-1 block text-pretty text-sm leading-6 text-stone-600">手机或麦克风离嘴约 20–30 厘米，录音时尽量别移动。</span>
                  </span>
                </label>
              </div>

              <div className={cn(
                'mt-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm',
                canSaveTrainingSample ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-800',
              )}>
                {canSaveTrainingSample ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-current" aria-hidden="true" />
                )}
                <span>
                  {canSaveTrainingSample
                    ? '数据授权已确认。录音会按训练用途保存，你仍可以在结果页选择不收录。'
                    : '当前账号缺少新的数据授权记录，请重新登录确认后再开始。'}
                </span>
              </div>

              <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-pretty text-sm text-stone-500">
                  {!environmentReady || !distanceReady ? '完成上面两项确认后即可继续。' : canSaveTrainingSample ? (isArticulationBaseline ? '准备完成，可以录第一个字了。' : '准备完成，可以录第一句了。') : '需要先补充数据授权。'}
                </p>
                <button
                  type="button"
                  onClick={() => setCollectionFlowStep('record')}
                  disabled={!collectionPreflightReady}
                  aria-describedby="collection-prepare-help"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {isArticulationBaseline ? '下一步，录一个字' : '下一步，录一句'}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
                <span id="collection-prepare-help" className="sr-only">需要确认安静环境、稳定距离和数据授权后才能继续</span>
              </div>
            </section>
          ) : null}

          {collectionFlowStep === 'record' ? (
            <section aria-labelledby="collection-record-heading" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="collection-record-heading" className="text-balance text-2xl font-semibold text-stone-950">
                    {activeSpeechVariant === 'dialect' ? `用${trainingUploadLabels.dialectName ?? '方言'}说同一句` : isArticulationBaseline ? '读出这个字' : '读出这一句'}
                  </h2>
                  <p className="mt-2 text-pretty text-sm text-stone-600">
                    {activeSpeechVariant === 'dialect'
                      ? '按你平时最自然的说法表达。题面相同，不要求逐字对应普通话。'
                      : isArticulationBaseline
                        ? '按平时说话的方式读这个字，读完点停止。'
                        : '按平时说话的方式读，读完点停止。'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {dialectPairEnabled ? (
                    <span className={cn(
                      'rounded-full px-3 py-2 text-sm font-semibold',
                      activeSpeechVariant === 'dialect' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900',
                    )}>
                      {activeSpeechVariantLabel}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                    {isRecording ? formatRecordingTime(recordingSeconds) : recorderStatus.label}
                  </span>
                </div>
              </div>

              {activeSpeechVariant === 'dialect' ? (
                <div className="mt-4 space-y-2">
                  <label htmlFor="recording-dialect" className="text-sm font-medium text-stone-900">本次录音使用的方言</label>
                  <select id="recording-dialect" value={selectedDialect ? JSON.stringify(selectedDialect) : ''}
                    disabled={isRecording || isProcessing || isReplacingAttempt}
                    aria-describedby="recording-dialect-help"
                    onChange={(event) => setSelectedDialectKey(event.target.value)}
                    className="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                    <option value="">请选择一种方言</option>
                    {dialectOptions.map((entry) => <option key={JSON.stringify(entry)} value={JSON.stringify(entry)}>{entry.name}{entry.region ? ` · ${entry.region}` : ' · 来源地区未填写'}</option>)}
                  </select>
                  <p id="recording-dialect-help" className="text-pretty text-sm text-stone-600">只标记这条方言录音；普通话录音不会使用此标签。录音开始后不能更改。</p>
                </div>
              ) : null}
              <div className="mt-6 rounded-3xl bg-amber-50 px-5 py-7 text-center ring-1 ring-amber-200 sm:px-8 sm:py-9">
                <p className="text-balance text-2xl font-semibold leading-relaxed text-stone-950 sm:text-3xl">{activeCollectionExercise?.text}</p>
                {currentPhonologyTarget?.focus ? (
                  <p className="mt-3 text-pretty text-sm text-amber-900">本句重点：{currentPhonologyTarget.focus}</p>
                ) : null}
                <div className="mt-5 flex flex-col items-center gap-2">
                  <p className="text-pretty text-sm text-stone-600">有字不认识？</p>
                  <button
                    type="button"
                    onClick={handlePlayReadingAssistance}
                    disabled={isRecording || isProcessing || isReadingAssistancePlaying}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Volume2 className="size-4" aria-hidden="true" />
                    {isReadingAssistancePlaying ? '正在朗读' : '听一下'}
                  </button>
                  <p className="min-h-5 text-pretty text-xs leading-5 text-stone-500" aria-live="polite">
                    {readingAssistanceStatus ?? '只在需要时播放，听完仍按你平时的方式说。'}
                  </p>
                </div>
              </div>

              <div className="mt-7 flex flex-col items-center text-center">
                <button
                  type="button"
                  aria-label={isRecording ? '停止录音' : '开始录音'}
                  onClick={isRecording ? () => void handleStopRecording() : () => void handleStartRecording()}
                  disabled={shouldDisableTrainingRecordingControl({
                    isProcessing,
                    isReadingAssistancePlaying,
                    status,
                  })}
                  className={cn(
                    'flex size-28 items-center justify-center rounded-full text-white shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100',
                    isRecording ? 'bg-rose-600 focus-visible:ring-rose-500' : 'bg-amber-600 focus-visible:ring-amber-500',
                  )}
                >
                  <span className="flex flex-col items-center gap-1">
                    <Mic className="size-6" aria-hidden="true" />
                    <span className="text-sm font-semibold">{isRecording ? '停止' : '开始录音'}</span>
                  </span>
                </button>
                <p className="mt-4 text-pretty text-sm leading-6 text-stone-600">{recorderStatus.description}</p>
              </div>

              {isRecording ? (
                <>
                  <MicrophoneInputFeedback analyser={analyser} active title="收音状态" className="mt-6" />
                  <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-4" aria-live="polite">
                    <p className="text-sm font-medium text-stone-900">系统正在听</p>
                    <p className="mt-2 min-h-7 text-pretty text-sm leading-6 text-stone-600">{interimText || '开始说话后，识别内容会显示在这里。'}</p>
                  </div>
                </>
              ) : null}

              {sessionError ? (
                <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{sessionError}</div>
              ) : null}

              <details className="mt-6 rounded-2xl border border-stone-200">
                <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500">
                  <span>{isArticulationBaseline ? '查看 50 字进度' : readingArticle ? '换一句' : '查看已读和未读'}</span>
                  <span className="text-xs font-normal text-stone-500">
                    {isArticulationBaseline ? `已完成 ${baselineSummary?.completedCount ?? 0}/${categoryExercises.length}` : readingArticle ? `当前还有 ${matchingExercises.length} 句` : `已读 ${recordedCategoryExerciseCount} · 未读 ${unreadCategoryExerciseCount}`}
                  </span>
                </summary>
                <div className="border-t border-stone-200 p-4">
                  {!readingArticle ? (
                    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="按朗读状态筛选">
                      {([
                        ['unread', `未读 ${unreadCategoryExerciseCount}`],
                        ['read', `已读 ${recordedCategoryExerciseCount}`],
                        ['all', `全部 ${categoryExercises.length}`],
                      ] as Array<[ExerciseStatusFilter, string]>).map(([filter, label]) => (
                        <button
                          key={filter}
                          type="button"
                          aria-pressed={exerciseStatusFilter === filter}
                          onClick={() => setExerciseStatusFilter(filter)}
                          className={cn(
                            'min-h-10 rounded-full px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2',
                            exerciseStatusFilter === filter
                              ? 'bg-amber-700 text-white'
                              : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="block">
                    <span className="sr-only">{isArticulationBaseline ? '搜索基线字' : '搜索训练句子'}</span>
                    <input
                      value={exerciseQuery}
                      onChange={(event) => setExerciseQuery(event.target.value)}
                      placeholder={isArticulationBaseline ? '搜索基线字' : '搜索句子'}
                      className="h-11 w-full rounded-xl border border-stone-300 bg-white px-4 text-sm text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </label>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {(readingArticle ? visibleExercises : visibleInventoryExercises).map((exercise) => {
                      const isActive = currentExercise.id === exercise.id
                      const isRecorded = recordedExerciseIdSet.has(exercise.id)
                      return (
                        <button
                          key={exercise.id}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => handleSelectExercise(exercise.id)}
                          disabled={isRecording || isProcessing}
                          className={cn(
                            'w-full rounded-xl border px-4 py-3 text-left text-sm leading-6 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
                            isActive ? 'border-amber-400 bg-amber-50 text-stone-950' : 'border-stone-200 bg-white text-stone-700 hover:border-amber-300',
                          )}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span>{exercise.text}</span>
                            {!readingArticle ? (
                              <span className={cn(
                                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                                isRecorded
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-900',
                              )}>
                                {isRecorded ? '已读' : '未读'}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      )
                    })}
                    {!readingArticle && visibleInventoryExercises.length === 0 ? (
                      <p className="rounded-xl bg-stone-50 px-4 py-5 text-center text-sm text-stone-600">
                        {isArticulationBaseline ? '当前筛选下没有这个字。' : '当前筛选下没有句子。'}
                      </p>
                    ) : null}
                  </div>
                  {!readingArticle && visibleInventoryExercises.length < inventoryMatchingExercises.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleInventoryLimit((current) => current + DEFAULT_VISIBLE_SENTENCES)}
                      className="mt-3 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      显示更多（还有 {inventoryMatchingExercises.length - visibleInventoryExercises.length} {isArticulationBaseline ? '字' : '句'}）
                    </button>
                  ) : null}
                </div>
              </details>

              <button
                type="button"
                onClick={() => setCollectionFlowStep('prepare')}
                disabled={isRecording || isProcessing}
                className="mt-5 min-h-11 text-sm font-medium text-stone-600 underline-offset-4 hover:text-stone-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                返回修改采集准备
              </button>
            </section>
          ) : null}

          {collectionFlowStep === 'review' && attempt ? (
            <section aria-labelledby="collection-review-heading" className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-7">
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  'flex items-start gap-4 rounded-2xl px-4 py-4 sm:px-5',
                  isReplacingAttempt ? 'bg-amber-50' : 'bg-emerald-50',
                )}
              >
                <span className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-full text-white',
                  isReplacingAttempt ? 'bg-amber-700' : 'bg-emerald-600',
                )}>
                  {isReplacingAttempt
                    ? <RotateCcw className="size-6" aria-hidden="true" />
                    : <Check className="size-6" aria-hidden="true" />}
                </span>
                <div>
                  <h2
                    id="collection-review-heading"
                    className={cn('text-balance text-xl font-semibold', isReplacingAttempt ? 'text-amber-950' : 'text-emerald-950')}
                  >
                    {isReplacingAttempt
                      ? `先撤回旧录音，再重新录${isArticulationBaseline ? '这个字' : '这一句'}`
                      : attempt.speechVariant === 'dialect'
                        ? `${attempt.dialect?.name ?? '方言'}录音已经完整收下`
                        : isArticulationBaseline ? '很好，这个字已经完整收下了' : '很好，这一句已经完整收下了'}
                  </h2>
                  <p className={cn('mt-1 text-pretty text-sm leading-6', isReplacingAttempt ? 'text-amber-900' : 'text-emerald-800')}>
                    {isReplacingAttempt
                      ? '正在撤回旧录音，完成后会自动回到这一句开始重录。'
                      : attempt.uploadStatus === 'saving'
                      ? '正在自动保存，你可以先确认系统听到的内容。'
                      : attempt.uploadStatus === 'uploaded'
                        ? '已经安全保存到你的训练数据中。'
                        : attempt.uploadStatus === 'local_only'
                          ? '录音已留在本机，网络或服务恢复后再继续同步。'
                      : `你可以回听、重录或继续下一个${itemUnit}。`}
                  </p>
                </div>
              </div>

              <dl className="mt-5 divide-y divide-stone-200 rounded-2xl border border-stone-200 px-4 sm:px-5">
                <div className="grid gap-1 py-4 sm:grid-cols-[5rem_1fr] sm:gap-4">
                  <dt className="text-sm font-medium text-stone-500">{targetLabel}</dt>
                  <dd className="text-pretty text-base leading-7 text-stone-950">{attempt.exercise.text}</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[5rem_1fr] sm:gap-4">
                  <dt className="text-sm font-medium text-stone-500">系统听到</dt>
                  <dd className="text-pretty text-base leading-7 text-stone-950">
                    {attempt.transcriptStatus === 'pending'
                      ? '正在后台完成识别…'
                      : attempt.transcript || '这次没有拿到稳定的识别文本，但录音仍可回听。'}
                  </dd>
                </div>
              </dl>

              {attempt.recording && attemptPlaybackUrl ? (
                <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-4">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-stone-900">
                    <PlayCircle className="size-4 text-amber-700" aria-hidden="true" />
                    回听录音 · {formatRecordingTime(attempt.recording.audio.durationSeconds)}
                  </p>
                  <audio controls preload="metadata" src={attemptPlaybackUrl} className="mt-3 w-full">
                    当前浏览器暂不支持直接播放这条录音。
                  </audio>
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleContinueAfterAttempt}
                  disabled={isReplacingAttempt}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {attempt.speechVariant === 'mandarin' && dialectPairEnabled ? `继续录${trainingUploadLabels.dialectName ?? '方言'}` : (isArticulationBaseline ? '继续下一个字' : '继续下一句')}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRetryCurrentExercise()}
                  disabled={isProcessing || isRecording || isReplacingAttempt || attempt.uploadStatus === 'discarding'}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800 transition-colors duration-150 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {isReplacingAttempt ? '正在撤回旧录音…' : (isArticulationBaseline ? '重录这个字' : '重录这一句')}
                </button>
              </div>
              {attempt.speechVariant === 'mandarin' && dialectPairEnabled ? (
                <button
                  type="button"
                  onClick={handleSkipDialect}
                  disabled={isReplacingAttempt}
                  className="mt-3 min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  这句先跳过方言
                </button>
              ) : null}
              <p className="mt-3 text-pretty text-xs leading-5 text-stone-500">
                重录会先撤回当前版本，再保存新录音，不会同时留下两条。
              </p>
              <button
                type="button"
                onClick={() => void handleDiscardAttempt()}
                disabled={isReplacingAttempt || attempt.uploadStatus === 'discarding' || attempt.uploadStatus === 'discarded'}
                className="mt-3 min-h-11 w-full text-sm font-medium text-stone-600 underline-offset-4 hover:text-stone-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                这条不收录
              </button>
            </section>
          ) : null}

          {collectionFlowStep === 'review' && !attempt ? (
            <section className="rounded-3xl border border-stone-200 bg-white p-6 text-center">
              <p className="text-pretty text-sm text-stone-600">{isArticulationBaseline ? '这次结果已处理，可以继续录下一个字。' : '这次结果已处理，可以继续录下一句。'}</p>
              <button type="button" onClick={handleContinueAfterAttempt} className="mt-4 rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white">继续录音</button>
            </section>
          ) : null}

          <details className="rounded-2xl border border-stone-200 bg-white">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500">
              <span>{isArticulationBaseline ? '本轮进度' : '本轮与主题信息'}</span>
              <span className="text-xs font-normal text-stone-500">{isArticulationBaseline ? '完成数与系统听懂' : '进度、待补登与材料'}</span>
            </summary>
            <div className="grid gap-3 border-t border-stone-200 p-4 sm:grid-cols-3">
              <div className="rounded-xl bg-stone-50 px-4 py-3"><p className="text-xs text-stone-500">本轮已录</p><p className="mt-1 font-semibold text-stone-900 tabular-nums">{sessionPracticedExerciseIds.length} {isArticulationBaseline ? '字' : '句'}</p></div>
              <div className="rounded-xl bg-stone-50 px-4 py-3"><p className="text-xs text-stone-500">待补登</p><p className="mt-1 font-semibold text-stone-900 tabular-nums">{localQueueItems.length} 条</p></div>
              <div className="rounded-xl bg-stone-50 px-4 py-3"><p className="text-xs text-stone-500">{isArticulationBaseline ? '系统听懂' : '当前主题'}</p><p className="mt-1 font-semibold text-stone-900">{isArticulationBaseline ? formatPercent(baselineSummary?.systemUnderstandingRatio ?? 0) : topicSelection.label}</p></div>
            </div>
          </details>
        </main>
      </div>
  )
}
