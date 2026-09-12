export type * from './generated/rtc-session'
import type { RtcSessionMode, RtcCapabilityId, RtcSessionStrategy, RtcDeviceContext } from './generated/rtc-session'

export function defaultCapabilitiesForMode(
  mode: RtcSessionMode,
): RtcCapabilityId[] {
  if (mode === 'training') {
    return [
      'transport_send_control',
      'workspace_snapshot_read',
      'voice_profile_update',
      'upload_artifact_persist',
    ]
  }

  if (mode === 'quick_talk') {
    return ['transport_send_control']
  }

  return [
    'transport_send_control',
    'workspace_snapshot_read',
  ]
}

export function defaultStrategyForMode(
  mode: RtcSessionMode,
): RtcSessionStrategy {
  return mode === 'quick_talk' ? 'light_voice' : 'heavy_realtime'
}

export function buildClientDeviceContext(
  mode: RtcSessionMode,
): RtcDeviceContext {
  if (typeof window === 'undefined') {
    return {}
  }

  const secureContext = window.isSecureContext
  const mediaDevicesSupported = Boolean(navigator.mediaDevices?.getUserMedia)
  const microphoneStatus =
    mode === 'training' && (!secureContext || !mediaDevicesSupported)
      ? 'unavailable'
      : 'unknown'

  return {
    secureContext,
    mediaDevicesSupported,
    microphoneStatus,
    networkOnline: navigator.onLine,
  }
}
