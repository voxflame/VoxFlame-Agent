import type {
  Dispatch,
  SetStateAction,
} from 'react'
import type {
  RtcAgentState,
  RtmStatusEvent,
} from './session-types'

interface SessionTransportEventHandlers {
  onRtmStatus: (event: RtmStatusEvent) => void
  onRemoteAudioStart: () => void
  onRemoteAudioStop: () => void
  onRtcDisconnected: () => void
}

export function createSessionTransportEventHandlers(
  setState: Dispatch<SetStateAction<RtcAgentState>>,
  isCurrentSession: () => boolean = () => true,
): SessionTransportEventHandlers {
  const updateCurrentState: typeof setState = (update) => {
    if (isCurrentSession()) setState(update)
  }
  return {
    onRtmStatus: (event) => {
      if (event.newState === 'DISCONNECTED') {
        updateCurrentState((prev) => ({
          ...prev,
          isConnected: false,
          error: '连接已断开，请重新连接。',
        }))
      }
    },
    onRemoteAudioStart: () => {
      updateCurrentState((prev) => ({ ...prev, isSpeaking: true }))
    },
    onRemoteAudioStop: () => {
      updateCurrentState((prev) => ({ ...prev, isSpeaking: false }))
    },
    onRtcDisconnected: () => {
      updateCurrentState((prev) => ({ ...prev, isConnected: false, isRecording: false }))
    },
  }
}
