import {
  applyAssistantResponseDelta,
  applyConnectedState,
  applyCurrentAsrText,
  applyFinalAssistantTranscript,
  applyFinalUserTranscript,
  applyRtcError,
  applyVoiceProfileSync,
} from './session-state'
import { toProductMessage } from '@/lib/ui/product-message'
import type {
  ConversationMessage,
  RtcAgentState,
  RtcMessageEnvelope,
  RtmMessageEvent,
  SessionControlClient,
  StartRtcSessionResponse,
  VoiceProfileSyncEvent,
} from './session-types'

export interface ChunkAccumulator {
  createdAt: number
  totalParts: number
  parts: Map<number, string>
}

export interface SessionMemoryTurn {
  role: Extract<ConversationMessage['role'], 'user' | 'assistant'>
  content: string
}

const RTM_CHUNK_TTL_MS = 15_000

function parseEnvelope(text: string): RtcMessageEnvelope | null {
  try {
    const parsed = JSON.parse(text) as RtcMessageEnvelope
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function cleanupExpiredChunks(chunks: Map<string, ChunkAccumulator>, now: number): void {
  const expiredMessageIds: string[] = []
  chunks.forEach((chunk, messageId) => {
    if (now - chunk.createdAt > RTM_CHUNK_TTL_MS) {
      expiredMessageIds.push(messageId)
    }
  })
  expiredMessageIds.forEach((messageId) => {
    chunks.delete(messageId)
  })
}

function decodeBase64Utf8(content: string): string {
  const binary = window.atob(content)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function maybeAssembleChunkedMessage(
  rawText: string,
  chunks: Map<string, ChunkAccumulator>,
): string | null | undefined {
  const separatorIndex = rawText.indexOf('|')
  if (separatorIndex <= 0) {
    return undefined
  }

  const [messageId, partIndexRaw, totalPartsRaw, content] = rawText.split('|', 4)
  const partIndex = Number.parseInt(partIndexRaw, 10)
  const totalParts = Number.parseInt(totalPartsRaw, 10)

  if (!messageId || !content || !Number.isInteger(partIndex) || !Number.isInteger(totalParts)) {
    return undefined
  }

  const now = Date.now()
  cleanupExpiredChunks(chunks, now)

  const current =
    chunks.get(messageId) ??
    {
      createdAt: now,
      totalParts,
      parts: new Map<number, string>(),
    }

  current.parts.set(partIndex, content)
  current.totalParts = totalParts
  chunks.set(messageId, current)

  if (current.parts.size < totalParts) {
    return null
  }

  const ordered: string[] = []
  for (let index = 1; index <= totalParts; index += 1) {
    const part = current.parts.get(index)
    if (!part) {
      return null
    }
    ordered.push(part)
  }

  chunks.delete(messageId)
  return decodeBase64Utf8(ordered.join(''))
}

export function decodeInboundMessage(
  message: string | Uint8Array,
  chunks: Map<string, ChunkAccumulator>,
): RtcMessageEnvelope | null {
  const text =
    typeof message === 'string' ? message : new TextDecoder().decode(message)

  const directEnvelope = parseEnvelope(text)
  if (directEnvelope) {
    return directEnvelope
  }

  const maybeChunked = maybeAssembleChunkedMessage(text, chunks)
  if (maybeChunked === undefined || maybeChunked === null) {
    return null
  }

  return parseEnvelope(maybeChunked)
}

export async function publishSessionEnvelope(
  rtmClient: SessionControlClient,
  session: StartRtcSessionResponse,
  payload: Record<string, unknown>,
): Promise<void> {
  await rtmClient.publish(
    session.transport.roomName,
    JSON.stringify(payload),
  )
}

export async function publishSessionControlMessage({
  rtmClient,
  session,
  type,
  payload = {},
}: {
  rtmClient: SessionControlClient
  session: StartRtcSessionResponse
  type: string
  payload?: Record<string, unknown>
}): Promise<void> {
  const clientId = session.transport.participantIdentity

  await publishSessionEnvelope(rtmClient, session, {
    type,
    client_id: clientId,
    session_id: session.channelName,
    metadata: {
      client_id: clientId,
      session_id: session.channelName,
      transport: 'livekit_data',
      mode: session.intent.mode,
      surface: session.intent.surface,
      session_strategy: session.intent.sessionStrategy,
    },
    timestamp: Date.now(),
    ...payload,
  })
}

export function extractMemoryTurnsFromEnvelope(
  message: RtcMessageEnvelope,
): SessionMemoryTurn[] {
  if (message.type !== 'transcript' || !message.text || !message.is_final) {
    return []
  }

  if (message.role === 'user' || message.role === 'assistant') {
    return [
      {
        role: message.role,
        content: message.text,
      },
    ]
  }

  return []
}

export function extractLatestUserTranscriptFromEnvelope(
  message: RtcMessageEnvelope,
): { text: string; clientCaptureId: string | null } | null {
  if (message.type === 'transcript' && message.role === 'user' && message.is_final && message.text) {
    return {
      text: message.text,
      clientCaptureId:
        typeof message.client_capture_id === 'string' && message.client_capture_id.trim()
          ? message.client_capture_id.trim()
          : null,
    }
  }

  return null
}

export function reduceRtcEnvelope(
  prev: RtcAgentState,
  message: RtcMessageEnvelope,
): RtcAgentState {
  if (message.type === 'voice_profile_updated') {
    const sync: VoiceProfileSyncEvent = {
      source: typeof message.source === 'string' ? message.source : 'unknown',
      exerciseId: message.exercise_id || '',
      category: message.exercise_category || '',
      hotwordCount: typeof message.hotword_count === 'number' ? message.hotword_count : 0,
      confusionPatternsCount:
        typeof message.confusion_patterns_count === 'number' ? message.confusion_patterns_count : 0,
      clarityScore:
        typeof message.clarity_score === 'number' ? Math.round(message.clarity_score * 100) : 0,
      lastTrainingCategory: message.last_training_category || '',
      timestamp: new Date(),
    }
    return applyVoiceProfileSync(prev, sync)
  }

  if (message.type === 'speech_activity') {
    if (message.state === 'barge_in_triggered') {
      return {
        ...prev,
        isSpeaking: false,
        isThinking: false,
      }
    }

    return prev
  }

  if (message.type === 'error' || message.error) {
    return applyRtcError(prev, toProductMessage(message, 'realtime'))
  }

  if (message.type === 'transcript' && message.text) {
    if (message.role === 'user' && message.is_final) {
      return applyFinalUserTranscript(prev, message.text)
    }

    if (message.role === 'assistant' && message.is_final) {
      return applyFinalAssistantTranscript(prev, message.text)
    }

    if (message.role === 'user') {
      return applyCurrentAsrText(prev, message.text)
    }
  }

  if (message.name === 'interim_text') {
    const text = message.data?.text
    if (typeof text === 'string') {
      return applyCurrentAsrText(prev, text)
    }
    return prev
  }

  if (message.name === 'text_data') {
    const delta =
      (typeof message.data?.text === 'string' && message.data.text) ||
      message.delta ||
      ''
    const isFinal =
      (typeof message.data?.is_final === 'boolean' && message.data.is_final) ||
      message.is_final ||
      false

    return applyAssistantResponseDelta(prev, delta, isFinal)
  }

  return prev
}

export function applyConnectedRtcSession(
  prev: RtcAgentState,
  session: StartRtcSessionResponse,
  connectionNotice: string | null,
): RtcAgentState {
  return applyConnectedState(prev, session, connectionNotice)
}

export function decodeInboundEnvelopeFromEvent(
  event: RtmMessageEvent,
  chunks: Map<string, ChunkAccumulator>,
): RtcMessageEnvelope | null {
  return decodeInboundMessage(event.message, chunks)
}
