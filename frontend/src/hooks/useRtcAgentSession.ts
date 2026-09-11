'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { memoryService } from '@/lib/memory/memory-service'
import {
  clearRtcMessagesAction,
  getRtcMicrophoneMediaStream,
  getRtcMicrophoneStreamTrack,
  sendRtcTextAction,
  startRtcRecordingAction,
  stopRtcRecordingAction,
} from '@/lib/realtime-audio/session-actions'
import {
  cleanupSessionMicrophoneResources,
  ensurePublishedMicrophoneTrack,
  warmUpSessionMicrophone,
} from '@/lib/realtime-audio/session-audio'
import {
  type RtcCapabilityId,
  type RtcExecutionBackend,
  type RtcScene,
  type RtcSessionMode,
  type RtcSurface,
} from '@/lib/realtime-audio/session-contract'
import {
  createInitialRtcAgentState,
} from '@/lib/realtime-audio/session-state'
import { type ChunkAccumulator } from '@/lib/realtime-audio/session-messages'
import {
  createRtmMessageHandler,
  disconnectRtcRuntime,
  publishRtcRuntimeControlMessage,
  startRtcRuntimeConnection,
} from '@/lib/realtime-audio/session-runtime'
import type { SessionExecutionClient } from '@/lib/realtime-audio/session-execution'
import type {
  LatestUserTranscriptSnapshot,
  RtcAgentState,
  RtcMessageEnvelope,
  SessionControlClient,
  SessionMicrophoneTrack,
  StartRtcSessionResponse,
} from '@/lib/realtime-audio/session-types'
export type {
  ConversationMessage,
  VoiceProfileSyncEvent,
  RtcAgentState,
} from '@/lib/realtime-audio/session-types'

interface UseRtcAgentSessionOptions {
  userId?: string
  accessToken?: string
  mode?: RtcSessionMode
  surface?: RtcSurface
  scene?: RtcScene
  requestedCapabilities?: RtcCapabilityId[]
  executionBackend?: RtcExecutionBackend
  connectionNotice?: string | null
  timeoutSeconds?: number
}

interface TranscriptCacheEntry {
  text: string
  clientCaptureId: string | null
}

interface ConnectRtcOptions {
  suppressGreeting?: boolean
}

interface StartRecordingOptions extends ConnectRtcOptions { }

interface CaptureBoundRecordingOptions extends StartRecordingOptions {
  clientCaptureId?: string
  shortUtteranceExpected?: boolean
}

export function useRtcAgentSession(options: UseRtcAgentSessionOptions = {}) {
  const {
    userId,
    accessToken,
    mode = 'communication',
    surface,
    scene,
    requestedCapabilities,
    executionBackend,
    connectionNotice = mode === 'training'
      ? null
      : '已连接，请点击下方麦克风开始说话，也可以先用文字或短语沟通。',
    timeoutSeconds,
  } = options
  const memoryOwnerId = userId ?? null

  const [state, setState] = useState<RtcAgentState>(createInitialRtcAgentState)
  const latestStateRef = useRef<RtcAgentState>(state)

  const clientRef = useRef<SessionExecutionClient | null>(null)
  const rtmClientRef = useRef<SessionControlClient | null>(null)
  const micTrackRef = useRef<SessionMicrophoneTrack | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const preflightMicStreamRef = useRef<MediaStream | null>(null)
  const micAudioContextRef = useRef<AudioContext | null>(null)
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const sessionRef = useRef<StartRtcSessionResponse | null>(null)
  const connectPromiseRef = useRef<Promise<void> | null>(null)
  const latestUserTranscriptRef = useRef<LatestUserTranscriptSnapshot>({
    text: '',
    clientCaptureId: null,
  })
  const transcriptCacheRef = useRef<Map<string, TranscriptCacheEntry>>(new Map())
  const inboundRtmChunksRef = useRef<Map<string, ChunkAccumulator>>(new Map())
  const onDecodedEnvelopeRef = useRef<((message: RtcMessageEnvelope) => void) | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  useEffect(() => {
    if (!memoryOwnerId) {
      return
    }

    memoryService.init(memoryOwnerId)
  }, [memoryOwnerId])

  const cleanupMicrophoneResources = useCallback(() => {
    cleanupSessionMicrophoneResources({
      micTrackRef,
      micStreamRef,
      preflightMicStreamRef,
      micAudioContextRef,
      micSourceNodeRef,
      micAnalyserRef,
    }, setAnalyser)
  }, [])

  const warmUpMicrophoneStream = useCallback(async (): Promise<MediaStream> => {
    return warmUpSessionMicrophone(preflightMicStreamRef)
  }, [])

  const sendControlMessage = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      await publishRtcRuntimeControlMessage(
        {
          rtmClientRef,
          sessionRef,
        },
        type,
        payload,
      )
    },
    [],
  )

  const handleRtmMessage = useMemo(() => {
    return createRtmMessageHandler({
      inboundRtmChunksRef,
      memoryOwnerId,
      latestUserTranscriptRef,
      setState,
      onDecodedEnvelope: (message) => {
        if (message.type === 'transcript' && message.role === 'user' && message.is_final && message.text) {
          const clientCaptureId =
            typeof message.client_capture_id === 'string' && message.client_capture_id.trim()
              ? message.client_capture_id.trim()
              : null

          if (clientCaptureId) {
            transcriptCacheRef.current.set(clientCaptureId, {
              text: message.text,
              clientCaptureId,
            })
          }
        }
        onDecodedEnvelopeRef.current?.(message)
      },
    })
  }, [memoryOwnerId])

  const disconnect = useCallback(async () => {
    const latestState = latestStateRef.current

    if (memoryOwnerId) {
      const latestAssistantText = [...latestState.messages]
        .reverse()
        .find((message) => message.role === 'assistant')?.content
      memoryService.updateCurrentSessionMetadata({
        sessionEndedReason: 'rtc_disconnect',
        latestUserTranscript: latestUserTranscriptRef.current.text || undefined,
        latestCorrectionText: latestAssistantText,
        lastVoiceProfileSource: latestState.lastVoiceProfileSync?.source,
        clarity_score:
          typeof latestState.lastVoiceProfileSync?.clarityScore === 'number'
            ? latestState.lastVoiceProfileSync.clarityScore / 100
            : undefined,
        sessionTurnCount: latestState.messages.length,
      })
      await memoryService.endSession()
    }

    await disconnectRtcRuntime({
      refs: {
        clientRef,
        rtmClientRef,
        micTrackRef,
        sessionRef,
        connectPromiseRef,
        inboundRtmChunksRef,
        latestUserTranscriptRef,
        onDecodedEnvelopeRef,
      },
      cleanupMicrophoneResources,
      setState,
    })
  }, [cleanupMicrophoneResources, memoryOwnerId])

  const ensureMicrophoneTrack = useCallback(async (): Promise<SessionMicrophoneTrack> => {
    return ensurePublishedMicrophoneTrack({
      clientRef,
      connectPromiseRef,
      micTrackRef,
      micStreamRef,
      preflightMicStreamRef,
      micAudioContextRef,
      micSourceNodeRef,
      micAnalyserRef,
      mode,
      setAnalyser,
      cleanupMicrophoneResources,
    })
  }, [cleanupMicrophoneResources, mode])

  useEffect(() => {
    return () => {
      void disconnect()
    }
  }, [disconnect])

  const connect = useCallback(async (connectOptions: ConnectRtcOptions = {}) => {
    if (!userId) {
      throw new Error('请先登录后再使用这个功能。')
    }

    if (clientRef.current && sessionRef.current) {
      return
    }

    if (connectPromiseRef.current) {
      await connectPromiseRef.current
      return
    }

    const connectPromise = (async () => {
      await startRtcRuntimeConnection({
        refs: {
          clientRef,
          rtmClientRef,
          micTrackRef,
          sessionRef,
          connectPromiseRef,
          inboundRtmChunksRef,
          latestUserTranscriptRef,
          onDecodedEnvelopeRef,
        },
        userId,
        accessToken,
        memoryOwnerId,
        mode,
        surface,
        scene,
        requestedCapabilities,
        executionBackend,
        connectionNotice,
        timeoutSeconds,
        suppressGreeting: connectOptions.suppressGreeting,
        setState,
        cleanupMicrophoneResources,
        handleRtmMessage,
      })
    })()

    connectPromiseRef.current = connectPromise

    try {
      await connectPromise
    } finally {
      if (connectPromiseRef.current === connectPromise) {
        connectPromiseRef.current = null
      }
    }
  }, [
    cleanupMicrophoneResources,
    connectionNotice,
    handleRtmMessage,
    memoryOwnerId,
    mode,
    requestedCapabilities,
    executionBackend,
    scene,
    surface,
    timeoutSeconds,
    accessToken,
    userId,
  ])

  const startRecording = useCallback(async (recordingOptions: CaptureBoundRecordingOptions = {}) => {
    await startRtcRecordingAction({
      refs: {
        micTrackRef,
        micStreamRef,
        preflightMicStreamRef,
        sessionRef,
        latestUserTranscriptRef,
      },
      setState,
      connect,
      ensureMicrophoneTrack,
      warmUpMicrophoneStream,
      sendControlMessage,
      connectOptions: recordingOptions,
      clientCaptureId: recordingOptions.clientCaptureId,
      shortUtteranceExpected: recordingOptions.shortUtteranceExpected,
    })
  }, [connect, ensureMicrophoneTrack, sendControlMessage, warmUpMicrophoneStream])

  const stopRecording = useCallback(async (clientCaptureId?: string) => {
    await stopRtcRecordingAction({
      refs: {
        micTrackRef,
        latestUserTranscriptRef,
      },
      setState,
      sendControlMessage,
      clientCaptureId,
    })
  }, [sendControlMessage])

  const toggleRecording = useCallback(async () => {
    if (state.isRecording) {
      await stopRecording()
      return
    }

    await startRecording()
  }, [startRecording, state.isRecording, stopRecording])

  const sendText = useCallback(async (text: string) => {
    await sendRtcTextAction({
      refs: {
        sessionRef,
      },
      text,
      memoryOwnerId,
      setState,
      isControlChannelReady: () => Boolean(rtmClientRef.current),
      sendControlMessage,
    })
  }, [memoryOwnerId, sendControlMessage])

  const clearMessages = useCallback(() => {
    clearRtcMessagesAction(latestUserTranscriptRef, setState)
  }, [])

  const getMicrophoneStreamTrack = useCallback((): MediaStreamTrack | null => {
    return getRtcMicrophoneStreamTrack(micTrackRef)
  }, [])

  const getMicrophoneMediaStream = useCallback((): MediaStream | null => {
    return getRtcMicrophoneMediaStream(micStreamRef, preflightMicStreamRef)
  }, [])

  const getLatestUserTranscriptSnapshot = useCallback((): LatestUserTranscriptSnapshot => {
    return latestUserTranscriptRef.current
  }, [])

  const getCachedTranscriptByCaptureId = useCallback((clientCaptureId: string): LatestUserTranscriptSnapshot | null => {
    const cached = transcriptCacheRef.current.get(clientCaptureId)
    return cached ? { ...cached } : null
  }, [])

  return {
    ...state,
    analyser,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    toggleRecording,
    sendText,
    sendControlEvent: sendControlMessage,
    clearMessages,
    getMicrophoneStreamTrack,
    getMicrophoneMediaStream,
    getLatestUserTranscriptSnapshot,
    getCachedTranscriptByCaptureId,
  }
}

export default useRtcAgentSession
