'use client'

import type { Room } from 'livekit-client'
import {
  connectLiveKitTransport,
  disconnectLiveKitTransport,
} from './livekit-transport'
import type {
  RtmMessageEvent,
  RtmStatusEvent,
  SessionControlClient,
  SessionMicrophoneTrack,
  StartRtcSessionResponse,
} from './session-types'

interface ConnectSessionExecutionOptions {
  session: StartRtcSessionResponse
  onRtmMessage: (event: RtmMessageEvent) => void
  onRtmStatus: (event: RtmStatusEvent) => void
  onRemoteAudioStart: () => void
  onRemoteAudioStop: () => void
  onRtcDisconnected: () => void
}

export interface SessionExecutionClient {
  provider: 'livekit'
  room: Room
}

export interface SessionExecutionConnection {
  clientHandle: SessionExecutionClient
  rtmClient: SessionControlClient
  executionBackend: StartRtcSessionResponse['executionBackend']
}

export async function connectSessionExecution(
  options: ConnectSessionExecutionOptions,
): Promise<SessionExecutionConnection> {
  const connection = await connectLiveKitTransport(options)
  return {
    clientHandle: {
      provider: 'livekit',
      room: connection.room,
    },
    rtmClient: connection.rtmClient,
    executionBackend: options.session.executionBackend,
  }
}

export async function disconnectSessionExecution({
  clientHandle,
  micTrack,
}: {
  clientHandle: SessionExecutionClient | null
  micTrack: SessionMicrophoneTrack | null
}): Promise<void> {
  try {
    micTrack?.close()
  } catch (error) {
    console.warn('[livekit-transport] mic close failed:', error)
  }

  await disconnectLiveKitTransport(clientHandle?.room ?? null)
}
