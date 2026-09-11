'use client'

import type {
  DataPacket_Kind,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
} from 'livekit-client'
import { RoomEvent, Track } from 'livekit-client'
import type {
  RtmMessageEvent,
  RtmStatusEvent,
  SessionControlClient,
  StartRtcSessionResponse,
} from './session-types'
import { ProductMessageError, toProductMessage } from '@/lib/ui/product-message'

interface ConnectLiveKitTransportOptions {
  session: StartRtcSessionResponse
  onRtmMessage: (event: RtmMessageEvent) => void
  onRtmStatus: (event: RtmStatusEvent) => void
  onRemoteAudioStart: () => void
  onRemoteAudioStop: () => void
  onRtcDisconnected: () => void
}

class LiveKitDataClient implements SessionControlClient {
  private readonly room: Room
  private readonly channelName: string

  constructor(
    room: Room,
    channelName: string,
  ) {
    this.room = room
    this.channelName = channelName
  }

  async publish(
    channelName: string,
    message: string | Uint8Array,
  ): Promise<void> {
    const payload =
      typeof message === 'string'
        ? new TextEncoder().encode(message)
        : message

    await this.room.localParticipant.publishData(payload, {
      reliable: true,
      topic: channelName || this.channelName,
    })
  }
}

export interface LiveKitTransportConnection {
  room: Room
  rtmClient: SessionControlClient
}

export function formatRtcConnectionError(error: unknown): string {
  return toProductMessage(error, 'realtime')
}

function resolveBrowserLiveKitUrl(serverUrl: string): string {
  if (typeof window === 'undefined') {
    return serverUrl
  }

  try {
    const target = new URL(serverUrl)
    const page = new URL(window.location.origin)
    const normalizedTargetHost = target.hostname.toLowerCase()
    const isLoopbackTarget =
      normalizedTargetHost === 'localhost' ||
      normalizedTargetHost === '127.0.0.1' ||
      normalizedTargetHost === '::1'
    const isDockerOnlyHost = normalizedTargetHost === 'livekit-server'

    if (!isLoopbackTarget && !isDockerOnlyHost) {
      return serverUrl
    }

    target.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:'
    target.hostname = page.hostname
    target.pathname = ''
    target.search = ''
    target.hash = ''
    return target.toString().replace(/\/$/, '')
  } catch {
    return serverUrl
  }
}

export async function connectLiveKitTransport(
  options: ConnectLiveKitTransportOptions,
): Promise<LiveKitTransportConnection> {
  const transport = options.session.transport
  if (transport.provider !== 'livekit') {
    throw new Error('LiveKit transport payload is missing from the current session.')
  }

  const { Room } = await import('livekit-client')
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  })

  const audioElementsByTrackSid = new Map<string, HTMLMediaElement[]>()

  room.on(
    RoomEvent.TrackSubscribed,
    (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Audio) {
        return
      }

      const audioTrack = track as RemoteAudioTrack
      const attached = audioTrack.attach()
      const elements = Array.isArray(attached) ? attached : [attached]
      elements.forEach((element) => {
        element.autoplay = true
        void element.play().catch(() => {
          // Autoplay can still be blocked until user gesture; keep the element attached.
        })
      })
      audioElementsByTrackSid.set(publication.trackSid, elements)
      options.onRemoteAudioStart()
    },
  )

  room.on(
    RoomEvent.TrackUnsubscribed,
    (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Audio) {
        return
      }

      const audioTrack = track as RemoteAudioTrack
      audioTrack.detach()
      audioElementsByTrackSid.get(publication.trackSid)?.forEach((element) => {
        element.remove()
      })
      audioElementsByTrackSid.delete(publication.trackSid)
      options.onRemoteAudioStop()
    },
  )

  room.on(
    RoomEvent.DataReceived,
    (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      options.onRtmMessage({
        message: payload,
        publisher: participant?.identity || 'livekit-room',
        channelName: topic || transport.roomName,
      })
    },
  )

  room.on(RoomEvent.Disconnected, (reason) => {
    options.onRtmStatus({
      newState: 'DISCONNECTED',
      reason: reason ? String(reason) : undefined,
    })
    options.onRtcDisconnected()
  })

  const browserServerUrl = resolveBrowserLiveKitUrl(transport.serverUrl)

  room.prepareConnection(browserServerUrl, transport.participantToken)

  try {
    await room.connect(browserServerUrl, transport.participantToken)
  } catch (error) {
    throw new ProductMessageError(formatRtcConnectionError(error))
  }

  options.onRtmStatus({ newState: 'CONNECTED' })

  return {
    room,
    rtmClient: new LiveKitDataClient(room, transport.roomName),
  }
}

export async function disconnectLiveKitTransport(room: Room | null): Promise<void> {
  if (!room) {
    return
  }

  await room.disconnect()
}

export { resolveBrowserLiveKitUrl }
