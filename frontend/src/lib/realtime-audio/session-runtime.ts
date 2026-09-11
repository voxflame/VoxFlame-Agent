'use client'

import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react'
import { assertSessionActive, SessionConnectionCancelledError, waitForSession, waitForSessionRetry } from './session-lifecycle'
import {
  buildClientDeviceContext,
  defaultCapabilitiesForMode,
  defaultStrategyForMode,
  type RtcCapabilityId,
  type RtcScene,
  type RtcSessionIntent,
  type RtcSessionMode,
  type RtcSurface,
} from './session-contract'
import { createSessionTransportEventHandlers } from './session-effects'
import {
  applyConnectedRtcSession,
  decodeInboundEnvelopeFromEvent,
  extractLatestUserTranscriptFromEnvelope,
  extractMemoryTurnsFromEnvelope,
  publishSessionControlMessage,
  reduceRtcEnvelope,
  type ChunkAccumulator,
} from './session-messages'
import { syncRtcSessionProfile } from './session-profile'
import { startRtcSession } from './session-bootstrap'
import {
  applyDisconnectedState,
  applyConnectingState,
  applyRtcError,
} from './session-state'
import {
  connectSessionExecution,
  disconnectSessionExecution,
  type SessionExecutionClient,
} from './session-execution'
import type {
  LatestUserTranscriptSnapshot,
  RtcAgentState,
  RtcMessageEnvelope,
  RtmMessageEvent,
  SessionControlClient,
  SessionMicrophoneTrack,
  StartRtcSessionResponse,
} from './session-types'
import { memoryService } from '@/lib/memory/memory-service'
import { reportFrontendDiagnostic, toProductMessage } from '@/lib/ui/product-message'

export interface SessionRuntimeRefs {
  clientRef: MutableRefObject<SessionExecutionClient | null>
  rtmClientRef: MutableRefObject<SessionControlClient | null>
  micTrackRef: MutableRefObject<SessionMicrophoneTrack | null>
  sessionRef: MutableRefObject<StartRtcSessionResponse | null>
  connectPromiseRef: MutableRefObject<Promise<void> | null>
  inboundRtmChunksRef: MutableRefObject<Map<string, ChunkAccumulator>>
  latestUserTranscriptRef: MutableRefObject<LatestUserTranscriptSnapshot>
  onDecodedEnvelopeRef: MutableRefObject<((message: RtcMessageEnvelope) => void) | null>
  connectionAbortRef: MutableRefObject<AbortController | null>
}

interface CreateDecodedRtcMessageHandlerOptions {
  memoryOwnerId: string | null
  latestUserTranscriptRef: MutableRefObject<LatestUserTranscriptSnapshot>
  setState: Dispatch<SetStateAction<RtcAgentState>>
}

interface CreateRtmMessageHandlerOptions extends CreateDecodedRtcMessageHandlerOptions {
  inboundRtmChunksRef: MutableRefObject<Map<string, ChunkAccumulator>>
  onDecodedEnvelope?: (message: RtcMessageEnvelope) => void
}

interface StartRtcRuntimeConnectionOptions {
  refs: SessionRuntimeRefs
  userId?: string
  accessToken?: string
  memoryOwnerId: string | null
  mode: RtcSessionMode
  surface?: RtcSurface
  scene?: RtcScene
  requestedCapabilities?: RtcCapabilityId[]
  connectionNotice: string | null
  suppressGreeting?: boolean
  setState: Dispatch<SetStateAction<RtcAgentState>>
  cleanupMicrophoneResources: () => void
  handleRtmMessage: (event: RtmMessageEvent) => void
}

interface DisconnectRtcRuntimeOptions {
  refs: SessionRuntimeRefs
  cleanupMicrophoneResources: () => void
  setState: Dispatch<SetStateAction<RtcAgentState>>
}

const SESSION_INIT_ACK_TIMEOUT_MS = 6_000
const SESSION_INIT_ACK_RETRY_DELAY_MS = 900
const SESSION_INIT_ACK_MAX_ATTEMPTS = 2

export class SessionBootstrapTimeoutError extends Error {
  constructor(message = '助手没有及时进入房间，当前这次连接不会有转录结果。') {
    super(message)
    this.name = 'SessionBootstrapTimeoutError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSessionInitAckMessage(
  message: RtcMessageEnvelope,
  requestId: string,
): boolean {
  if (message.type !== 'session_init_ack') {
    return false
  }

  if (!isRecord(message.metadata)) {
    return true
  }

  const metadataRequestId = message.metadata.request_id
  return typeof metadataRequestId !== 'string' || metadataRequestId === requestId
}

export function createSessionInitAckGate(
  requestId: string,
  timeoutMs: number = SESSION_INIT_ACK_TIMEOUT_MS,
) {
  let settled = false
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null
  let resolveReady: () => void = () => {}
  let rejectReady: (error: Error) => void = () => {}

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        globalThis.clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      resolve()
    }

    rejectReady = (error) => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        globalThis.clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      reject(error)
    }

    timeoutHandle = globalThis.setTimeout(() => {
      rejectReady(
        new SessionBootstrapTimeoutError(
          '助手还没有成功进入当前房间，系统已阻止这次“假连接”。请稍后重试。',
        ),
      )
    }, timeoutMs)
  })

  return {
    handleDecodedMessage: (message: RtcMessageEnvelope) => {
      if (!isSessionInitAckMessage(message, requestId)) {
        return
      }

      resolveReady()
    },
    waitForReady: () => ready,
    cleanup: () => {
      if (timeoutHandle) {
        globalThis.clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
    },
  }
}

function resetRuntimeRefs(refs: SessionRuntimeRefs): void {
  refs.clientRef.current = null
  refs.rtmClientRef.current = null
  refs.micTrackRef.current = null
  refs.sessionRef.current = null
  refs.inboundRtmChunksRef.current.clear()
  refs.latestUserTranscriptRef.current = { text: '', clientCaptureId: null }
  refs.onDecodedEnvelopeRef.current = null
}

export async function publishRtcRuntimeControlMessage(
  refs: Pick<SessionRuntimeRefs, 'rtmClientRef' | 'sessionRef'>,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const rtmClient = refs.rtmClientRef.current
  const session = refs.sessionRef.current
  if (!rtmClient || !session) {
    throw new Error('RTM 会话尚未就绪')
  }

  await publishSessionControlMessage({
    rtmClient,
    session,
    type,
    payload,
  })
}

export function createDecodedRtcMessageHandler({
  memoryOwnerId,
  latestUserTranscriptRef,
  setState,
}: CreateDecodedRtcMessageHandlerOptions): (message: RtcMessageEnvelope) => void {
  return (message) => {
    const nextLatestTranscript = extractLatestUserTranscriptFromEnvelope(message)
    if (nextLatestTranscript) {
      latestUserTranscriptRef.current = nextLatestTranscript
    }

    if (memoryOwnerId) {
      extractMemoryTurnsFromEnvelope(message).forEach((turn) => {
        memoryService.addTurn(turn.role, turn.content)
      })

      if (message.type === 'voice_profile_updated') {
        memoryService.updateCurrentSessionMetadata({
          lastVoiceProfileSource:
            typeof message.source === 'string' ? message.source : 'unknown',
          lastVoiceProfileUpdatedAt: Date.now(),
          clarity_score:
            typeof message.clarity_score === 'number' ? message.clarity_score : undefined,
          communicationScene:
            typeof message.exercise_category === 'string' ? message.exercise_category : undefined,
          communicationConfusionPatternsCount:
            typeof message.confusion_patterns_count === 'number'
              ? message.confusion_patterns_count
              : undefined,
        })
      }

      if (message.type === 'speech_activity') {
        const sessionMetadata = memoryService.peekSession()?.metadata
        const previousInterruptionCount =
          isRecord(sessionMetadata) && typeof sessionMetadata.interruptionCount === 'number'
            ? sessionMetadata.interruptionCount
            : 0
        const previousBargeInCount =
          isRecord(sessionMetadata) && typeof sessionMetadata.bargeInCount === 'number'
            ? sessionMetadata.bargeInCount
            : 0

        if (message.state === 'barge_in_triggered') {
          memoryService.updateCurrentSessionMetadata({
            interruptionCount: previousInterruptionCount + 1,
            bargeInCount: previousBargeInCount + 1,
            lastSpeechDurationMs:
              typeof message.speech_duration_ms === 'number'
                ? message.speech_duration_ms
                : undefined,
          })
        }
      }

      if (message.type === 'audio_input_telemetry') {
        const sessionMetadata = memoryService.peekSession()?.metadata
        const previousClippingCount =
          isRecord(sessionMetadata) && typeof sessionMetadata.audioClippingEventCount === 'number'
            ? sessionMetadata.audioClippingEventCount
            : 0

        const clippingDetected = message.clipping_detected === true
        const telemetryReason =
          typeof message.reason === 'string' && message.reason.trim()
            ? message.reason
            : undefined

        memoryService.updateCurrentSessionMetadata({
          lastAudioTelemetryAt: Date.now(),
          lastInputTelemetryReason: telemetryReason,
          lastInputNormalizedLevel:
            typeof message.normalized_level === 'number'
              ? message.normalized_level
              : undefined,
          lastInputPeakLevel:
            typeof message.peak_level === 'number'
              ? message.peak_level
              : undefined,
          lastInputClippingDetected: clippingDetected,
          lastInputApmEnabled: message.apm_enabled === true,
          audioClippingEventCount:
            clippingDetected && telemetryReason === 'clipping_detected'
              ? previousClippingCount + 1
              : previousClippingCount,
        })
      }

      if (message.type === 'session_userdata_ack' && isRecord(message.session_memory)) {
        const sessionMemory = message.session_memory
        const compactionCandidate = isRecord(message.compaction_candidate)
          ? message.compaction_candidate
          : undefined
        const hasCompactionCandidate = Boolean(
          (typeof compactionCandidate?.summary === 'string' && compactionCandidate.summary.trim().length > 0)
          || (Array.isArray(compactionCandidate?.risky_terms) && compactionCandidate.risky_terms.length > 0)
          || (Array.isArray(compactionCandidate?.support_strategies) && compactionCandidate.support_strategies.length > 0)
          || (Array.isArray(compactionCandidate?.recent_user_intents) && compactionCandidate.recent_user_intents.length > 0)
          || (Array.isArray(compactionCandidate?.recent_confirmed_phrases) && compactionCandidate.recent_confirmed_phrases.length > 0),
        )

        memoryService.updateCurrentSessionMetadata({
          serverCurrentTurnState:
            typeof sessionMemory.current_turn_state === 'string'
              ? sessionMemory.current_turn_state
              : undefined,
          serverTurnCount:
            typeof sessionMemory.turn_count === 'number'
              ? sessionMemory.turn_count
              : undefined,
          serverContextRevision:
            typeof sessionMemory.context_revision === 'number'
              ? sessionMemory.context_revision
              : undefined,
          serverPreparationSource:
            typeof sessionMemory.last_preparation_source === 'string'
              ? sessionMemory.last_preparation_source
              : undefined,
          serverInterruptionCount:
            typeof sessionMemory.interruption_count === 'number'
              ? sessionMemory.interruption_count
              : undefined,
          serverBargeInCount:
            typeof sessionMemory.barge_in_count === 'number'
              ? sessionMemory.barge_in_count
              : undefined,
          serverCaptionModeEnabled:
            typeof sessionMemory.caption_mode_enabled === 'boolean'
              ? sessionMemory.caption_mode_enabled
              : undefined,
          serverCompactionSummary:
            typeof compactionCandidate?.summary === 'string'
              ? compactionCandidate.summary
              : undefined,
          serverCompactionSessionKind:
            typeof compactionCandidate?.session_kind === 'string'
              ? compactionCandidate.session_kind
              : undefined,
          serverCompactionFallbackPhrases:
            Array.isArray(compactionCandidate?.fallback_phrases)
              ? compactionCandidate.fallback_phrases.filter((item): item is string => typeof item === 'string')
              : undefined,
          serverCompactionRiskyTerms:
            Array.isArray(compactionCandidate?.risky_terms)
              ? compactionCandidate.risky_terms.filter((item): item is string => typeof item === 'string')
              : undefined,
          serverCompactionSupportStrategies:
            Array.isArray(compactionCandidate?.support_strategies)
              ? compactionCandidate.support_strategies.filter((item): item is string => typeof item === 'string')
              : undefined,
          serverCompactionHotwords:
            Array.isArray(compactionCandidate?.hotwords)
              ? compactionCandidate.hotwords.filter((item): item is string => typeof item === 'string')
              : undefined,
          serverCompactionRecentUserIntents:
            Array.isArray(compactionCandidate?.recent_user_intents)
              ? compactionCandidate.recent_user_intents.filter((item): item is string => typeof item === 'string')
              : undefined,
          serverCompactionRecentConfirmedPhrases:
            Array.isArray(compactionCandidate?.recent_confirmed_phrases)
              ? compactionCandidate.recent_confirmed_phrases.filter((item): item is string => typeof item === 'string')
              : undefined,
        })
        if (hasCompactionCandidate) {
          void memoryService.persistCurrentSessionProfileUpdate()
        }

        setState((prev) => ({
          ...prev,
          lastSessionMemoryAck: {
            currentTurnState:
              typeof sessionMemory.current_turn_state === 'string'
                ? sessionMemory.current_turn_state
                : null,
            turnCount:
              typeof sessionMemory.turn_count === 'number'
                ? sessionMemory.turn_count
                : null,
            contextRevision:
              typeof sessionMemory.context_revision === 'number'
                ? sessionMemory.context_revision
                : null,
            preparationSource:
              typeof sessionMemory.last_preparation_source === 'string'
                ? sessionMemory.last_preparation_source
                : null,
            interruptionCount:
              typeof sessionMemory.interruption_count === 'number'
                ? sessionMemory.interruption_count
                : null,
            bargeInCount:
              typeof sessionMemory.barge_in_count === 'number'
                ? sessionMemory.barge_in_count
                : null,
          },
        }))
      }
    }

    setState((prev) => reduceRtcEnvelope(prev, message))
  }
}

export function createRtmMessageHandler({
  inboundRtmChunksRef,
  memoryOwnerId,
  latestUserTranscriptRef,
  setState,
  onDecodedEnvelope,
}: CreateRtmMessageHandlerOptions): (event: RtmMessageEvent) => void {
  const handleDecodedMessage = createDecodedRtcMessageHandler({
    memoryOwnerId,
    latestUserTranscriptRef,
    setState,
  })

  return (event) => {
    const envelope = decodeInboundEnvelopeFromEvent(event, inboundRtmChunksRef.current)
    if (!envelope) {
      return
    }

    handleDecodedMessage(envelope)
    onDecodedEnvelope?.(envelope)
  }
}

export async function disconnectRtcRuntime({
  refs,
  cleanupMicrophoneResources,
  setState,
}: DisconnectRtcRuntimeOptions): Promise<void> {
  refs.connectionAbortRef.current?.abort()
  refs.connectionAbortRef.current = null
  const client = refs.clientRef.current
  const micTrack = refs.micTrackRef.current

  resetRuntimeRefs(refs)
  refs.connectPromiseRef.current = null

  setState((prev) => applyDisconnectedState(prev))

  // Release shared microphone refs before awaiting old room teardown.
  cleanupMicrophoneResources()
  await disconnectSessionExecution({ clientHandle: client, micTrack })
}

export async function startRtcRuntimeConnection({
  refs,
  userId,
  accessToken,
  memoryOwnerId,
  mode,
  surface,
  scene,
  requestedCapabilities,
  connectionNotice,
  suppressGreeting,
  setState,
  cleanupMicrophoneResources,
  handleRtmMessage,
}: StartRtcRuntimeConnectionOptions): Promise<void> {
  if (!userId) {
    throw new Error('请先登录后再使用这个功能。')
  }

  if (!accessToken) {
    throw new Error('当前登录态还没有准备好，请刷新页面后再试。')
  }

  setState((prev) => applyConnectingState(prev))
  refs.connectionAbortRef.current?.abort()
  const abortController = new AbortController()
  refs.connectionAbortRef.current = abortController
  const signal = abortController.signal
  const ownsConnection = () => refs.connectionAbortRef.current === abortController

  const sessionIntent: RtcSessionIntent = {
    surface: surface ?? (mode === 'training' ? 'training_workspace' : 'communication_workspace'),
    mode,
    sessionStrategy: defaultStrategyForMode(mode),
    requestedCapabilities: requestedCapabilities ?? defaultCapabilitiesForMode(mode),
    scene,
    deviceContext: buildClientDeviceContext(mode),
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= SESSION_INIT_ACK_MAX_ATTEMPTS; attempt += 1) {
    let client: SessionExecutionClient | null = null
    let rtmClient: SessionControlClient | null = null
    let initAckGate: ReturnType<typeof createSessionInitAckGate> | null = null

    try {
      assertSessionActive(signal)
      const activeSession = await waitForSession(startRtcSession(mode, sessionIntent, {
        accessToken,
        signal,
      }), signal)
      assertSessionActive(signal)
      initAckGate = createSessionInitAckGate(activeSession.requestId)
      // Observe timeout immediately, even while the SDK is still connecting.
      void initAckGate.waitForReady().catch(() => undefined)
      refs.onDecodedEnvelopeRef.current = initAckGate.handleDecodedMessage
      refs.sessionRef.current = activeSession

      // Ignore callbacks from an intentionally released or superseded room.
      const transportEventHandlers = createSessionTransportEventHandlers(
        setState,
        () => !signal.aborted && refs.sessionRef.current === activeSession,
      )
      const transport = await connectSessionExecution({
        session: activeSession,
        signal,
        onRtmMessage: (event) => {
          if (!signal.aborted && refs.sessionRef.current === activeSession) handleRtmMessage(event)
        },
        ...transportEventHandlers,
      })
      client = transport.clientHandle
      rtmClient = transport.rtmClient
      assertSessionActive(signal)

      refs.clientRef.current = client
      refs.rtmClientRef.current = rtmClient

      await waitForSession(initAckGate.waitForReady(), signal)
      assertSessionActive(signal)

      if (memoryOwnerId) {
        memoryService.updateCurrentSessionMetadata({
          kind: activeSession.intent.mode === 'training' ? 'training' : 'communication',
          source: 'rtc_agent',
          surface: activeSession.intent.surface,
          scene: activeSession.intent.scene ?? undefined,
          sessionStrategy: activeSession.intent.sessionStrategy,
          executionBackend: activeSession.executionBackend,
          transportProvider: activeSession.transport.provider,
        })
      }

      const bootstrapSendControlMessage = async (
        type: string,
        payload: Record<string, unknown> = {},
      ) => {
        assertSessionActive(signal)
        await waitForSession(publishSessionControlMessage({
          rtmClient: rtmClient!,
          session: activeSession,
          type,
          payload,
        }), signal)
      }

      await waitForSession(syncRtcSessionProfile({
        session: activeSession,
        userId,
        suppressGreeting,
        sendControl: bootstrapSendControlMessage,
      }), signal)
      assertSessionActive(signal)

      refs.onDecodedEnvelopeRef.current = null
      initAckGate.cleanup()
      setState((prev) => applyConnectedRtcSession(prev, activeSession, connectionNotice))
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      initAckGate?.cleanup()
      // Stale attempts may close their own room, never the next session's microphone/refs.
      const micTrack = ownsConnection() ? refs.micTrackRef.current : null
      if (ownsConnection()) {
        resetRuntimeRefs(refs)
        cleanupMicrophoneResources()
      }
      try {
        await waitForSession(disconnectSessionExecution({ clientHandle: client, micTrack }), signal)
      } catch (cleanupError) {
        if (!(cleanupError instanceof SessionConnectionCancelledError)) {
          reportFrontendDiagnostic('rtc-cleanup', cleanupError)
        }
      }
      if (signal.aborted || !ownsConnection()) throw new SessionConnectionCancelledError()

      if (
        lastError instanceof SessionBootstrapTimeoutError &&
        attempt < SESSION_INIT_ACK_MAX_ATTEMPTS
      ) {
        console.warn(
          '[useRtcAgentSession] connection retry started',
        )
        setState((prev) => applyConnectingState(prev))
        await waitForSessionRetry(SESSION_INIT_ACK_RETRY_DELAY_MS, signal)
        continue
      }

      break
    }
  }

  if (signal.aborted || !ownsConnection()) throw new SessionConnectionCancelledError()
  refs.connectionAbortRef.current = null
  const connectionError =
    lastError instanceof SessionBootstrapTimeoutError
      ? new Error('助手暂未响应，请重新连接。')
      : new Error(toProductMessage(lastError, 'realtime'))

  reportFrontendDiagnostic('rtc-connect', lastError)
  setState((prev) => applyRtcError(prev, connectionError.message))
  throw connectionError
}
