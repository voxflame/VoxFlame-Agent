import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'

import {
  discardMobileRecorderQueueItem,
  uploadMobileRecorderQueueItem,
} from '../api/mobile-upload-client'
import type { MobileAuthTokenProvider } from '../api/mobile-workbench-client'
import type { MobileWorkbenchSurfaceId } from '../constants/surfaces'
import type {
  MobileWorkbenchRecorderQueueItem,
  MobileWorkbenchRecordingMode,
  MobileWorkbenchUploadReceipt,
} from '../contracts/workbench-contracts'
import {
  appendNativeRecorderQueueItem,
  loadNativeRecorderQueue,
  persistNativeRecordingFile,
  removeNativeRecorderQueueItem,
  updateNativeRecorderQueueItemRecognition,
  updateNativeRecorderQueueItemStatus,
} from './native-recorder-storage'
import { assessMobileRecordingQuality } from './recording-quality'
import {
  recorderQueueItemBelongsToContributor,
  recorderQueueItemsForContributor,
  summarizeRecorderQueue,
} from './recorder-queue-policy'
import { toMobileProductMessage } from '../ui/product-message'

export type NativeRecorderPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'undetermined'

export interface NativeRecorderQueueState {
  items: MobileWorkbenchRecorderQueueItem[]
  latestItem: MobileWorkbenchRecorderQueueItem | null
  summary: ReturnType<typeof summarizeRecorderQueue>
  permissionStatus: NativeRecorderPermissionStatus
  isRecording: boolean
  durationMs: number
  isPlayingLatest: boolean
  isUploading: boolean
  uploadingRecordingId: string | null
  lastUploadReceipt: MobileWorkbenchUploadReceipt | null
  errorMessage: string | null
  refreshQueue(): Promise<void>
  requestPermission(): Promise<boolean>
  startRecording(
    text: string,
    context?: {
      sentenceId?: string
      source?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<boolean>
  stopRecording(): Promise<MobileWorkbenchRecorderQueueItem | null>
  playRecording(recordingId: string): void
  playLatest(): void
  discard(recordingId: string): Promise<boolean>
  attachRecognition(
    recordingId: string,
    recognizedText: string,
    metadata?: Record<string, unknown>,
  ): Promise<MobileWorkbenchRecorderQueueItem | null>
  markUploadPending(recordingId: string): Promise<void>
  uploadRecording(
    recordingId: string,
    itemOverride?: MobileWorkbenchRecorderQueueItem,
  ): Promise<MobileWorkbenchUploadReceipt | null>
}

function createRecordingId(): string {
  const timestamp = Date.now().toString(36)
  const randomSuffix = Math.random().toString(36).slice(2, 10)
  return `mobile-rec-${timestamp}-${randomSuffix}`
}

function normalizePermissionStatus(status: string): NativeRecorderPermissionStatus {
  if (status === 'granted' || status === 'denied' || status === 'undetermined') {
    return status
  }

  return 'unknown'
}

export function useNativeRecorderQueue(params: {
  apiBaseUrl: string | null
  contributorId: string | null
  tokenProvider: MobileAuthTokenProvider
  surface: MobileWorkbenchSurfaceId
  mode: MobileWorkbenchRecordingMode
}): NativeRecorderQueueState {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 250)
  const latestPlayer = useAudioPlayer(null)
  const [items, setItems] = useState<MobileWorkbenchRecorderQueueItem[]>([])
  const [permissionStatus, setPermissionStatus] =
    useState<NativeRecorderPermissionStatus>('unknown')
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null)
  const [recordingText, setRecordingText] = useState('')
  const [recordingContext, setRecordingContext] = useState<{
    sentenceId?: string
    source?: string
    metadata?: Record<string, unknown>
  } | null>(null)
  const recordingContributorIdRef = useRef<string | null>(null)
  const currentContributorIdRef = useRef<string | null>(params.contributorId)
  const [uploadingRecordingId, setUploadingRecordingId] = useState<string | null>(null)
  const [lastUploadReceipt, setLastUploadReceipt] =
    useState<MobileWorkbenchUploadReceipt | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  currentContributorIdRef.current = params.contributorId

  const commitQueueItems = useCallback((nextItems: MobileWorkbenchRecorderQueueItem[], ownerId: string | null): void => {
    if (currentContributorIdRef.current !== ownerId) return
    setItems(recorderQueueItemsForContributor(nextItems, ownerId))
  }, [])

  const refreshQueue = useCallback(async (): Promise<void> => {
    const ownerId = params.contributorId
    commitQueueItems(await loadNativeRecorderQueue(), ownerId)
  }, [commitQueueItems, params.contributorId])

  useEffect(() => {
    void refreshQueue()
    void AudioModule.getRecordingPermissionsAsync()
      .then((permission) => {
        setPermissionStatus(normalizePermissionStatus(permission.status))
      })
      .catch(() => {
        setPermissionStatus('unknown')
      })
  }, [refreshQueue])

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const existingPermission =
        await AudioModule.getRecordingPermissionsAsync()
      if (existingPermission.granted) {
        setPermissionStatus('granted')
        return true
      }

      const requestedPermission =
        await AudioModule.requestRecordingPermissionsAsync()
      setPermissionStatus(normalizePermissionStatus(requestedPermission.status))
      return requestedPermission.granted
    } catch (error) {
      setErrorMessage(toMobileProductMessage(error, 'microphone'))
      return false
    }
  }, [])

  const startRecording = useCallback(async (
    text: string,
    context?: {
      sentenceId?: string
      source?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<boolean> => {
    setErrorMessage(null)

    if (!params.contributorId) {
      setErrorMessage('请先登录。')
      return false
    }
    const contributorId = params.contributorId

    const hasPermission = await requestPermission()
    if (!hasPermission) {
      setErrorMessage('请允许麦克风权限后重试。')
      return false
    }
    if (currentContributorIdRef.current !== contributorId) {
      setErrorMessage('账号已经切换，请重新开始录音。')
      return false
    }

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      })
      await recorder.prepareToRecordAsync()
      recorder.record()
      recordingContributorIdRef.current = contributorId
      setRecordingStartedAt(new Date().toISOString())
      setRecordingText(text.trim() || '移动端练习样本')
      setRecordingContext(context ?? null)
      return true
    } catch (error) {
      setErrorMessage(toMobileProductMessage(error, 'recording'))
      return false
    }
  }, [params.contributorId, recorder, requestPermission])

  const stopRecording = useCallback(async (): Promise<MobileWorkbenchRecorderQueueItem | null> => {
    setErrorMessage(null)

    const stoppedAt = new Date().toISOString()
    const startedAt = recordingStartedAt ?? stoppedAt
    const recordingContributorId = recordingContributorIdRef.current
    recordingContributorIdRef.current = null
    if (!recordingContributorId) {
      setErrorMessage('录音账号信息缺失，请重新开始录音。')
      return null
    }

    try {
      await recorder.stop()
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      })

      const sourceUri = recorder.uri
      if (!sourceUri) {
        throw new Error('recording_uri_missing')
      }

      const recordingId = createRecordingId()
      const persistedAudio = persistNativeRecordingFile({
        recordingId,
        sourceUri,
      })
      const durationMs = Math.max(0, recorderState.durationMillis)
      const quality = assessMobileRecordingQuality(durationMs)
      const item: MobileWorkbenchRecorderQueueItem = {
        recordingId,
        contributorId: recordingContributorId,
        text: recordingText.trim() || '移动端练习样本',
        sentenceId: recordingContext?.sentenceId,
        source: recordingContext?.source,
        surface: params.surface,
        metadata: {
          app_surface: 'mobile_workbench',
          recorder: 'expo-audio',
          queue_owner: 'mobile_cache',
          audio_quality_disposition: quality.disposition,
          audio_quality_reasons: quality.reasons,
          ...recordingContext?.metadata,
        },
        consentScope: 'training_only',
        syncStatus: 'local_only',
        syncAttempts: 0,
        createdAt: stoppedAt,
        recording: {
          recordingId,
          sessionId: `mobile-local-${recordingId}`,
          mode: params.mode,
          sourceSurface: 'mobile_workbench',
          collectionMode: 'supervised',
          createdAt: stoppedAt,
          startedAt,
          stoppedAt,
          audio: {
            uri: persistedAudio.uri,
            format: persistedAudio.format,
            sampleRate: 44100,
            channelCount: 1,
            durationMs,
            durationSeconds: durationMs / 1000,
            fileSizeBytes: persistedAudio.fileSizeBytes,
            captureTransport: 'native_recorder',
            quality,
          },
        },
      }

      commitQueueItems(await appendNativeRecorderQueueItem(item), recordingContributorId)
      setRecordingStartedAt(null)
      setRecordingText('')
      setRecordingContext(null)
      return item
    } catch (error) {
      setErrorMessage(toMobileProductMessage(error, 'recording'))
      return null
    }
  }, [
    params.contributorId,
    params.mode,
    params.surface,
    recorder,
    recorderState.durationMillis,
    recordingStartedAt,
    recordingContext,
    recordingText,
    commitQueueItems,
  ])

  useEffect(() => {
    const recordingOwner = recordingContributorIdRef.current
    if (!recorderState.isRecording || !recordingOwner || recordingOwner === params.contributorId) return
    void stopRecording()
  }, [params.contributorId, recorderState.isRecording, stopRecording])

  const playRecording = useCallback((recordingId: string): void => {
    const item = items.find((queueItem) => queueItem.recordingId === recordingId)
    if (!item) {
      return
    }

    latestPlayer.replace({ uri: item.recording.audio.uri })
    latestPlayer.play()
  }, [items, latestPlayer])

  const playLatest = useCallback((): void => {
    const latestItem = items[0]
    if (latestItem) {
      playRecording(latestItem.recordingId)
    }
  }, [items, playRecording])

  const discard = useCallback(async (recordingId: string): Promise<boolean> => {
    setErrorMessage(null)
    const currentItems = await loadNativeRecorderQueue()
    const item = currentItems.find((entry) => entry.recordingId === recordingId)
    if (!item) {
      return true
    }
    if (!recorderQueueItemBelongsToContributor(item, params.contributorId)) {
      setErrorMessage('这条录音属于另一个账号，请切回原账号后处理。')
      return false
    }

    const uploaded = item.syncStatus === 'uploaded' || item.syncStatus === 'indexed'
    if (uploaded) {
      if (!params.apiBaseUrl) {
        setErrorMessage('暂时无法撤回这条录音，请恢复网络后重试。')
        return false
      }
      try {
        await discardMobileRecorderQueueItem(item, {
          apiBaseUrl: params.apiBaseUrl,
          tokenProvider: params.tokenProvider,
        })
      } catch (error) {
        setErrorMessage(toMobileProductMessage(error, 'upload'))
        return false
      }
    }

    const ownerId = params.contributorId
    commitQueueItems(await removeNativeRecorderQueueItem(recordingId), ownerId)
    return true
  }, [commitQueueItems, params.apiBaseUrl, params.contributorId, params.tokenProvider])

  const attachRecognition = useCallback(async (
    recordingId: string,
    recognizedText: string,
    metadata: Record<string, unknown> = {},
  ): Promise<MobileWorkbenchRecorderQueueItem | null> => {
    const nextItems = await updateNativeRecorderQueueItemRecognition(
      recordingId,
      recognizedText,
      metadata,
    )
    commitQueueItems(nextItems, params.contributorId)
    return nextItems.find((item) => item.recordingId === recordingId) ?? null
  }, [commitQueueItems, params.contributorId])

  const markUploadPending = useCallback(async (
    recordingId: string,
  ): Promise<void> => {
    commitQueueItems(
      await updateNativeRecorderQueueItemStatus(recordingId, 'upload_pending'),
      params.contributorId,
    )
  }, [commitQueueItems, params.contributorId])

  const uploadRecording = useCallback(async (
    recordingId: string,
    itemOverride?: MobileWorkbenchRecorderQueueItem,
  ): Promise<MobileWorkbenchUploadReceipt | null> => {
    setErrorMessage(null)
    setLastUploadReceipt(null)

    if (!params.apiBaseUrl) {
      setErrorMessage('服务暂不可用，请稍后再试。')
      return null
    }

    const currentItems = itemOverride ? [] : await loadNativeRecorderQueue()
    const item = itemOverride ?? currentItems.find((queueItem) => (
      queueItem.recordingId === recordingId
    ))

    if (!item) {
      setErrorMessage('未找到这条录音。')
      return null
    }
    if (!recorderQueueItemBelongsToContributor(item, params.contributorId)) {
      setErrorMessage('这条录音属于另一个账号，请切回原账号后上传。')
      return null
    }

    setUploadingRecordingId(recordingId)
    commitQueueItems(
      await updateNativeRecorderQueueItemStatus(
        recordingId,
        'upload_pending',
        undefined,
        item.uploadReceipt ?? null,
      ),
      params.contributorId,
    )

    try {
      const receipt = await uploadMobileRecorderQueueItem(item, {
        apiBaseUrl: params.apiBaseUrl,
        tokenProvider: params.tokenProvider,
      })
      commitQueueItems(
        await updateNativeRecorderQueueItemStatus(
          recordingId,
          'uploaded',
          undefined,
          receipt,
        ),
        params.contributorId,
      )
      setLastUploadReceipt(receipt)
      return receipt
    } catch (error) {
      const message = toMobileProductMessage(error, 'upload')
      commitQueueItems(
        await updateNativeRecorderQueueItemStatus(
          recordingId,
          'failed',
          message,
          item.uploadReceipt ?? null,
        ),
        params.contributorId,
      )
      setErrorMessage(message)
      return null
    } finally {
      setUploadingRecordingId(null)
    }
  }, [commitQueueItems, params.apiBaseUrl, params.contributorId, params.tokenProvider])

  const summary = useMemo(() => summarizeRecorderQueue(items), [items])

  return {
    items,
    latestItem: items[0] ?? null,
    summary,
    permissionStatus,
    isRecording: recorderState.isRecording,
    durationMs: recorderState.durationMillis,
    isPlayingLatest: latestPlayer.playing,
    isUploading: Boolean(uploadingRecordingId),
    uploadingRecordingId,
    lastUploadReceipt,
    errorMessage,
    refreshQueue,
    requestPermission,
    startRecording,
    stopRecording,
    playRecording,
    playLatest,
    discard,
    attachRecognition,
    markUploadPending,
    uploadRecording,
  }
}
