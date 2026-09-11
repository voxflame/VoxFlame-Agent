import type { MobileWorkbenchSurfaceId } from '../constants/surfaces'

export type MobileWorkbenchRtcSurface = 'mobile_workbench'
export type MobileWorkbenchSourceSurface = 'mobile_workbench'

import type { RtcSessionIntent, RtcDeviceContext } from './generated/rtc-session'
export type {
  RtcSessionMode as MobileWorkbenchSessionMode,
  RtcSessionStrategy as MobileWorkbenchSessionStrategy,
  RtcCapabilityId as MobileWorkbenchCapabilityId,
  RtcScene as MobileWorkbenchScene,
  RtcResolvedSessionIntent as MobileWorkbenchResolvedRtcSessionIntent,
  RtcSessionReadinessSummary as MobileWorkbenchRtcReadinessSummary,
  LiveKitTransportRuntime as MobileWorkbenchLiveKitRuntime,
  RtcStartSessionResult as MobileWorkbenchRtcSessionResponse,
} from './generated/rtc-session'

export interface MobileWorkbenchDeviceContext extends RtcDeviceContext {
  appState?: 'active' | 'background' | 'inactive'
}

export interface MobileWorkbenchRtcSessionIntent extends RtcSessionIntent {
  surface: MobileWorkbenchRtcSurface
  deviceContext?: MobileWorkbenchDeviceContext
}

export type MobileWorkbenchRecordingMode =
  | 'training'
  | 'communication'
  | 'evaluation'
  | 'free_recording'

export type MobileWorkbenchCollectionMode =
  | 'supervised'
  | 'weak_supervision'
  | 'free_recording'
  | 'benchmark'

export type MobileWorkbenchCaptureTransport =
  | 'native_recorder'
  | 'livekit_track'
  | 'imported_file'

export type MobileWorkbenchAudioQualityDisposition =
  | 'high_confidence'
  | 'review'
  | 'low_confidence'

export type MobileWorkbenchConsentScope =
  | 'training_only'
  | 'training_and_model_improvement'
  | 'evaluation_only'

export type MobileWorkbenchSyncStatus =
  | 'local_only'
  | 'upload_pending'
  | 'uploaded'
  | 'indexed'
  | 'failed'

export interface MobileWorkbenchRecordingEnvelope {
  recordingId: string
  sessionId: string
  mode: MobileWorkbenchRecordingMode
  sourceSurface: MobileWorkbenchSourceSurface
  collectionMode: MobileWorkbenchCollectionMode
  createdAt: string
  startedAt: string
  stoppedAt: string
  audio: {
    uri: string
    format: string
    sampleRate: number
    channelCount: number
    durationMs: number
    durationSeconds: number
    fileSizeBytes: number
    sha256?: string
    captureTransport: MobileWorkbenchCaptureTransport
    quality?: {
      durationMs: number
      speechDurationMs?: number
      leadingSilenceMs?: number
      trailingSilenceMs?: number
      silenceRatio?: number
      inputLevelRms?: number
      inputLevelPeak?: number
      disposition: MobileWorkbenchAudioQualityDisposition
      reasons: string[]
    }
  }
}

export interface MobileWorkbenchRecorderQueueItem {
  recordingId: string
  contributorId: string
  text: string
  sentenceId?: string
  recognizedText?: string | null
  source?: string
  surface: MobileWorkbenchSurfaceId
  metadata: Record<string, unknown>
  consentScope: MobileWorkbenchConsentScope
  syncStatus: MobileWorkbenchSyncStatus
  syncAttempts: number
  lastAttemptAt?: string
  lastError?: string
  uploadReceipt?: MobileWorkbenchUploadReceipt | null
  createdAt: string
  recording: MobileWorkbenchRecordingEnvelope
}

export interface MobileWorkbenchUploadReceipt {
  recordingId: string
  contributionId?: string | null
  manifestPath?: string
  storagePath?: string
  reusedContribution?: boolean
  manifestAlreadySynced?: boolean
  source: 'cloud' | 'background_retry'
  syncStatus: 'uploaded' | 'retrying'
  message: string
}
