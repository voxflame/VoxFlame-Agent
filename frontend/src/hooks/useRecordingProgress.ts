'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { config } from '@/lib/config'
import type { VoxFlameRecorderQueueItem } from '@/lib/recording/recording-contract'
import { getAccessToken } from '@/lib/supabase/client'

export interface CloudRecordingProgress {
  recordedSentenceIds: string[]
  recordedReadingSegmentIds: string[]
  recordedReadingRoundKeys: string[]
  readingArticleRoundIds: Record<string, string>
  lastRecordedExerciseIds: Record<string, string>
  todayDurationSeconds: number
  totalDurationSeconds: number
}

export interface RecordingProgress extends CloudRecordingProgress {
  pendingUploadCount: number
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  refresh: () => Promise<void>
}

const RECORDING_PROGRESS_TIMEOUT_MS = 8_000
// Keep the visible counter fresh for long-running recording sessions while
// avoiding a request on every render. Upload confirmation remains the source
// of truth; polling only re-reads the durable aggregate.
const RECORDING_PROGRESS_POLL_INTERVAL_MS = 60_000

const EMPTY_PROGRESS: CloudRecordingProgress = {
  recordedSentenceIds: [],
  recordedReadingSegmentIds: [],
  recordedReadingRoundKeys: [],
  readingArticleRoundIds: {},
  lastRecordedExerciseIds: {},
  todayDurationSeconds: 0,
  totalDurationSeconds: 0,
}

export function isRecordingProgressRequestTimedOut(
  startedAt: number,
  now: number,
): boolean {
  return now - startedAt >= RECORDING_PROGRESS_TIMEOUT_MS
}

export function isCurrentRecordingProgressRequest(
  requestUserId: string,
  requestGeneration: number,
  currentUserId: string | null,
  currentGeneration: number,
): boolean {
  return requestUserId === currentUserId && requestGeneration === currentGeneration
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort()
}

/** Merge durable cloud progress with recordings still waiting in this browser. */
export function mergeRecordingProgress(
  cloud: CloudRecordingProgress,
  localQueueItems: VoxFlameRecorderQueueItem[],
): CloudRecordingProgress & { pendingUploadCount: number } {
  const pendingUploadCount = new Set(localQueueItems.map((item) => item.recordingId)).size
  const localSentenceIds = localQueueItems
    .map((item) => item.sentenceId?.trim() ?? '')
    .filter(Boolean)
  const localReadingSegmentIds = localQueueItems
    .map((item) => (
      typeof item.metadata.reading_segment_id === 'string'
        ? item.metadata.reading_segment_id.trim()
        : ''
    ))
    .filter(Boolean)
  const localReadingRoundKeys = localQueueItems.flatMap((item) => {
    const segmentId = typeof item.metadata.reading_segment_id === 'string'
      ? item.metadata.reading_segment_id.trim()
      : ''
    if (!segmentId) {
      return []
    }
    const roundId = typeof item.metadata.reading_round_id === 'string'
      ? item.metadata.reading_round_id.trim()
      : 'initial'
    return [`${roundId || 'initial'}:${segmentId}`]
  })
  const localResumeAnchors = new Map<string, { exerciseId: string; createdAt: number; order: number }>()
  for (const [order, item] of localQueueItems.entries()) {
    const exerciseId = item.sentenceId?.trim() ?? ''
    if (!exerciseId) continue

    const preparedExpressionId = typeof item.metadata.prepared_expression_id === 'string'
      ? item.metadata.prepared_expression_id.trim()
      : ''
    const readingArticleId = typeof item.metadata.reading_article_id === 'string'
      ? item.metadata.reading_article_id.trim()
      : ''
    const exerciseCategory = typeof item.metadata.exercise_category === 'string'
      ? item.metadata.exercise_category.trim()
      : ''
    const scopeKey = preparedExpressionId
      ? `prepared_expression:${preparedExpressionId}`
      : !readingArticleId && exerciseCategory
        ? `category:${exerciseCategory}`
        : null
    if (!scopeKey) continue

    const createdAt = Date.parse(item.createdAt)
    const candidate = {
      exerciseId,
      createdAt: Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY,
      order,
    }
    const existing = localResumeAnchors.get(scopeKey)
    if (
      !existing
      || candidate.createdAt > existing.createdAt
      || (candidate.createdAt === existing.createdAt && candidate.order > existing.order)
    ) {
      localResumeAnchors.set(scopeKey, candidate)
    }
  }

  return {
    recordedSentenceIds: uniqueStrings([...cloud.recordedSentenceIds, ...localSentenceIds]),
    recordedReadingSegmentIds: uniqueStrings([
      ...cloud.recordedReadingSegmentIds,
      ...localReadingSegmentIds,
    ]),
    recordedReadingRoundKeys: uniqueStrings([
      ...cloud.recordedReadingRoundKeys,
      ...localReadingRoundKeys,
    ]),
    readingArticleRoundIds: cloud.readingArticleRoundIds,
    lastRecordedExerciseIds: {
      ...cloud.lastRecordedExerciseIds,
      ...Object.fromEntries(
        Array.from(localResumeAnchors.entries()).map(([key, value]) => [key, value.exerciseId]),
      ),
    },
    todayDurationSeconds: cloud.todayDurationSeconds,
    totalDurationSeconds: cloud.totalDurationSeconds,
    pendingUploadCount,
  }
}

export function useRecordingProgress(
  userId: string | null,
  isAuthenticated: boolean,
  localQueueItems: VoxFlameRecorderQueueItem[] = [],
): RecordingProgress {
  const [cloudState, setCloudState] = useState<{
    userId: string | null
    progress: CloudRecordingProgress
  }>({ userId: null, progress: EMPTY_PROGRESS })
  const [isLoading, setIsLoading] = useState(Boolean(isAuthenticated && userId))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previousLocalQueueCountRef = useRef(localQueueItems.length)
  const hasLoadedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const activeRequestRef = useRef<{
    userId: string
    generation: number
    controller: AbortController
    promise: Promise<void>
  } | null>(null)

  const refresh = useCallback(() => {
    if (!isAuthenticated || !userId) {
      activeRequestRef.current?.controller.abort()
      activeRequestRef.current = null
      setCloudState({ userId: null, progress: EMPTY_PROGRESS })
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedRef.current = false
      return Promise.resolve()
    }

    const activeRequest = activeRequestRef.current
    if (activeRequest?.userId === userId) {
      return activeRequest.promise
    }

    activeRequest?.controller.abort()
    const requestUserId = userId
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    const isInitialLoad = !hasLoadedRef.current
    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    setError(null)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), RECORDING_PROGRESS_TIMEOUT_MS)
    const request = (async () => {
      try {
        const token = await getAccessToken()
        if (!token) {
          throw new Error('auth_required')
        }

        const timezoneOffsetMinutes = new Date().getTimezoneOffset()
        const response = await fetch(
          `${config.api.baseUrl}/upload/progress?timezoneOffsetMinutes=${timezoneOffsetMinutes}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          throw new Error(`progress_${response.status}`)
        }

        const payload = await response.json() as Partial<CloudRecordingProgress>
        if (!isCurrentRecordingProgressRequest(
          requestUserId,
          requestGeneration,
          userId,
          requestGenerationRef.current,
        )) {
          return
        }

        setCloudState({ userId: requestUserId, progress: {
          recordedSentenceIds: Array.isArray(payload.recordedSentenceIds)
            ? payload.recordedSentenceIds.filter((item): item is string => typeof item === 'string')
            : [],
          recordedReadingSegmentIds: Array.isArray(payload.recordedReadingSegmentIds)
            ? payload.recordedReadingSegmentIds.filter((item): item is string => typeof item === 'string')
            : [],
          recordedReadingRoundKeys: Array.isArray(payload.recordedReadingRoundKeys)
            ? payload.recordedReadingRoundKeys.filter((item): item is string => typeof item === 'string')
            : [],
          readingArticleRoundIds: payload.readingArticleRoundIds
            && typeof payload.readingArticleRoundIds === 'object'
            && !Array.isArray(payload.readingArticleRoundIds)
              ? Object.fromEntries(
                  Object.entries(payload.readingArticleRoundIds)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
                )
              : {},
          lastRecordedExerciseIds: payload.lastRecordedExerciseIds
            && typeof payload.lastRecordedExerciseIds === 'object'
            && !Array.isArray(payload.lastRecordedExerciseIds)
              ? Object.fromEntries(
                  Object.entries(payload.lastRecordedExerciseIds)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
                )
              : {},
          todayDurationSeconds: typeof payload.todayDurationSeconds === 'number'
            ? Math.max(0, payload.todayDurationSeconds)
            : 0,
          totalDurationSeconds: typeof payload.totalDurationSeconds === 'number'
            ? Math.max(0, payload.totalDurationSeconds)
            : 0,
        } })
      } catch (refreshError) {
        if (!isCurrentRecordingProgressRequest(
          requestUserId,
          requestGeneration,
          userId,
          requestGenerationRef.current,
        )) {
          return
        }
        console.error('[recording-progress] refresh failed:', refreshError)
        setError('云端录音进度暂时没有更新；页面仍可继续录音，本机记录不会丢失。')
      } finally {
        window.clearTimeout(timeoutId)
        if (!isCurrentRecordingProgressRequest(
          requestUserId,
          requestGeneration,
          userId,
          requestGenerationRef.current,
        )) {
          return
        }
        hasLoadedRef.current = true
        setIsLoading(false)
        setIsRefreshing(false)
        activeRequestRef.current = null
      }
    })()

    activeRequestRef.current = {
      userId: requestUserId,
      generation: requestGeneration,
      controller,
      promise: request,
    }
    return request
  }, [isAuthenticated, userId])

  useEffect(() => {
    requestGenerationRef.current += 1
    activeRequestRef.current?.controller.abort()
    activeRequestRef.current = null
    hasLoadedRef.current = false
    previousLocalQueueCountRef.current = localQueueItems.length
    setCloudState({ userId: null, progress: EMPTY_PROGRESS })
    setError(null)
    setIsRefreshing(false)
    setIsLoading(Boolean(isAuthenticated && userId))
  }, [isAuthenticated, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const previousCount = previousLocalQueueCountRef.current
    previousLocalQueueCountRef.current = localQueueItems.length
    if (isAuthenticated && userId && localQueueItems.length < previousCount) {
      void refresh()
    }
  }, [isAuthenticated, localQueueItems.length, refresh, userId])

  // Other devices can upload while this page stays open. Refresh visible pages
  // once per minute, and immediately on return/reconnection.
  useEffect(() => {
    if (!isAuthenticated || !userId) return
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(refreshVisible, RECORDING_PROGRESS_POLL_INTERVAL_MS)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('online', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [isAuthenticated, refresh, userId])

  useEffect(() => () => {
    requestGenerationRef.current += 1
    activeRequestRef.current?.controller.abort()
    activeRequestRef.current = null
  }, [])

  const cloud = cloudState.userId === userId ? cloudState.progress : EMPTY_PROGRESS

  const merged = useMemo(
    () => mergeRecordingProgress(cloud, isAuthenticated
      ? localQueueItems.filter((item) => item.contributorId === userId)
      : []),
    [cloud, isAuthenticated, localQueueItems, userId],
  )

  return {
    ...merged,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
