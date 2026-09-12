/**
 * useVoiceUpload Hook
 * 
 * 处理语音录音的上传逻辑
 * 本机持久化录音，并在明确的恢复事件上同步到云端。
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { normalizeRecordingToWav } from '@/lib/audio/recording-to-wav'
import {
  enqueueRecorderQueueItem,
  getRecorderQueueItem,
  listRecorderQueueItems,
  removeRecorderQueueItem,
  updateRecorderQueueItem,
} from '@/lib/recording/recorder-queue'
import type {
  VoxFlameConsentScope,
  VoxFlameRecorderQueueItem,
  VoxFlameRecordingEnvelope,
} from '@/lib/recording/recording-contract'
import {
  selectRecorderQueueItemsForAccount,
  selectRecorderQueueItemsForSync,
} from '@/lib/recording/recorder-sync-policy'
import { getAccessToken } from '@/lib/supabase/client'
import { useAuth } from './useAuth'
import { config } from '@/lib/config'
import { sanitizeTrainingUploadMetadata } from '@/lib/recording/upload-metadata'
import { fetchUploadRequest, fetchUploadRequestWithRetry } from '@/lib/recording/upload-request'

interface UploadOptions {
  /** 录音对应的文本内容 */
  text: string
  /** 前端识别出的句子，仅用于反馈与样本诊断 */
  recognizedText?: string
  /** 来源：guided_recording | free_recording | transcription_page */
  source?: string
  /** 句子ID（引导模式时） */
  sentenceId?: string
  /** 录音结构化 envelope */
  recording: VoxFlameRecordingEnvelope
  /** 上传授权范围 */
  consentScope?: VoxFlameConsentScope
  /** 结构化元数据 */
  metadata?: Record<string, unknown>
}

export interface UploadReceipt {
  recordingId: string
  contributionId?: string | null
  manifestPath?: string
  storagePath?: string
  reusedContribution?: boolean
  manifestAlreadySynced?: boolean
  source: 'cloud' | 'local_queue'
  syncStatus: 'uploaded' | 'local_only'
  message: string
}

export interface UploadResult {
  ok: boolean
  status: 'uploaded' | 'local_only' | 'auth_required' | 'failed'
  receipt?: UploadReceipt
  errorMessage?: string
}

export interface DiscardUploadOptions {
  recordingId: string
  contributionId?: string | null
  storagePath?: string | null
}

export interface DiscardUploadResult {
  ok: boolean
  status: 'discarded' | 'auth_required' | 'failed'
  errorMessage?: string
}

function toStorageSegment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'unknown'
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '')
}

export function useVoiceUpload() {
  const [isUploading, setIsUploading] = useState(false)
  const [isSyncingLocalQueue, setIsSyncingLocalQueue] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [localQueueCount, setLocalQueueCount] = useState(0)
  const [localQueueItems, setLocalQueueItems] = useState<VoxFlameRecorderQueueItem[]>([])
  const [lastUploadReceipt, setLastUploadReceipt] = useState<UploadReceipt | null>(null)
  const activeUploadCountRef = useRef(0)
  const lastAuthenticatedUserIdRef = useRef<string | null>(null)
  const syncPromiseRef = useRef<Promise<{ synced: number; total: number }> | null>(null)
  const syncLocalRecordingsRef = useRef<(silent?: boolean) => Promise<{ synced: number; total: number }>>(async () => ({ synced: 0, total: 0 }))

  const { userId, isAuthenticated } = useAuth()

  useEffect(() => {
    if (userId) {
      lastAuthenticatedUserIdRef.current = userId
    }
  }, [userId])

  const refreshLocalQueueCount = useCallback(async () => {
    try {
      const allItems = await listRecorderQueueItems()
      const accountItems = selectRecorderQueueItemsForAccount(allItems, userId)
      setLocalQueueItems(accountItems)
      setLocalQueueCount(accountItems.length)
      return accountItems.length
    } catch {
      setLocalQueueItems([])
      setLocalQueueCount(0)
      return 0
    }
  }, [userId])

  useEffect(() => {
    void refreshLocalQueueCount()
  }, [refreshLocalQueueCount])

  /** Persist the source recording before waiting for infrastructure recovery. */
  const saveLocally = useCallback(async (
    options: UploadOptions,
    contributorId: string,
    failureReason?: string,
  ): Promise<UploadResult> => {
    try {
      const existingItem = await getRecorderQueueItem(options.recording.recordingId)
      const localRecord: VoxFlameRecorderQueueItem = {
        recordingId: options.recording.recordingId,
        contributorId,
        text: options.text,
        sentenceId: options.sentenceId,
        source: options.source,
        consentScope: options.consentScope ?? 'training_only',
        syncStatus: 'local_only',
        syncAttempts: existingItem?.syncAttempts ?? 0,
        lastAttemptAt: existingItem?.lastAttemptAt,
        lastError: failureReason,
        metadata: {
          ...(existingItem?.metadata || {}),
          ...(options.metadata || {}),
        },
        createdAt: options.recording.createdAt,
        recording: options.recording,
      }

      await enqueueRecorderQueueItem(localRecord)

      await refreshLocalQueueCount()
      setLastError(null)
      setUploadProgress(100)
      const receipt: UploadReceipt = {
        recordingId: options.recording.recordingId,
        source: 'local_queue',
        syncStatus: 'local_only',
        message: existingItem
          ? '这条录音仍安全保存在本机，云端恢复后可继续同步。'
          : '录音已安全保存在本机，云端恢复后可继续同步。',
      }
      setLastUploadReceipt(receipt)
      return {
        ok: true,
        status: 'local_only',
        receipt,
      }
    } catch {
      console.error('[recording-upload] local persistence failed')
      setLastError('保存失败，请检查存储空间')
      return {
        ok: false,
        status: 'failed',
        errorMessage: '保存失败，请检查存储空间',
      }
    }
  }, [refreshLocalQueueCount])

  /**
   * 上传录音
   */
  const uploadRecording = useCallback(async (
    audioBlob: Blob,
    options: UploadOptions
  ): Promise<UploadResult> => {
    activeUploadCountRef.current += 1
    setIsUploading(true)
    setUploadProgress(0)
    setLastError(null)
    setLastUploadReceipt(null)
    let effectiveOptions: UploadOptions = options

    try {
      const recordingOwnerId = userId ?? lastAuthenticatedUserIdRef.current
      if (!isAuthenticated || !userId) {
        if (recordingOwnerId) {
          return await saveLocally(options, recordingOwnerId, '登录会话暂时不可用')
        }
        const errorMessage = '请先登录后再上传训练语料。'
        setLastError(errorMessage)
        return {
          ok: false,
          status: 'auth_required',
          errorMessage,
        }
      }

      const token = await getAccessToken()
      if (!token) {
        return await saveLocally(options, userId, '登录会话暂时不可用')
      }

      const recordingForNormalization = audioBlob === options.recording.audio.blob
        ? options.recording
        : {
            ...options.recording,
            audio: {
              ...options.recording.audio,
              blob: audioBlob,
              format: audioBlob.type || options.recording.audio.format,
              fileSizeBytes: audioBlob.size || options.recording.audio.fileSizeBytes,
            },
          }

      let normalizedRecording: VoxFlameRecordingEnvelope
      try {
        normalizedRecording = await normalizeRecordingToWav(recordingForNormalization)
      } catch (error) {
        console.error('录音转 WAV 失败:', error)
        const errorMessage = '录音处理失败，请重试。'
        setLastError(errorMessage)
        return {
          ok: false,
          status: 'failed',
          errorMessage,
        }
      }

      const normalizedOptions: UploadOptions = {
        ...options,
        recording: normalizedRecording,
      }
      effectiveOptions = normalizedOptions
      const normalizedAudioBlob = normalizedRecording.audio.blob

      // 1. 准备文件名与存储路径 (按 有标注/无标注 分类)
      const ext = normalizedAudioBlob.type.includes('wav')
        ? 'wav'
        : normalizedAudioBlob.type.includes('mp4')
          ? 'mp4'
          : 'webm'
      const recordingId = normalizedOptions.recording.recordingId
      const sessionId = toStorageSegment(normalizedOptions.recording.sessionId)

      let storagePath = ''

      if (normalizedOptions.source === 'guided_recording' && normalizedOptions.sentenceId) {
        const categorySegment = toStorageSegment(normalizedOptions.metadata?.exercise_category)
        storagePath =
          `supervised/mandarin/${categorySegment}/${userId}/` +
          `${recordingId}.${ext}`
      } else {
        storagePath = `weak-supervision/dialogue/${userId}/${sessionId}/${recordingId}.${ext}`
      }

      setUploadProgress(20)

      // 2. 尝试上传到 OSS (通过后端签名)
      try {
        // Use config.api.baseUrl which handles rewrites (e.g. /api)
        const signRes = await fetchUploadRequestWithRetry(`${config.api.baseUrl}/upload/sign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename: storagePath,
            contentType: normalizedAudioBlob.type || 'audio/wav'
          })
        }, { onUnauthorized: getAccessToken })

        if (!signRes.ok) throw new Error(`签名请求失败: ${signRes.statusText}`)
        const { url: uploadUrl } = await signRes.json()

        // PUT 上传
        const uploadRes = await fetchUploadRequest(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': normalizedAudioBlob.type || 'audio/wav' },
          body: normalizedAudioBlob
        })

        if (!uploadRes.ok) throw new Error(`OSS上传失败: ${uploadRes.statusText}`)
      } catch (uploadError: unknown) {
        console.warn('[recording-upload] cloud unavailable; recording kept locally')
        return await saveLocally(
          normalizedOptions,
          userId,
          '云端保存失败',
        )
      }

      setUploadProgress(50)

      // 3. 通知后端完成 (DB写入 + OSS Manifest追加)
      const completeRes = await fetchUploadRequestWithRetry(`${config.api.baseUrl}/upload/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          audioPath: storagePath,
          text: normalizedOptions.text,
          recognizedText: normalizedOptions.recognizedText || null,
          sentenceId: normalizedOptions.sentenceId || null,
          duration: normalizedOptions.recording.audio.durationSeconds,
          source: normalizedOptions.source,
          metadata: {
            recording_id: normalizedOptions.recording.recordingId,
            session_id: normalizedOptions.recording.sessionId,
            mode: normalizedOptions.recording.mode,
            source_surface: normalizedOptions.recording.sourceSurface,
            collection_mode: normalizedOptions.recording.collectionMode,
            consent_scope: normalizedOptions.consentScope ?? 'training_only',
            source: normalizedOptions.source || 'unknown',
            timestamp: normalizedOptions.recording.createdAt,
            storage_type: 'oss',
            audio_format: normalizedOptions.recording.audio.format,
            sample_rate: normalizedOptions.recording.audio.sampleRate,
            channel_count: normalizedOptions.recording.audio.channelCount,
            duration_ms: normalizedOptions.recording.audio.durationMs,
            file_size_bytes: normalizedOptions.recording.audio.fileSizeBytes,
            capture_transport: normalizedOptions.recording.audio.captureTransport,
            speech_duration_ms: normalizedOptions.recording.audio.quality?.speechDurationMs,
            leading_silence_ms: normalizedOptions.recording.audio.quality?.leadingSilenceMs,
            trailing_silence_ms: normalizedOptions.recording.audio.quality?.trailingSilenceMs,
            silence_ratio: normalizedOptions.recording.audio.quality?.silenceRatio,
            input_level_rms: normalizedOptions.recording.audio.quality?.inputLevelRms,
            input_level_peak: normalizedOptions.recording.audio.quality?.inputLevelPeak,
            audio_quality_disposition: normalizedOptions.recording.audio.quality?.disposition,
            audio_quality_reasons: normalizedOptions.recording.audio.quality?.reasons,
            ...sanitizeTrainingUploadMetadata(normalizedOptions.metadata),
          }
        })
      }, { onUnauthorized: getAccessToken })

      if (!completeRes.ok) {
        throw new Error(`后端记录失败: ${completeRes.statusText}`)
      }
      const completePayload = await completeRes.json() as {
        contributionId?: string | null
        manifestPath?: string
        recordingId?: string
        reusedContribution?: boolean
        manifestAlreadySynced?: boolean
      }

      setUploadProgress(80)

      // 4. 更新贡献者统计 (暂时跳过，或者也移交给后端)
      // 由于 RLS 或 RPC 权限，前端直接调用可能失败。
      // 可以将 stats_increment Logic 放入 /api/upload/complete 后端处理中。

      setUploadProgress(100)
      void refreshLocalQueueCount()
      const receipt: UploadReceipt = {
        recordingId: completePayload.recordingId || recordingId,
        contributionId: completePayload.contributionId ?? null,
        manifestPath: completePayload.manifestPath,
        storagePath,
        reusedContribution: completePayload.reusedContribution,
        manifestAlreadySynced: completePayload.manifestAlreadySynced,
        source: 'cloud',
        syncStatus: 'uploaded',
        message: completePayload.manifestAlreadySynced
          ? '同一条录音已经在训练资产里了，这次重试已安全复用；同一句的新录音仍会保留为独立样本。'
          : '录音已上传并写入训练 manifest；同一句后续再练也会保留为新的样本。',
      }
      setLastUploadReceipt(receipt)
      return {
        ok: true,
        status: 'uploaded',
        receipt,
      }

    } catch (err) {
      console.error('[recording-upload] cloud persistence failed')
      return await saveLocally(
        effectiveOptions,
        userId || 'unknown-user',
        '云端保存失败',
      )
    } finally {
      activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1)
      setIsUploading(activeUploadCountRef.current > 0)
    }
  }, [isAuthenticated, refreshLocalQueueCount, saveLocally, userId])

  const discardUploadedRecording = useCallback(async (
    options: DiscardUploadOptions,
  ): Promise<DiscardUploadResult> => {
    if (!options.contributionId && !options.storagePath) {
      if (options.recordingId) {
        await removeRecorderQueueItem(options.recordingId)
        await refreshLocalQueueCount()
      }
      return {
        ok: true,
        status: 'discarded',
      }
    }

    if (!isAuthenticated || !userId) {
      const errorMessage = '请先登录后再撤回训练样本。'
      setLastError(errorMessage)
      return {
        ok: false,
        status: 'auth_required',
        errorMessage,
      }
    }

    const token = await getAccessToken()
    if (!token) {
      const errorMessage = '登录状态已失效，请重新登录后再撤回。'
      setLastError(errorMessage)
      return {
        ok: false,
        status: 'auth_required',
        errorMessage,
      }
    }

    try {
      const response = await fetch(`${config.api.baseUrl}/upload/contribution`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contributionId: options.contributionId ?? null,
          audioPath: options.storagePath ?? null,
          recordingId: options.recordingId,
        }),
      })

      if (!response.ok) {
        throw new Error(`discard_upload_${response.status}`)
      }

      if (options.recordingId) {
        await removeRecorderQueueItem(options.recordingId)
        await refreshLocalQueueCount()
      }
      setLastError(null)
      setLastUploadReceipt(null)
      return {
        ok: true,
        status: 'discarded',
      }
    } catch (error) {
      const errorMessage = '撤回失败，请重试。'
      setLastError(errorMessage)
      return {
        ok: false,
        status: 'failed',
        errorMessage,
      }
    }
  }, [isAuthenticated, refreshLocalQueueCount, userId])

  /**
   * 同步本地记录到云端
   */
  const syncLocalRecordings = useCallback((silent: boolean = false) => {
    if (syncPromiseRef.current) {
      return syncPromiseRef.current
    }

    const syncPromise = (async () => {
      if (!silent) {
        setLastError(null)
      }

      if (!isAuthenticated || !userId) {
        return { synced: 0, total: 0 }
      }

      setIsSyncingLocalQueue(true)
      const queued = await listRecorderQueueItems()
      const unsynced = selectRecorderQueueItemsForSync(
        queued,
        userId,
        Date.now(),
        !silent,
      )
      if (unsynced.length === 0) {
        return { synced: 0, total: 0 }
      }

      let syncedCount = 0

      for (const record of unsynced) {
      try {
        await updateRecorderQueueItem(record.recordingId, (current) => {
          if (!current) {
            return current
          }

          return {
            ...current,
            syncStatus: 'upload_pending',
            syncAttempts: (current.syncAttempts ?? 0) + 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: undefined,
          }
        })

        const result = await uploadRecording(record.recording.audio.blob, {
          text: record.text,
          recognizedText:
            typeof record.metadata?.recognized_text === 'string'
              ? record.metadata.recognized_text
              : undefined,
          source: record.source,
          sentenceId: record.sentenceId,
          metadata: record.metadata || {},
          consentScope: record.consentScope,
          recording: record.recording,
        })

        if (result.status === 'uploaded') {
          await removeRecorderQueueItem(record.recordingId)
          syncedCount++
          continue
        }

        if (result.status === 'auth_required') {
          await updateRecorderQueueItem(record.recordingId, (current) => (
            current
              ? {
                  ...current,
                  syncStatus: 'failed',
                  lastError: result.errorMessage || '登录后才能继续自动补登录音。',
                }
              : current
          ))
          break
        }

        if (result.status === 'failed' || result.status === 'local_only') {
          await updateRecorderQueueItem(record.recordingId, (current) => (
            current
              ? {
                  ...current,
                  syncStatus: 'local_only',
                  lastError: result.errorMessage || '云端暂时不可用，录音仍保存在本机。',
                }
              : current
          ))
          break
        }
      } catch {
        console.error('[recording-upload] queue sync failed')
        await updateRecorderQueueItem(record.recordingId, (current) => (
          current
            ? {
                ...current,
                syncStatus: 'failed',
                lastError: '同步失败，请重试。',
              }
            : current
        ))
        break
      }
      }
      await refreshLocalQueueCount()
      return { synced: syncedCount, total: unsynced.length }
    })().finally(() => {
      setIsSyncingLocalQueue(false)
      syncPromiseRef.current = null
    })

    syncPromiseRef.current = syncPromise
    return syncPromise
  }, [isAuthenticated, refreshLocalQueueCount, uploadRecording, userId])

  syncLocalRecordingsRef.current = syncLocalRecordings

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      return
    }
    void syncLocalRecordingsRef.current(true)
  }, [isAuthenticated, userId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleOnline = () => {
      void syncLocalRecordingsRef.current(true)
    }

    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        void syncLocalRecordingsRef.current(true)
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisible)

    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [syncLocalRecordings])

  /**
   * 获取本地未同步的记录数量
   */
  const getLocalRecordCount = useCallback(() => {
    return localQueueCount
  }, [localQueueCount])

  return {
    uploadRecording,
    discardUploadedRecording,
    syncLocalRecordings,
    getLocalRecordCount,
    isUploading,
    isSyncingLocalQueue,
    uploadProgress,
    lastError,
    lastUploadReceipt,
    localQueueCount,
    localQueueItems,
    refreshLocalQueueCount,
  }
}
