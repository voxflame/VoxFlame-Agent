import type {
  LocalAudioTrack,
  LocalTrackPublication,
  Room,
} from 'livekit-client'
import type {
  RtcCapabilityId,
  RtcResolvedSessionIntent,
  RtcSessionReadiness,
} from './session-contract'

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

export interface VoiceProfileSyncEvent {
  source: string
  exerciseId: string
  category: string
  hotwordCount: number
  confusionPatternsCount: number
  clarityScore: number
  lastTrainingCategory: string
  timestamp: Date
}

export type { LiveKitTransportRuntime, RtcTransportRuntime, RtcStartSessionResult as StartRtcSessionResponse } from './generated/rtc-session'

export interface RtcMessageEnvelope {
  type?: string
  name?: string
  role?: 'user' | 'assistant' | 'system'
  text?: string
  delta?: string
  full_text?: string
  corrected_text?: string
  original_text?: string
  clarity_score?: number
  state?: string
  auto_finalize?: boolean
  client_capture_id?: string
  interruption_requested?: boolean
  speech_duration_ms?: number
  reason?: string
  normalized_level?: number
  peak_level?: number
  clipping_detected?: boolean
  apm_enabled?: boolean
  is_final?: boolean
  error?: string
  message?: string
  feedback_request_id?: string
  metadata?: Record<string, unknown>
  data?: Record<string, unknown>
  exercise_id?: string
  exercise_text?: string
  recognized_text?: string
  feedback_text?: string
  source?: string
  model?: string
  exercise_category?: string
  hotword_count?: number
  confusion_patterns_count?: number
  last_training_category?: string
  session_memory?: {
    current_turn_state?: string
    turn_count?: number
    context_revision?: number
    last_preparation_source?: string
    interruption_count?: number
    barge_in_count?: number
    caption_mode_enabled?: boolean
  }
  compaction_candidate?: {
    session_kind?: string
    summary?: string
    fallback_phrases?: string[]
    risky_terms?: string[]
    support_strategies?: string[]
    hotwords?: string[]
    recent_user_intents?: string[]
    recent_confirmed_phrases?: string[]
    loadout_mode?: string
    context_revision?: number
    turn_count?: number
    interruption_count?: number
    barge_in_count?: number
  }
}

export interface LatestUserTranscriptSnapshot {
  text: string
  clientCaptureId: string | null
}

export interface RtmMessageEvent {
  message: string | Uint8Array
  publisher: string
  channelName: string
}

export interface RtmStatusEvent {
  newState?: string
  reason?: string
}

/** LiveKit room data publishing; connection state belongs to the SDK room. */
export interface SessionControlClient {
  publish(channelName: string, message: string | Uint8Array): Promise<void>
}

export interface SessionMicrophoneTrack {
  provider: 'livekit'
  rawTrack: LocalAudioTrack
  publication: LocalTrackPublication
  room: Room
  setEnabled(enabled: boolean): Promise<void>
  getMediaStreamTrack(): MediaStreamTrack
  stop(): void
  close(): void
}

export interface RtcAgentState {
  isConnecting: boolean
  isConnected: boolean
  isRecording: boolean
  isThinking: boolean
  isSpeaking: boolean
  sessionId: string | null
  currentASRText: string
  currentResponseText: string
  latestUserTranscript: string
  messages: ConversationMessage[]
  error: string | null
  transport: 'rtc'
  sessionIntent: RtcResolvedSessionIntent | null
  sessionReadiness: RtcSessionReadiness | null
  grantedCapabilities: RtcCapabilityId[]
  lastVoiceProfileSync: VoiceProfileSyncEvent | null
  lastSessionMemoryAck: {
    currentTurnState: string | null
    turnCount: number | null
    contextRevision: number | null
    preparationSource: string | null
    interruptionCount: number | null
    bargeInCount: number | null
  } | null
}
